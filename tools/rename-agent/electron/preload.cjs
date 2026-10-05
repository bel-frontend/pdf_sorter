const { contextBridge, ipcRenderer, webUtils } = require("electron");

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("renameDesktop", {
  platform: process.platform,
  getConfig: () => ipcRenderer.invoke("app:get-config"),
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),
  saveWorkspace: (snapshot) => ipcRenderer.invoke('workspace:save', snapshot),
  getReport: () => ipcRenderer.invoke('report:get'),
  exportReport: (format) => ipcRenderer.invoke('report:export', format),
  saveSettings: (patch) => ipcRenderer.invoke("app:save-settings", patch),
  saveSecrets: (payload) => ipcRenderer.invoke("secrets:save", payload),
  connectGoogleDrive: () => ipcRenderer.invoke("google-drive:connect"),
  disconnectGoogleDrive: () => ipcRenderer.invoke("google-drive:disconnect"),
  uploadLastToGoogleDrive: () => ipcRenderer.invoke("google-drive:upload-last"),
  pickFiles: () => ipcRenderer.invoke("dialog:pick-files"),
  pickFolders: () => ipcRenderer.invoke("dialog:pick-folders"),
  pickDestination: () => ipcRenderer.invoke("dialog:pick-destination"),
  pickPython: () => ipcRenderer.invoke("dialog:pick-python"),
  expandInputs: (paths) => ipcRenderer.invoke("inputs:expand", paths),
  existingCategories: (destination) =>
    ipcRenderer.invoke("destination:categories", destination),
  analyze: (options) => ipcRenderer.invoke("analysis:start", options),
  cancelAnalysis: () => ipcRenderer.invoke("analysis:cancel"),
  validatePlan: (payload) => ipcRenderer.invoke("plan:validate", payload),
  openFile: (payload) => ipcRenderer.invoke("file:open", payload),
  applyPlan: (payload) => ipcRenderer.invoke("plan:apply", payload),
  undo: () => ipcRenderer.invoke("plan:undo"),
  pathForFile: (file) => webUtils.getPathForFile(file),
  onAnalysisProgress: (callback) => subscribe("analysis:progress", callback),
  onApplyProgress: (callback) => subscribe("apply:progress", callback),
  onUndoProgress: (callback) => subscribe("undo:progress", callback),
  onDriveProgress: (callback) => subscribe("drive:progress", callback),
});
