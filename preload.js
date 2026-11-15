
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('haven', {
  toggleSettings: () =>
    ipcRenderer.send('toggle-settings'),

  listScreens: () =>
    ipcRenderer.invoke('list-screens'),

  selectScreen: (screenId) =>
    ipcRenderer.invoke('select-screen', screenId)
});
