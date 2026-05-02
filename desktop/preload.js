const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vibing', {
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  validateGlobalHotkey: (accelerator) => ipcRenderer.invoke('hotkey:validate-global-accelerator', accelerator),
  transcribeAudio: (payload) => ipcRenderer.invoke('workflow:transcribe-audio', payload),
  rewriteText: (payload) => ipcRenderer.invoke('workflow:rewrite-text', payload),
  deliverText: (payload) => ipcRenderer.invoke('workflow:deliver-text', payload),
  processAudio: (payload) => ipcRenderer.invoke('workflow:process-audio', payload),
  copyText: (text) => ipcRenderer.invoke('workflow:copy', text),
  markRendererReady: () => ipcRenderer.invoke('app:renderer-ready'),
  hideWindow: () => ipcRenderer.invoke('app:hide-window'),
  showWindow: () => ipcRenderer.invoke('app:show-window'),
  onRecordHotkey: (callback) => {
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('record-hotkey-triggered', listener);
    return () => ipcRenderer.removeListener('record-hotkey-triggered', listener);
  }
});