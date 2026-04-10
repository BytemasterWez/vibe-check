const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('window:toggle-always-on-top'),
  isAlwaysOnTop: () => ipcRenderer.invoke('window:is-always-on-top'),

  // Directory picker
  openDirectory: () => ipcRenderer.invoke('dialog:open-directory'),

  // Settings
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),

  // Credential resolution
  resolveAuth: (providerId, projectPath) => ipcRenderer.invoke('auth:resolve', { providerId, projectPath }),

  // Local LLM discovery
  discoverLocalServers: () => ipcRenderer.invoke('discovery:scan'),
  listModels: (baseUrl) => ipcRenderer.invoke('discovery:list-models', baseUrl),

  // Scaffold mode
  createDirectory: () => ipcRenderer.invoke('dialog:create-directory'),
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:write', text),

  // Git diff
  gitDiff: (projectPath, filePath) => ipcRenderer.invoke('git:diff', { projectPath, filePath }),
  readFile: (projectPath, filePath) => ipcRenderer.invoke('file:read', { projectPath, filePath }),

  // File watcher
  onFileEvent: (callback) => {
    ipcRenderer.on('watcher:event', (_, event) => callback(event));
    return () => ipcRenderer.removeAllListeners('watcher:event');
  },
  startWatching: (dirPath) => ipcRenderer.invoke('watcher:start', dirPath),
  stopWatching: () => ipcRenderer.invoke('watcher:stop'),
});
