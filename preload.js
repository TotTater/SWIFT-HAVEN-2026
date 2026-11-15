const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('haven', {
  toggleSettings: () =>
    ipcRenderer.send('toggle-settings'),

  listScreens: () =>
    ipcRenderer.invoke('list-screens'),

  selectScreen: screenId =>
    ipcRenderer.invoke('select-screen', screenId),

  getCharacters: () =>
    ipcRenderer.invoke('get-characters'),

  getSelectedCharacter: () =>
    ipcRenderer.invoke('get-selected-character'),

  selectCharacter: id =>
    ipcRenderer.invoke('select-character', id),

  setExpression: expression =>
    ipcRenderer.invoke('set-expression', expression),

  importCharacter: () =>
    ipcRenderer.invoke('import-character'),

  setGoal: text =>
    ipcRenderer.invoke('set-goal', text),

  getGoal: () =>
    ipcRenderer.invoke('get-goal'),

  startWatching: () =>
    ipcRenderer.invoke('start-watching'),

  stopWatching: () =>
    ipcRenderer.invoke('stop-watching'),

  getAffinity: () =>
    ipcRenderer.invoke('get-affinity'),

  onCharacterUpdate: callback => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('character-update', listener);
    return () => ipcRenderer.removeListener('character-update', listener);
  },

  onReaction: callback => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('reaction', listener);
    return () => ipcRenderer.removeListener('reaction', listener);
  }
});