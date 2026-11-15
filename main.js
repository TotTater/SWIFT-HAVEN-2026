
const {
  app,
  BrowserWindow,
  screen,
  ipcMain,
  desktopCapturer,
  session
} = require('electron');

const path = require('path');

let characterWindow;
let settingsWindow;

let settingsExpanded = false;
let selectedScreenId = null;

const SETTINGS_SIZE = 56;
const SETTINGS_WIDTH = 380;
const SETTINGS_HEIGHT = 540;

function createWindows() {
  const display = screen.getPrimaryDisplay();
  const bounds = display.bounds;
  const workArea = display.workArea;

  // FULL-SCREEN TRANSPARENT CHARACTER WINDOW
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

  // SETTINGS WINDOW - TOP RIGHT
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


// EXPAND / COLLAPSE SETTINGS
ipcMain.on('toggle-settings', () => {
  if (!settingsWindow || settingsWindow.isDestroyed()) return;

  settingsExpanded = !settingsExpanded;

  const display = screen.getPrimaryDisplay();
  const area = display.workArea;

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


// LIST AVAILABLE MONITORS
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


// REMEMBER THE MONITOR THE USER SELECTED
ipcMain.handle('select-screen', async (event, screenId) => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 0, height: 0 }
  });

  const selected = sources.find(source => source.id === screenId);

  if (!selected) {
    return false;
  }

  selectedScreenId = selected.id;
  return true;
});


// HANDLE SCREEN CAPTURE REQUESTS
app.whenReady().then(() => {

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

        // Capture video only. No system audio.
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


// CLOSE APP
app.on('window-all-closed', () => {
  app.quit();
});
