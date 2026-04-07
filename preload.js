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

  // Typst compiler — returns { success, version } or { success: false, error }
  typstVersion: () => ipcRenderer.invoke('typst:version'),

  // Compile a .typ file to a PDF.
  // typFilePath and outputPdfPath must be absolute paths.
  compileTypst: (typFilePath, outputPdfPath) =>
    ipcRenderer.invoke('typst:compile', typFilePath, outputPdfPath),

  // Compile the rtti_export.typ template with injected data.
  // examInfo: { name: string }, students: [{ name, student_nr, group, score, max_score, grade }, ...]
  // Returns { success, pdfPath } or { success: false, error }.
  renderRapportPdf: (examId, students, examInfo) =>
    ipcRenderer.invoke('app:renderRapportPdf', examId, students, examInfo),
});
