const {
  app,
  BrowserWindow,
  screen,
  ipcMain,
  desktopCapturer,
  session,
  dialog
} = require('electron');

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { createWatcher } = require('./vision');

let characterWindow;
let settingsWindow;

let settingsExpanded = false;
let selectedScreenId = null;

let selectedCharacterId = 'pink';
let selectedExpression = 'neutral';
let currentCharacterName = 'Pink';

// Relationship / vision state
let goal = 'Make progress in the game';
let lastNote = '';
let relationship = {}; // { characterId: score }

const SETTINGS_SIZE = 56;
const SETTINGS_WIDTH = 380;
const SETTINGS_HEIGHT = 620;

const IMAGE_FOLDER = path.join(__dirname, 'image_assets');

const CUSTOM_CHARACTERS_FOLDER = path.join(
  app.getPath('userData'),
  'characters'
);

const EXPRESSIONS = [
  'neutral',
  'talking',
  'pleased',
  'sad',
  'angry',
  'shocked',
  'disappointed'
];

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

const BUILT_IN_CHARACTERS = {
  pink: {
    name: 'Pink',
    images: {
      neutral: 'pink_neutral.png',
      talking: 'pink_talking_happy.png',
      pleased: 'pink_pleased.png',
      sad: 'pink_sad.png',
      angry: 'pink_angry.png',
      shocked: 'pink_shocked.png',
      disappointed: 'pink_dissapointed.png'
    }
  },

  bb: {
    name: 'BB',
    images: {
      neutral: 'bb_neutral.png',
      talking: 'bb_talking_happy.png',
      pleased: 'bb_pleased.png',
      sad: 'bb_sad.png',
      angry: 'bb_angry.png',
      shocked: 'bb_shocked.png',
      disappointed: 'bb_dissapointed.png'
    }
  }
};


// ------------------------------------
// CHARACTER HELPERS
// ------------------------------------

function imageUrl(filePath) {
  return pathToFileURL(filePath).href;
}


async function findExpressionFile(folder, expression) {
  const files = await fs.promises.readdir(folder);

  const match = files.find(file => {
    const parsed = path.parse(file);

    return (
      parsed.name.toLowerCase() === expression.toLowerCase() &&
      IMAGE_EXTENSIONS.includes(parsed.ext.toLowerCase())
    );
  });

  if (!match) return null;

  return path.join(folder, match);
}


async function getCustomCharacter(id) {
  const folder = path.join(CUSTOM_CHARACTERS_FOLDER, id);

  if (!fs.existsSync(folder)) return null;

  const neutralFile = await findExpressionFile(folder, 'neutral');
  const talkingFile = await findExpressionFile(folder, 'talking');

  if (!neutralFile || !talkingFile) return null;

  const images = {};

  for (const expression of EXPRESSIONS) {
    const file = await findExpressionFile(folder, expression);

    images[expression] = imageUrl(file || neutralFile);
  }

  return {
    id,
    name: id.replace(/^\d+-/, '').replace(/[-_]/g, ' '),
    images
  };
}


async function getCharacterList() {
  const characters = [
    { id: 'pink', name: 'Pink' },
    { id: 'bb', name: 'BB' }
  ];

  await fs.promises.mkdir(CUSTOM_CHARACTERS_FOLDER, {
    recursive: true
  });

  const folders = await fs.promises.readdir(
    CUSTOM_CHARACTERS_FOLDER,
    { withFileTypes: true }
  );

  for (const folder of folders) {
    if (!folder.isDirectory()) continue;

    const character = await getCustomCharacter(folder.name);

    if (character) {
      characters.push({
        id: character.id,
        name: character.name
      });
    }
  }

  return characters;
}


async function getCharacterData(id) {
  if (BUILT_IN_CHARACTERS[id]) {
    const character = BUILT_IN_CHARACTERS[id];
    const images = {};

    for (const expression of EXPRESSIONS) {
      const filename = character.images[expression];

      images[expression] = imageUrl(
        path.join(IMAGE_FOLDER, filename)
      );
    }

    return {
      id,
      name: character.name,
      images
    };
  }

  return await getCustomCharacter(id);
}


async function sendCharacterState() {
  if (!characterWindow || characterWindow.isDestroyed()) return;

  const character = await getCharacterData(selectedCharacterId);

  if (!character) return;

  currentCharacterName = character.name;

  const image =
    character.images[selectedExpression] ||
    character.images.neutral;

  characterWindow.webContents.send('character-update', {
    name: character.name,
    expression: selectedExpression,
    image
  });
}


