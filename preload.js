
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('haven', {
  toggleSettings: () => {
    ipcRenderer.send('toggle-settings');
  }
});
