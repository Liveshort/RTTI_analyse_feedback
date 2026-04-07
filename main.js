const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

// ---------------------------------------------------------------------------
// Data directory: always next to the executable (or next to main.js in dev)
// ---------------------------------------------------------------------------
function getDataDir() {
  const base = app.isPackaged ? path.dirname(process.execPath) : __dirname;
  const dataDir = path.join(base, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

// ---------------------------------------------------------------------------
// File locking (simple .lock file mechanism for shared JSON files)
// ---------------------------------------------------------------------------
const LOCK_TTL_MS = 10000;

function acquireLock(filePath) {
  const lockPath = filePath + '.lock';
  if (fs.existsSync(lockPath)) {
    const stat = fs.statSync(lockPath);
    if (Date.now() - stat.mtimeMs < LOCK_TTL_MS) return false;
    fs.unlinkSync(lockPath);
  }
  fs.writeFileSync(lockPath, String(Date.now()));
  return true;
}

function releaseLock(filePath) {
  try {
    fs.unlinkSync(filePath + '.lock');
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

// Read any JSON file relative to the data directory.
// relPath: e.g. 'config.json', '2025-2026/students.json', '2025-2026/scores/105455.json'
ipcMain.handle('fs:readJson', (_event, relPath) => {
  const filePath = path.join(getDataDir(), relPath);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error('readJson error:', filePath, e.message);
    return null;
  }
});

// Write any JSON file relative to the data directory.
// Score files (inside a 'scores' folder) skip locking; everything else is locked.
ipcMain.handle('fs:writeJson', (_event, relPath, data) => {
  const filePath = path.join(getDataDir(), relPath);
  const isScore = relPath.includes('/scores/');

  if (isScore) {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  } else {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const acquired = acquireLock(filePath);
    if (!acquired) return { ok: false, reason: 'locked' };
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e.message };
    } finally {
      releaseLock(filePath);
    }
  }
});

// List all year subfolders (e.g. ['2024-2025', '2025-2026']), newest first.
ipcMain.handle('fs:listYears', () => {
  const dataDir = getDataDir();
  const YEAR_RE = /^\d{4}-\d{4}$/;
  try {
    return fs
      .readdirSync(dataDir)
      .filter((name) => {
        if (!YEAR_RE.test(name)) return false;
        return fs.statSync(path.join(dataDir, name)).isDirectory();
      })
      .sort((a, b) => b.localeCompare(a));
  } catch (_) {
    return [];
  }
});

// Ensure a year folder and all required subfolders exist.
const SUBJECTS = ['nat', 'bio', 'schk', 'wi'];
ipcMain.handle('fs:ensureYear', (_event, year) => {
  const yearDir = path.join(getDataDir(), year);
  fs.mkdirSync(path.join(yearDir, 'exams'), { recursive: true });
  fs.mkdirSync(path.join(yearDir, 'groups'), { recursive: true });
  for (const subj of SUBJECTS) {
    fs.mkdirSync(path.join(yearDir, 'scores', subj), { recursive: true });
  }
  return yearDir;
});

// List student IDs that have a score file for a given year + subject.
ipcMain.handle('fs:listScoreFiles', (_event, year, subject) => {
  const scoresDir = path.join(getDataDir(), year, 'scores', subject);
  if (!fs.existsSync(scoresDir)) return [];
  return fs
    .readdirSync(scoresDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''));
});

// Read all .json files directly in a directory (non-recursive); skips nulls and parse errors.
ipcMain.handle('fs:readAllJson', (_event, dirRelPath) => {
  const dir = path.join(getDataDir(), dirRelPath);
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.json')) continue;
    const entryPath = path.join(dir, entry);
    if (fs.statSync(entryPath).isDirectory()) continue;
    try {
      const data = JSON.parse(fs.readFileSync(entryPath, 'utf8'));
      if (data !== null && data !== undefined) results.push(data);
    } catch (_) {}
  }
  return results;
});

// Delete a single file relative to the data directory.
// Score files skip locking; all other files acquire lock first.
ipcMain.handle('fs:deleteFile', (_event, relPath) => {
  const filePath = path.join(getDataDir(), relPath);
  const isScore = relPath.includes('/scores/');
  if (isScore) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  } else {
    const acquired = acquireLock(filePath);
    if (!acquired) return { ok: false, reason: 'locked' };
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e.message };
    } finally {
      releaseLock(filePath);
    }
  }
});

