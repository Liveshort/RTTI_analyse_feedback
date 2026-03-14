const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rtti', {
  // Read a JSON file relative to the data directory.
  // relPath: e.g. 'config.json', '2025-2026/students.json', '2025-2026/scores/105455.json'
  readJson:       (relPath)        => ipcRenderer.invoke('fs:readJson', relPath),

  // Write a JSON file relative to the data directory.
  writeJson:      (relPath, data)  => ipcRenderer.invoke('fs:writeJson', relPath, data),

  // List all year subfolders (e.g. ['2025-2026', '2024-2025']), newest first.
  listYears:      ()               => ipcRenderer.invoke('fs:listYears'),

  // Create year folder + scores subfolder if they don't exist yet.
  ensureYear:     (year)           => ipcRenderer.invoke('fs:ensureYear', year),

  // List student IDs that have a score file for the given year.
  listScoreFiles: (year)           => ipcRenderer.invoke('fs:listScoreFiles', year),

  // Absolute path to the data directory (for display/debugging).
  getDataDir:     ()               => ipcRenderer.invoke('fs:getDataDir'),
});
