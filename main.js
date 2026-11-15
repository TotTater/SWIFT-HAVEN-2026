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
const { STATUS_INFO, NEGATIVE, getPersonality } = require('./personalities');
const { CAPTION_SCRIPT, GOAL_PANEL_SCRIPT } = require('./inject');

let characterWindow;
let settingsWindow;

let settingsExpanded = false;
let selectedScreenId = null;

let selectedCharacterId = 'pink';
let selectedExpression = 'neutral';
let currentCharacterName = 'Pink';

// Goal + relationship
let goal = '';                 // empty = no goal, just hang out
let relationship = {};         // { characterId: score }
let lastScoreAt = 0;
const SCORE_COOLDOWN_MS = 8000;

// Mood + captions
let mood = { status: 'idle_or_menu', activity: '' };
let moodExpression = 'neutral';
let hasAnalysis = false;
let freshAnalysis = false;
let lastCaptionStatus = '';
let lastLineAt = 0;
let lastLine = '';
let pleaIndex = 0;
let talkTimer = null;
let captionInterval = null;

const CAPTION_EVERY_MS = 3000;
const COMMENTARY_EVERY_MS = 12000; // how often it comments while the situation stays the same

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
// MOOD + CAPTIONS
// ------------------------------------

function broadcast(payload) {
  const data = {
    affinity: relationship[selectedCharacterId] ?? 0,
    ...payload
  };

  for (const win of [characterWindow, settingsWindow]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send('reaction', data);
    }
  }
}


function setMoodExpression(expression) {
  moodExpression = expression;

  // If the character is mid-"talking", the talk timer restores the mood afterwards
  if (!talkTimer) {
    selectedExpression = expression;
    sendCharacterState();
  }
}


function say(text, activity = '') {
  lastLine = text;
  broadcast({ text, activity, status: mood.status });

  // Show the talking image briefly, then go back to the current mood
  if (talkTimer) clearTimeout(talkTimer);

  selectedExpression = 'talking';
  sendCharacterState();

  talkTimer = setTimeout(() => {
    talkTimer = null;
    selectedExpression = moodExpression;
    sendCharacterState();
  }, 1500);
}


function pickLine(status) {
  const lines = getPersonality(selectedCharacterId).lines[status] || [];
  if (!lines.length) return '';

  let choice = lines[Math.floor(Math.random() * lines.length)];

  if (lines.length > 1) {
    while (choice === lastLine) {
      choice = lines[Math.floor(Math.random() * lines.length)];
    }
  }

  return choice;
}


function nextPlea() {
  const pleas = getPersonality(selectedCharacterId).pleas;
  const plea = pleas[pleaIndex % pleas.length];
  pleaIndex++;
  return plea;
}


// Runs whenever the AI reports something new about the screen
async function handleAnalysis(result) {
  mood = { status: result.status, activity: result.activity };
  hasAnalysis = true;
  freshAnalysis = true;

  const info = STATUS_INFO[result.status];
  setMoodExpression(info.expression);

  // Score only changes with a goal set, and at most once per cooldown
  const now = Date.now();

  if (goal && info.delta !== 0 && now - lastScoreAt >= SCORE_COOLDOWN_MS) {
    lastScoreAt = now;

    const current = relationship[selectedCharacterId] ?? 0;
    relationship[selectedCharacterId] = Math.max(
      -100,
      Math.min(100, current + info.delta)
    );

    await saveRelationship();
    broadcast({}); // updates the score display, no caption
  }
}


// Runs every 3 seconds
function captionTick() {
  if (!watcher.isRunning() || !hasAnalysis) return;

  const now = Date.now();

  // 1. The situation changed -> react to it
  if (mood.status !== lastCaptionStatus) {
    lastCaptionStatus = mood.status;
    pleaIndex = 0;
    freshAnalysis = false;
    lastLineAt = now;
    say(pickLine(mood.status), mood.activity);
    return;
  }

  // 2. Nothing changed and the mood is negative -> keep begging
  if (NEGATIVE.has(mood.status)) {
    say(nextPlea());
    return;
  }

  // 3. Nothing changed and the mood is fine -> hold the mood,
  //    but comment now and then if the player is still doing new things
  if (freshAnalysis && now - lastLineAt >= COMMENTARY_EVERY_MS) {
    freshAnalysis = false;
    lastLineAt = now;
    say(pickLine(mood.status), mood.activity);
  }
}


const watcher = createWatcher({
  getScreenId: () => selectedScreenId,
  getGoal: () => goal,
  onResult: handleAnalysis,
  onError: err => console.error('Vision error:', err.message)
});


function resetForCharacterChange() {
  selectedExpression = moodExpression;
  lastLine = '';
  lastCaptionStatus = '';
  pleaIndex = 0;
}


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

    // Netflix-style caption bar
    characterWindow.webContents
      .executeJavaScript(CAPTION_SCRIPT)
      .catch(err => console.error('Caption inject error:', err.message));
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

  settingsWindow.webContents.on('did-finish-load', () => {
    // Goal box + pause button + score
    settingsWindow.webContents
      .executeJavaScript(GOAL_PANEL_SCRIPT)
      .catch(err => console.error('Goal panel inject error:', err.message));
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
  resetForCharacterChange();

  await saveSelectedCharacter();
  await sendCharacterState();
  broadcast({}); // refresh the score display for this character

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
  resetForCharacterChange();

  await saveSelectedCharacter();
  await sendCharacterState();
  broadcast({});

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

  // Auto-start watching once a screen is chosen
  watcher.start();

  return true;
});


// ------------------------------------
// GOAL + WATCHING CONTROLS
// ------------------------------------

ipcMain.handle('set-goal', (event, text) => {
  goal = String(text || '').trim().slice(0, 200);

  // Look at the screen again with the new goal in mind
  lastCaptionStatus = '';
  pleaIndex = 0;
  watcher.refresh();

  return true;
});

ipcMain.handle('get-goal', () => goal);

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

  captionInterval = setInterval(captionTick, CAPTION_EVERY_MS);
});


app.on('before-quit', () => {
  watcher.stop();
  clearInterval(captionInterval);
});


app.on('window-all-closed', () => {
  app.quit();
});