async function saveSelectedCharacter() {
  const file = path.join(
    app.getPath('userData'),
    'selected-character.json'
  );

  await fs.promises.writeFile(
    file,
    JSON.stringify({ id: selectedCharacterId }, null, 2)
  );
}


async function loadSelectedCharacter() {
  try {
    const file = path.join(
      app.getPath('userData'),
      'selected-character.json'
    );

    const saved = JSON.parse(
      await fs.promises.readFile(file, 'utf8')
    );

    const characters = await getCharacterList();

    if (characters.some(character => character.id === saved.id)) {
      selectedCharacterId = saved.id;
    }
  } catch {
    selectedCharacterId = 'pink';
  }
}


// ------------------------------------
// RELATIONSHIP STORAGE
// ------------------------------------

function relationshipFile() {
  return path.join(app.getPath('userData'), 'relationship.json');
}

async function saveRelationship() {
  await fs.promises.writeFile(
    relationshipFile(),
    JSON.stringify(relationship, null, 2)
  );
}

async function loadRelationship() {
  try {
    relationship = JSON.parse(
      await fs.promises.readFile(relationshipFile(), 'utf8')
    );
  } catch {
    relationship = {};
  }
}


// ------------------------------------
// VISION WATCHER (local Ollama, no API)
// ------------------------------------

async function applyReaction(r) {
  const current = relationship[selectedCharacterId] ?? 0;

  relationship[selectedCharacterId] = Math.max(
    -100,
    Math.min(100, current + r.affinity_delta)
  );

  lastNote = r.progress_note;
  selectedExpression = r.expression;

  await sendCharacterState();
  await saveRelationship();

  for (const win of [characterWindow, settingsWindow]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send('reaction', {
        comment: r.comment,
        affinity: relationship[selectedCharacterId],
        delta: r.affinity_delta
      });
    }
  }

  console.log(
    `[${currentCharacterName}] ${r.expression} (${r.affinity_delta >= 0 ? '+' : ''}${r.affinity_delta}) ` +
    `score=${relationship[selectedCharacterId]} | "${r.comment}"`
  );
}

const watcher = createWatcher({
  getScreenId: () => selectedScreenId,
  getContext: () => ({
    characterName: currentCharacterName,
    goal,
    affinity: relationship[selectedCharacterId] ?? 0,
    lastNote
  }),
  onReaction: applyReaction,
  onError: err => console.error('Vision error:', err.message)
});


// ------------------------------------
// CREATE WINDOWS
// ------------------------------------

