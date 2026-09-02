const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sushiClubDesktop', {
  isDesktop: true,
  selectDirectory: () => ipcRenderer.invoke('sushiclub:select-directory'),
  writeFile: (relativePath, buffer) => ipcRenderer.invoke('sushiclub:write-file', relativePath, buffer),
});
