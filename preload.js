const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rtti', {
  // Read a JSON file relative to the data directory.
  readJson: (relPath) => ipcRenderer.invoke('fs:readJson', relPath),

  // Write a JSON file relative to the data directory.
  writeJson: (relPath, data) => ipcRenderer.invoke('fs:writeJson', relPath, data),

  // List all year subfolders (e.g. ['2025-2026', '2024-2025']), newest first.
  listYears: () => ipcRenderer.invoke('fs:listYears'),

  // Create year folder + all required subfolders (exams/, groups/, scores/<subj>/).
  ensureYear: (year) => ipcRenderer.invoke('fs:ensureYear', year),

  // List student IDs that have a score file for the given year + subject.
  listScoreFiles: (year, subject) => ipcRenderer.invoke('fs:listScoreFiles', year, subject),

  // Read all .json files directly in a directory (non-recursive). Returns array of objects.
  readAllJson: (dirRelPath) => ipcRenderer.invoke('fs:readAllJson', dirRelPath),

  // Delete a single file relative to the data directory.
  deleteFile: (relPath) => ipcRenderer.invoke('fs:deleteFile', relPath),

  // Ensure a directory exists (recursive mkdir).
  ensureDir: (relPath) => ipcRenderer.invoke('fs:ensureDir', relPath),

  // Absolute path to the data directory (for display/debugging).
  getDataDir: () => ipcRenderer.invoke('fs:getDataDir'),
});