function createWindows() {
  const display = screen.getPrimaryDisplay();
  const bounds = display.bounds;
  const workArea = display.workArea;

  characterWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,

    frame: false,
    transparent: true,
    backgroundColor: '#00000000',

    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,

    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  characterWindow.setIgnoreMouseEvents(true);
  characterWindow.setAlwaysOnTop(true, 'screen-saver');
  characterWindow.setVisibleOnAllWorkspaces(true);

  characterWindow.loadFile('index.html', {
    query: { view: 'character' }
  });

  characterWindow.webContents.on('did-finish-load', () => {
    sendCharacterState();
  });


  // SETTINGS WINDOW

  settingsWindow = new BrowserWindow({
    x: workArea.x + workArea.width - SETTINGS_SIZE,
    y: workArea.y,

    width: SETTINGS_SIZE,
    height: SETTINGS_SIZE,

    frame: false,
    transparent: true,
    backgroundColor: '#00000000',

    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,

    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWindow.setAlwaysOnTop(true, 'screen-saver');
  settingsWindow.setVisibleOnAllWorkspaces(true);

  settingsWindow.loadFile('index.html', {
    query: { view: 'settings' }
  });
}


// ------------------------------------
// SETTINGS WINDOW SIZE
// ------------------------------------

ipcMain.on('toggle-settings', () => {
  if (!settingsWindow || settingsWindow.isDestroyed()) return;

  settingsExpanded = !settingsExpanded;

  const area = screen.getPrimaryDisplay().workArea;

  if (settingsExpanded) {
    settingsWindow.setBounds({
      x: area.x + area.width - SETTINGS_WIDTH,
      y: area.y,
      width: SETTINGS_WIDTH,
      height: SETTINGS_HEIGHT
    });
  } else {
    settingsWindow.setBounds({
      x: area.x + area.width - SETTINGS_SIZE,
      y: area.y,
      width: SETTINGS_SIZE,
      height: SETTINGS_SIZE
    });
  }
});


// ------------------------------------
// CHARACTER IPC
// ------------------------------------

ipcMain.handle('get-characters', async () => {
  return await getCharacterList();
});


ipcMain.handle('get-selected-character', async () => {
  return selectedCharacterId;
});


ipcMain.handle('select-character', async (event, id) => {
  const characters = await getCharacterList();

  if (!characters.some(character => character.id === id)) {
    return false;
  }

  selectedCharacterId = id;
  selectedExpression = 'neutral';
  lastNote = '';

  await saveSelectedCharacter();
  await sendCharacterState();

  return true;
});


ipcMain.handle('set-expression', async (event, expression) => {
  if (!EXPRESSIONS.includes(expression)) {
    return false;
  }

  selectedExpression = expression;
  await sendCharacterState();

  return true;
});


ipcMain.handle('import-character', async () => {
  const result = await dialog.showOpenDialog(settingsWindow, {
    title: 'Choose your character folder',
    properties: ['openDirectory']
  });

  if (result.canceled || !result.filePaths.length) {
    return { success: false, message: 'Import cancelled.' };
  }

  const sourceFolder = result.filePaths[0];

  const neutralFile = await findExpressionFile(
    sourceFolder,
    'neutral'
  );

  const talkingFile = await findExpressionFile(
    sourceFolder,
    'talking'
  );

  if (!neutralFile || !talkingFile) {
    return {
      success: false,
      message: 'Your folder must contain neutral.png and talking.png.'
    };
  }

  const originalName = path.basename(sourceFolder);

  const safeName = originalName
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'MyCharacter';

  await fs.promises.mkdir(CUSTOM_CHARACTERS_FOLDER, {
    recursive: true
  });

  let id = safeName;
  let number = 2;

  while (
    fs.existsSync(path.join(CUSTOM_CHARACTERS_FOLDER, id))
  ) {
    id = `${number}-${safeName}`;
    number++;
  }

  const destinationFolder = path.join(
    CUSTOM_CHARACTERS_FOLDER,
    id
  );

  await fs.promises.mkdir(destinationFolder, {
    recursive: true
  });

  const files = await fs.promises.readdir(sourceFolder);

  for (const expression of EXPRESSIONS) {
    const matchingFile = files.find(file => {
      const parsed = path.parse(file);

      return (
        parsed.name.toLowerCase() === expression.toLowerCase() &&
        IMAGE_EXTENSIONS.includes(parsed.ext.toLowerCase())
      );
    });

    if (matchingFile) {
      await fs.promises.copyFile(
        path.join(sourceFolder, matchingFile),
        path.join(destinationFolder, matchingFile)
      );
    }
  }

  selectedCharacterId = id;
  selectedExpression = 'neutral';
  lastNote = '';

  await saveSelectedCharacter();
  await sendCharacterState();

  return {
    success: true,
    name: originalName,
    id
  };
});


// ------------------------------------
// SCREEN OBSERVATION
// ------------------------------------

ipcMain.handle('list-screens', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 0, height: 0 }
  });

  return sources.map(source => ({
    id: source.id,
    name: source.name
  }));
});


ipcMain.handle('select-screen', async (event, screenId) => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 0, height: 0 }
  });

  const selected = sources.find(source => source.id === screenId);

  if (!selected) return false;

  selectedScreenId = selected.id;

  // Auto-start the reaction loop once a screen is chosen
  watcher.start();

  return true;
});


// ------------------------------------
// GOAL + WATCHING CONTROLS
// ------------------------------------

ipcMain.handle('set-goal', (event, text) => {
  goal = String(text).slice(0, 200) || 'Make progress in the game';
  lastNote = '';
  return true;
});

ipcMain.handle('start-watching', () => {
  if (!selectedScreenId) {
    return { ok: false, message: 'Select a screen first.' };
  }

  watcher.start();
  return { ok: true };
});

ipcMain.handle('stop-watching', () => {
  watcher.stop();
  return true;
});

ipcMain.handle('get-affinity', () => {
  return relationship[selectedCharacterId] ?? 0;
});


// ------------------------------------
// APP STARTUP
// ------------------------------------

app.whenReady().then(async () => {
  await fs.promises.mkdir(CUSTOM_CHARACTERS_FOLDER, {
    recursive: true
  });

  await loadSelectedCharacter();
  await loadRelationship();

  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      if (!selectedScreenId) {
        callback(null);
        return;
      }

      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 0, height: 0 }
        });

        const selectedSource = sources.find(
          source => source.id === selectedScreenId
        );

        if (!selectedSource) {
          callback(null);
          return;
        }

        callback({
          video: selectedSource
        });

      } catch (error) {
        console.error('Screen capture error:', error);
        callback(null);
      }
    }
  );

  createWindows();
});


app.on('before-quit', () => {
  watcher.stop();
});


app.on('window-all-closed', () => {
  app.quit();
});