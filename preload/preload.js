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
  fetchKeywords: (opts) => ipcRenderer.invoke('keywords:fetch', opts || {}),
  openExternalUrl: (url) => ipcRenderer.invoke('url:open-external', url),
  getSchedulerStatus: () => ipcRenderer.invoke('scheduler:get-status'),
  setAutoMode: (enabled) => ipcRenderer.invoke('scheduler:set-auto-mode', enabled),
  runNow: (data) => ipcRenderer.invoke('scheduler:run-now', data),
  // ── 수동 예약 발행 ──
  manualParseContent: (data) => ipcRenderer.invoke('manual:parse-content', data),
  manualSelectImage: () => ipcRenderer.invoke('manual:select-image'),
  manualPublishAll: (data) => ipcRenderer.invoke('manual:publish-all', data),
  onManualProgress: (callback) => ipcRenderer.on('manual:progress', (_event, info) => callback(info)),
});
