const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

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
  try { fs.unlinkSync(filePath + '.lock'); } catch (_) {}
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
  const isScore  = relPath.includes('/scores/');

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
    return fs.readdirSync(dataDir)
      .filter(name => {
        if (!YEAR_RE.test(name)) return false;
        return fs.statSync(path.join(dataDir, name)).isDirectory();
      })
      .sort((a, b) => b.localeCompare(a));
  } catch (_) { return []; }
});

// Ensure a year folder (and its scores subfolder) exist.
ipcMain.handle('fs:ensureYear', (_event, year) => {
  const yearDir = path.join(getDataDir(), year);
  fs.mkdirSync(path.join(yearDir, 'scores'), { recursive: true });
  return yearDir;
});

// List student IDs that have a score file for a given year.
ipcMain.handle('fs:listScoreFiles', (_event, year) => {
  const scoresDir = path.join(getDataDir(), year, 'scores');
  if (!fs.existsSync(scoresDir)) return [];
  return fs.readdirSync(scoresDir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));
});

// Absolute path of data dir (for display/debugging).
ipcMain.handle('fs:getDataDir', () => getDataDir());

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'RTTI App',
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (!app.isPackaged) win.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
