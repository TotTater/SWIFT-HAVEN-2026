
const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

let characterWindow;
let settingsWindow;

let settingsExpanded = false;

// Window dimensions
const CHARACTER_WIDTH = 460;
const CHARACTER_HEIGHT = 520;

const SETTINGS_SIZE = 56;
const SETTINGS_EXPANDED_WIDTH = 280;
const SETTINGS_EXPANDED_HEIGHT = 260;

function createWindows() {
  const display = screen.getPrimaryDisplay();
  const area = display.workArea;

  // Position the character near the bottom-right
  const characterX =
    area.x + area.width - CHARACTER_WIDTH - 30;

  const characterY =
    area.y + area.height - CHARACTER_HEIGHT - 30;

  // CHARACTER WINDOW
  characterWindow = new BrowserWindow({
    x: characterX,
    y: characterY,
    width: CHARACTER_WIDTH,
    height: CHARACTER_HEIGHT,

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

  // Make the character window click-through
  characterWindow.setIgnoreMouseEvents(true);

  characterWindow.setAlwaysOnTop(true, 'screen-saver');
  characterWindow.setVisibleOnAllWorkspaces(true);

  characterWindow.loadFile('index.html', {
    query: { view: 'character' }
  });


  // SETTINGS WINDOW
  settingsWindow = new BrowserWindow({
    x: characterX + CHARACTER_WIDTH - SETTINGS_SIZE,
    y: characterY,

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


// OPEN AND CLOSE SETTINGS
ipcMain.on('toggle-settings', () => {
  if (!settingsWindow || settingsWindow.isDestroyed()) {
    return;
  }

  settingsExpanded = !settingsExpanded;

  const bounds = settingsWindow.getBounds();

  if (settingsExpanded) {
    settingsWindow.setBounds({
      x: bounds.x - (SETTINGS_EXPANDED_WIDTH - SETTINGS_SIZE),
      y: bounds.y,
      width: SETTINGS_EXPANDED_WIDTH,
      height: SETTINGS_EXPANDED_HEIGHT
    });
  } else {
    settingsWindow.setBounds({
      x: bounds.x + (SETTINGS_EXPANDED_WIDTH - SETTINGS_SIZE),
      y: bounds.y,
      width: SETTINGS_SIZE,
      height: SETTINGS_SIZE
    });
  }
});


// START HAVEN
app.whenReady().then(() => {
  createWindows();
});


// CLOSE APP
app.on('window-all-closed', () => {
  app.quit();
});
