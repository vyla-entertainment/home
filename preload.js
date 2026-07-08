const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vylaHome', {
    sendUpdateChoice: (choice) => ipcRenderer.send('update-choice', choice),
    sendToken: (token) => ipcRenderer.send('token-submit', token)
});