// Ensure a directory exists (recursive mkdir).
ipcMain.handle('fs:ensureDir', (_event, relPath) => {
  fs.mkdirSync(path.join(getDataDir(), relPath), { recursive: true });
});

// Absolute path of data dir (for display/debugging).
ipcMain.handle('fs:getDataDir', () => getDataDir());

// ---------------------------------------------------------------------------
// Typst compiler
// ---------------------------------------------------------------------------
function getTypstBinary() {
  const exe = process.platform === 'win32' ? 'typst.exe' : 'typst';
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'typst', exe);
  }
  const platformDir = { win32: 'win', darwin: 'mac', linux: 'linux' }[process.platform];
  const archDir = process.arch === 'arm64' ? 'aarch64' : 'x_86_64';
  return path.join(__dirname, 'bin', 'typst', platformDir, archDir, exe);
}

// Smoke-test: returns { success, version } or { success: false, error }
ipcMain.handle('typst:version', () => {
  const bin = getTypstBinary();
  return new Promise((resolve) => {
    execFile(bin, ['--version'], (err, stdout) => {
      if (err) resolve({ success: false, error: err.message });
      else resolve({ success: true, version: stdout.trim() });
    });
  });
});

// Compile a .typ file to PDF.
// typFilePath: absolute path to the .typ source file
// outputPdfPath: absolute path for the output PDF
ipcMain.handle('typst:compile', (_event, typFilePath, outputPdfPath) => {
  const bin = getTypstBinary();
  return new Promise((resolve) => {
    execFile(bin, ['compile', typFilePath, outputPdfPath], (err, _stdout, stderr) => {
      if (err) resolve({ success: false, error: stderr || err.message });
      else resolve({ success: true, outputPdfPath });
    });
  });
});

// Compile the rtti_export.typ template with injected student data.
// examInfo: { name, global_max_points }
// students: [{ name, student_nr, group, score, max_score, grade, vragen: [...] }, ...]
// Writes a temporary wrapper .typ, compiles it, then deletes it.
ipcMain.handle('app:renderRapportPdf', (_event, _examId, students, examInfo) => {
  const bin = getTypstBinary();
  const appDir = app.isPackaged ? path.dirname(process.execPath) : __dirname;
  const tmpDir = path.join(appDir, 'temp');
  fs.mkdirSync(tmpDir, { recursive: true });

  // Recursively serialize a JS value to a Typst literal.
  function toTypst(val) {
    if (val === null || val === undefined) return 'none';
    if (typeof val === 'boolean') return val ? 'true' : 'false';
    if (typeof val === 'number') return isFinite(val) ? String(val) : '0';
    if (typeof val === 'string') {
      return '"' + val.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    }
    if (Array.isArray(val)) {
      if (val.length === 0) return '()';
      return '(' + val.map(toTypst).join(', ') + ',)';
    }
    if (typeof val === 'object') {
      const pairs = Object.entries(val).map(([k, v]) => `${k}: ${toTypst(v)}`);
      return '(' + pairs.join(', ') + ')';
    }
    return '"' + String(val) + '"';
  }

  // The wrapper imports setup + render, applies heading styles via #show: setup,
  // then calls render with the injected data.
  const wrapperContent =
    `#import "../include/templates/rtti_export.typ": setup, render\n\n` +
    `#let exam_info = ${toTypst(examInfo ?? {})}\n` +
    `#let student_data = ${toTypst(students ?? [])}\n\n` +
    `#show: setup\n` +
    `#render(exam_info, student_data)\n`;

  const wrapperPath = path.join(tmpDir, '_rapport_run.typ');
  const outputPdf = path.join(tmpDir, 'rapport_preview.pdf');
  fs.writeFileSync(wrapperPath, wrapperContent, 'utf8');

  return new Promise((resolve) => {
    execFile(bin, ['compile', '--root', appDir, wrapperPath, outputPdf], (err, _stdout, stderr) => {
      try {
        fs.unlinkSync(wrapperPath);
      } catch (_) {}
      if (err) resolve({ success: false, error: stderr || err.message });
      else resolve({ success: true, pdfPath: outputPdf });
    });
  });
});

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Maatwerk',
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (!app.isPackaged) win.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
