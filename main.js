const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

// ---------------------------------------------------------------------------
// App directory: next to the executable (or next to main.js in dev).
// The portable build extracts itself to a temp folder, so use the folder
// the portable .exe was launched from instead.
// ---------------------------------------------------------------------------
function getAppDir() {
  if (!app.isPackaged) return __dirname;
  return process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
}

function getDataDir() {
  const dataDir = path.join(getAppDir(), 'data');
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

// Read a plain text file relative to the data directory.
ipcMain.handle('fs:readTextFile', (_event, relPath) => {
  const abs = path.join(getDataDir(), relPath);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, 'utf8');
});

// Write a plain text file relative to the data directory (creates dirs if needed).
ipcMain.handle('fs:writeTextFile', (_event, relPath, content) => {
  const abs = path.join(getDataDir(), relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  return { ok: true };
});

// Copy the base_assignment.typ template to data/opdrachten/<typFile>.
ipcMain.handle('app:createAssignmentTypFile', (_event, typFile) => {
  const src = path.join(getTemplatesDir(), 'base_assignment.typ');
  const dest = path.join(getDataDir(), 'opdrachten', typFile);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Local session (machine-local, not synced via OneDrive)
// Stored in app.getPath('userData'), outside the shared data/ folder.
// ---------------------------------------------------------------------------
function getSessionPath() {
  return path.join(app.getPath('userData'), 'session.json');
}

ipcMain.handle('fs:readLocalSession', () => {
  const p = getSessionPath();
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
});

ipcMain.handle('fs:writeLocalSession', (_event, data) => {
  fs.writeFileSync(getSessionPath(), JSON.stringify(data, null, 2), 'utf8');
});

// ---------------------------------------------------------------------------
// User photo helpers (stored in data/fotos/)
// ---------------------------------------------------------------------------
ipcMain.handle('fs:readPhotoAsDataUrl', (_event, relPath) => {
  const abs = path.join(getDataDir(), relPath);
  if (!fs.existsSync(abs)) return null;
  try {
    const buf = fs.readFileSync(abs);
    const ext = path.extname(abs).slice(1).toLowerCase();
    const mimeMap = {
      png: 'image/png',
      svg: 'image/svg+xml',
      gif: 'image/gif',
      webp: 'image/webp',
    };
    const mime = mimeMap[ext] ?? 'image/jpeg';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (_) {
    return null;
  }
});

ipcMain.handle('fs:savePhoto', (_event, relPath, base64Data) => {
  const abs = path.join(getDataDir(), relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Buffer.from(base64Data, 'base64'));
});

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
  const appDir = getAppDir();
  const tmpDir = path.join(appDir, 'temp');
  fs.mkdirSync(tmpDir, { recursive: true });
  // Copy the template next to the wrapper: Typst can only read files under --root (appDir).
  fs.copyFileSync(
    path.join(getTemplatesDir(), 'rtti_export.typ'),
    path.join(tmpDir, 'rtti_export.typ')
  );

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
    `#import "rtti_export.typ": setup, render\n\n` +
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

// Draws an invisible link at the position of the <__rtti_cursor> metadata marker
// on each page, so the renderer can locate the editor cursor in the SVG output.
const CURSOR_FOREGROUND =
  `#set page(foreground: context {\n` +
  `  for m in query(<__rtti_cursor>).filter(m => m.location().page() == here().page()) {\n` +
  `    let p = m.location().position()\n` +
  `    place(top + left, dx: p.x, dy: p.y, link("rtti-cursor:")[#box(width: 1pt, height: 1em)])\n` +
  `  }\n` +
  `})\n`;

// Build the wrapper .typ that renders an opdracht.
// importPath: absolute Typst path (resolved against --root appDir) of the opdracht file.
function buildAssignmentWrapper(
  importPath,
  title,
  obsIcon,
  obsName,
  { cursorMarker = false } = {}
) {
  const esc = (s) => (s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const escTitle = esc(title);
  const escObsIcon = esc(obsIcon ?? '❌');
  const escObsName = esc(obsName ?? 'Geen observatie');

  return (
    `#import "/data/opdrachten/lib.typ": setup, opdracht_header\n` +
    `#import "${importPath}": setup_extra, render_uitleg, render_opgaven, render_antwoorden\n\n` +
    `#show: setup\n` +
    (cursorMarker ? CURSOR_FOREGROUND : '') +
    `#setup_extra()\n\n` +
    `#opdracht_header(\n` +
    `  title: "${escTitle}",\n` +
    `  student: "Sandra Jansen",\n` +
    `  group: "4A",\n` +
    `  exam_prefix: "N.a.v.",\n` +
    `  exam: "TW1 H1 Vaardigheden",\n` +
    `  obs_icon: "${escObsIcon}",\n` +
    `  obs_name: "${escObsName}",\n` +
    `)\n\n` +
    `== Uitleg\n` +
    `#render_uitleg()\n\n` +
    `#pagebreak()\n\n` +
    `== Opgaven\n` +
    `#render_opgaven()\n\n` +
    `== Antwoorden\n` +
    `#render_antwoorden()\n`
  );
}

// Compile an opdracht .typ file to PDF.
// typFile: filename only (e.g. 'opdracht-1.typ'), relative to data/opdrachten/
// title: plain-text title rendered as a level-1 heading in the wrapper
// Returns { success, pdfPath } or { success: false, error }.
ipcMain.handle('app:renderAssignmentPdf', (_event, typFile, title, obsIcon, obsName) => {
  const bin = getTypstBinary();
  const appDir = getAppDir();
  const tmpDir = path.join(appDir, 'temp');
  fs.mkdirSync(tmpDir, { recursive: true });

  const wrapperContent = buildAssignmentWrapper(
    `/data/opdrachten/${typFile}`,
    title,
    obsIcon,
    obsName
  );

  const wrapperPath = path.join(tmpDir, '_assignment_run.typ');
  const outputPdf = path.join(tmpDir, 'assignment_preview.pdf');
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

// Compile an opdracht to SVG pages for the live editor preview.
// previewContent: current editor text, possibly containing a <__rtti_cursor> marker.
// It is written to a temporary sibling copy (_preview_<typFile>) so relative
// imports and images keep resolving; the copy is deleted after compiling.
// Returns { success, pages: [svgString, ...] } or { success: false, error }.
const PREVIEW_PREFIX = '_preview_';
let svgRenderSeq = 0;

function tryUnlink(p) {
  try {
    fs.unlinkSync(p);
  } catch (_) {}
}

ipcMain.handle(
  'app:renderAssignmentSvg',
  (_event, typFile, title, obsIcon, obsName, previewContent) => {
    if (!typFile || path.basename(typFile) !== typFile) {
      return { success: false, error: `Ongeldige bestandsnaam: ${typFile}` };
    }

    const bin = getTypstBinary();
    const appDir = getAppDir();
    const tmpDir = path.join(appDir, 'temp');
    // The folder is kept (deleting it on OneDrive gives EPERM); every render
    // uses its own file prefix, so leftovers can never show up as stale pages.
    const svgDir = path.join(tmpDir, 'svg_preview');
    fs.mkdirSync(svgDir, { recursive: true });
    const runPrefix = `r${++svgRenderSeq}-`;
    for (const f of fs.readdirSync(svgDir)) tryUnlink(path.join(svgDir, f));

    const previewName = PREVIEW_PREFIX + typFile;
    const previewPath = path.join(getDataDir(), 'opdrachten', previewName);
    const wrapperPath = path.join(tmpDir, '_assignment_svg_run.typ');
    try {
      fs.writeFileSync(previewPath, previewContent ?? '', 'utf8');
      const wrapperContent = buildAssignmentWrapper(
        `/data/opdrachten/${previewName}`,
        title,
        obsIcon,
        obsName,
        { cursorMarker: true }
      );
      fs.writeFileSync(wrapperPath, wrapperContent, 'utf8');
    } catch (e) {
      tryUnlink(previewPath);
      return { success: false, error: e.message };
    }

    const outputPattern = path.join(svgDir, `${runPrefix}p{p}.svg`);
    const pageRe = new RegExp(`^${runPrefix}p(\\d+)\\.svg$`);

    return new Promise((resolve) => {
      execFile(
        bin,
        ['compile', '--root', appDir, wrapperPath, outputPattern],
        { maxBuffer: 10 * 1024 * 1024 },
        (err, _stdout, stderr) => {
          tryUnlink(wrapperPath);
          tryUnlink(previewPath);
          if (err) {
            // Show the real filename instead of the temporary preview copy.
            const error = (stderr || err.message).split(previewName).join(typFile);
            resolve({ success: false, error });
            return;
          }
          try {
            const files = fs
              .readdirSync(svgDir)
              .map((f) => pageRe.exec(f))
              .filter(Boolean)
              .sort((a, b) => Number(a[1]) - Number(b[1]))
              .map((m) => path.join(svgDir, m[0]));
            const pages = files.map((f) => fs.readFileSync(f, 'utf8'));
            files.forEach(tryUnlink);
            resolve({ success: true, pages });
          } catch (e) {
            resolve({ success: false, error: e.message });
          }
        }
      );
    });
  }
);

// Remove preview copies left behind by a crash mid-compile.
function cleanupStalePreviewFiles() {
  const dir = path.join(getDataDir(), 'opdrachten');
  if (!fs.existsSync(dir)) return;
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const f of fs.readdirSync(dir)) {
    if (!f.startsWith(PREVIEW_PREFIX) || !f.endsWith('.typ')) continue;
    const p = path.join(dir, f);
    try {
      if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
    } catch (_) {}
  }
}

// Open a file with the system default application (e.g. PDF in Acrobat/Edge).
ipcMain.handle('shell:openPath', (_event, absPath) => shell.openPath(absPath));

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

// Templates ship with the app (inside the extracted temp folder for the portable build).
function getTemplatesDir() {
  const base = app.isPackaged ? path.dirname(process.execPath) : __dirname;
  return path.join(base, 'include', 'templates');
}

function seedInitialData() {
  const dataDir = getDataDir();

  // Always overwrite lib.typ — it is app-managed, not teacher-edited.
  const opdrachtenDir = path.join(dataDir, 'opdrachten');
  fs.mkdirSync(opdrachtenDir, { recursive: true });
  fs.copyFileSync(path.join(getTemplatesDir(), 'lib.typ'), path.join(opdrachtenDir, 'lib.typ'));

  const gebruikersPath = path.join(dataDir, 'gebruikers.json');
  if (!fs.existsSync(gebruikersPath)) {
    fs.writeFileSync(
      gebruikersPath,
      JSON.stringify(
        [
          {
            id: 'admin',
            voornaam: 'Administrator',
            tussenvoegsel: '',
            achternaam: '',
            afkorting: 'ADM',
            vakken: ['nat', 'bio', 'schk', 'wi'],
            kleur: '#c0392b',
            foto: null,
            isAdmin: true,
            actief: true,
          },
        ],
        null,
        2
      )
    );
  }
  fs.mkdirSync(path.join(dataDir, 'fotos'), { recursive: true });
}

app.whenReady().then(() => {
  seedInitialData();
  cleanupStalePreviewFiles();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
