const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  navigate: (page) => ipcRenderer.invoke('navigate', page),
  generatePost: (data) => ipcRenderer.invoke('post:generate', data),
  humanizePost: (data) => ipcRenderer.invoke('post:humanize', data),
  savePost: (data) => ipcRenderer.invoke('post:save', data),
  publishNow: (data) => ipcRenderer.invoke('post:publish-now', data),
  updatePostUrl: (data) => ipcRenderer.invoke('post:update-url', data),
  getHistory: () => ipcRenderer.invoke('history:get'),
  saveSettings: (data) => ipcRenderer.invoke('settings:save', data),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  checkPerformanceNow: () => ipcRenderer.invoke('performance:check-now'),
  getPendingPerformanceCount: () => ipcRenderer.invoke('performance:pending-count'),
  generateImage: (data) => ipcRenderer.invoke('image:generate', data),
  openImageFolder: () => ipcRenderer.invoke('image:open-folder'),
});
