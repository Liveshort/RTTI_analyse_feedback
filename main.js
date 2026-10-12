const { app, BrowserWindow, ipcMain, shell, dialog, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { PDFDocument } = require('pdf-lib');
const { hashContent, readWithHash, writeFileAtomic, createWatcher } = require('./sync');

// Watches data/ for changes made by other teachers; created in app.whenReady().
let watcher = null;

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

// Read a JSON file together with the hash of its content, for compare-and-swap writes.
// Returns { data, hash } (both null if the file does not exist) or { error } if it
// exists but cannot be parsed — callers must not overwrite such a file.
ipcMain.handle('fs:readJsonVersioned', (_event, relPath) => {
  const filePath = path.join(getDataDir(), relPath);
  try {
    const file = readWithHash(filePath);
    if (!file) return { data: null, hash: null };
    return { data: JSON.parse(file.buf.toString('utf8')), hash: file.hash };
  } catch (e) {
    console.error('readJsonVersioned error:', filePath, e.message);
    return { error: e.message };
  }
});

// Write any JSON file relative to the data directory (atomically).
// Score files (inside a 'scores' folder) skip locking; everything else is locked.
// opts.cas: only write if the file's current hash equals opts.expectedHash
// (null = the file must not exist yet); otherwise returns reason 'conflict'.
ipcMain.handle('fs:writeJson', (_event, relPath, data, opts = {}) => {
  const filePath = path.join(getDataDir(), relPath);
  const isScore = relPath.includes('/scores/');

  const write = () => {
    if (opts.cas) {
      const current = readWithHash(filePath);
      if ((current?.hash ?? null) !== (opts.expectedHash ?? null)) {
        return { ok: false, reason: 'conflict' };
      }
    }
    const content = JSON.stringify(data, null, 2);
    writeFileAtomic(filePath, content);
    watcher?.noteWrite(relPath, content);
    return { ok: true, hash: hashContent(content) };
  };

  if (isScore) {
    try {
      return write();
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  } else {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const acquired = acquireLock(filePath);
    if (!acquired) return { ok: false, reason: 'locked' };
    try {
      return write();
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
      watcher?.noteDelete(relPath);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  } else {
    const acquired = acquireLock(filePath);
    if (!acquired) return { ok: false, reason: 'locked' };
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      watcher?.noteDelete(relPath);
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
  writeFileAtomic(abs, content);
  watcher?.noteWrite(relPath, content);
  return { ok: true };
});

// Copy the base_assignment.typ template to data/opdrachten/<typFile>.
ipcMain.handle('app:createAssignmentTypFile', (_event, typFile) => {
  const content = fs.readFileSync(path.join(getTemplatesDir(), 'base_assignment.typ'), 'utf8');
  writeFileAtomic(path.join(getDataDir(), 'opdrachten', typFile), content);
  watcher?.noteWrite(`opdrachten/${typFile}`, content);
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Opdracht images: data/opdrachten/images/<opdrachtId>/<name>.<ext>
// Opdracht files refer to them as image("images/<opdrachtId>/<file>") (Typst
// resolves paths relative to the opdracht file).
// ---------------------------------------------------------------------------
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'];
const pickedImages = new Map(); // token -> absolute path chosen in the file dialog
let pickSeq = 0;

function opdrachtImagesDir(opdrachtId, create = true) {
  if (!/^[\w-]+$/.test(String(opdrachtId ?? ''))) throw new Error('Ongeldige opdracht.');
  const dir = path.join(getDataDir(), 'opdrachten', 'images', opdrachtId);
  if (create) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// File-name-safe version of a name typed by the user ("Remweg auto!" -> "Remweg-auto").
function cleanImageName(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// Writes an image unless one with the same name (any extension) exists.
// Returns { ok, file, name } with file relative to data/opdrachten, or
// { ok: false, exists: true, name } / { ok: false, error }.
function storeOpdrachtImage(opdrachtId, rawName, ext, buffer, overwrite) {
  const name = cleanImageName(rawName);
  if (!name) return { ok: false, error: 'Geef de afbeelding een naam.' };
  ext = String(ext).toLowerCase();
  if (!IMAGE_EXTS.includes(ext))
    return { ok: false, error: `Bestandstype .${ext} wordt niet ondersteund.` };
  const dir = opdrachtImagesDir(opdrachtId);
  const existing = fs.readdirSync(dir).filter((f) => path.parse(f).name === name);
  if (existing.length && !overwrite) return { ok: false, exists: true, name };
  for (const f of existing) tryUnlink(path.join(dir, f)); // overwrite, maybe with another extension
  const file = `${name}.${ext}`;
  writeFileAtomic(path.join(dir, file), buffer);
  watcher?.noteWrite(`opdrachten/images/${opdrachtId}/${file}`, buffer);
  return { ok: true, file: `images/${opdrachtId}/${file}`, name };
}

// Images of one opdracht: [{ file, name, thumb }], thumb a small data URL (null for SVG).
ipcMain.handle('opdracht:listImages', (_event, opdrachtId) => {
  const dir = opdrachtImagesDir(opdrachtId, false);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => IMAGE_EXTS.includes(path.extname(f).slice(1).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'nl'))
    .map((f) => {
      const img = nativeImage.createFromPath(path.join(dir, f));
      return {
        file: `images/${opdrachtId}/${f}`,
        name: path.parse(f).name,
        thumb: img.isEmpty() ? null : img.resize({ height: 48 }).toDataURL(),
      };
    });
});

// Save a pasted image (base64) under the given name.
ipcMain.handle('opdracht:saveImage', (_event, opdrachtId, name, ext, base64, overwrite) =>
  storeOpdrachtImage(opdrachtId, name, ext, Buffer.from(String(base64), 'base64'), overwrite)
);

// Let the user choose an image file. Returns { token, name, ext } or null; the
// path itself stays here and is only used by importImage with that token.
ipcMain.handle('opdracht:pickImage', async (event) => {
  const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
    title: 'Afbeelding kiezen',
    filters: [{ name: 'Afbeeldingen', extensions: IMAGE_EXTS }],
    properties: ['openFile'],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const src = res.filePaths[0];
  const token = String(++pickSeq);
  pickedImages.set(token, src);
  const { name, ext } = path.parse(src);
  return { token, name: cleanImageName(name), ext: ext.slice(1).toLowerCase() };
});

// Copy the file chosen with pickImage into the opdracht's images folder.
ipcMain.handle('opdracht:importImage', (_event, opdrachtId, token, name, overwrite) => {
  const src = pickedImages.get(String(token));
  if (!src) return { ok: false, error: 'Kies de afbeelding opnieuw.' };
  const result = storeOpdrachtImage(
    opdrachtId,
    name,
    path.extname(src).slice(1),
    fs.readFileSync(src),
    overwrite
  );
  if (result.ok) pickedImages.delete(String(token));
  return result;
});

// The image on the system clipboard as base64 PNG, or null.
ipcMain.handle('clipboard:readImage', () => {
  const img = clipboard.readImage();
  return img.isEmpty() ? null : img.toPNG().toString('base64');
});

// Copy all images of one opdracht to another (when an opdracht is copied).
ipcMain.handle('opdracht:copyImages', (_event, fromId, toId) => {
  const from = opdrachtImagesDir(fromId, false);
  const to = opdrachtImagesDir(toId, false);
  if (!fs.existsSync(from)) return { ok: true };
  for (const f of fs.readdirSync(from)) {
    const buffer = fs.readFileSync(path.join(from, f));
    writeFileAtomic(path.join(to, f), buffer);
    watcher?.noteWrite(`opdrachten/images/${toId}/${f}`, buffer);
  }
  return { ok: true };
});

// Remove an opdracht's images folder (when the opdracht is deleted). The images
// go right away, but OneDrive keeps the emptied folder itself locked (EPERM)
// while it syncs the deletions, so the folder is retried in the background;
// whatever is still left is cleaned up on the next start (removeEmptyImageDirs).
const RMDIR_RETRY_MS = 5000;
const RMDIR_ATTEMPTS = 24; // ~2 minutes

function removeDirLater(dir, attempt = 1) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    if (attempt < RMDIR_ATTEMPTS)
      setTimeout(() => removeDirLater(dir, attempt + 1), RMDIR_RETRY_MS);
    else console.error(`[opdracht] could not remove ${dir}:`, e.message);
  }
}

ipcMain.handle('opdracht:deleteImages', (_event, opdrachtId) => {
  const dir = opdrachtImagesDir(opdrachtId, false);
  if (!fs.existsSync(dir)) return { ok: true };
  for (const f of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, f), { recursive: true, force: true, maxRetries: 5 });
  }
  removeDirLater(dir);
  return { ok: true };
});

// Remove empty image folders left behind by deletes that OneDrive blocked.
// Only empty ones: a folder with images may belong to a colleague's opdracht
// whose JSON hasn't synced yet.
function removeEmptyImageDirs() {
  const root = path.join(getDataDir(), 'opdrachten', 'images');
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    try {
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch (_) {}
  }
}

// ---------------------------------------------------------------------------
// Presence (data/users/<userId>.json): who is online and where they work.
// Only this app writes the logged-in user's file. On logout, a user switch or
// quit the file is marked offline so colleagues see them leave right away.
// ---------------------------------------------------------------------------
let presence = null; // { userId, state } as last written by this app

function writePresence(userId, state) {
  const rel = `users/${userId}.json`;
  const content = JSON.stringify(state, null, 2);
  try {
    writeFileAtomic(path.join(getDataDir(), rel), content);
    watcher?.noteWrite(rel, content);
  } catch (e) {
    console.error('[presence] write failed:', e.message);
  }
}

function markPresenceOffline() {
  if (!presence) return;
  writePresence(presence.userId, {
    ...presence.state,
    online: false,
    scoreModal: null,
    heartbeatAt: new Date().toISOString(),
  });
  presence = null;
}

// userId null = logged out.
ipcMain.handle('presence:update', (_event, userId, state) => {
  if (presence && presence.userId !== userId) markPresenceOffline();
  if (!userId) return;
  presence = { userId, state };
  writePresence(userId, state);
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

const typStr = (s) =>
  '"' +
  String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"') +
  '"';

// Header shown in the editor (preview and PDF), where no real student is involved.
// The observatie name is long on purpose, so authors see how a two-line header looks.
function placeholderHeader(title) {
  return {
    title,
    student: 'Leerling Voornaam Achternaam',
    group: 'Klas Z vak W',
    exam: 'Voorbeeldtoets Toetsweek X',
    observaties: [
      {
        icon: '❌',
        name: 'Een voorbeeldobservatie met een behoorlijk lange naam, zodat deze twee regels beslaat in het voorbeeld',
      },
    ],
  };
}

// Build the wrapper .typ that renders an opdracht.
// importPath: absolute Typst path (resolved against --root appDir) of the opdracht file.
// header: { title, student, group, exam, observaties: [{ icon, name }] }
// mode: 'student' (header + uitleg + opgaven [+ upside-down answers]) | 'answers' (answer key only)
// The opdracht file defines setup_extra(), render_uitleg() and render_opgaven(); the
// answers are collected by lib.typ from the #vraag markers in the document.
function buildAssignmentWrapper(
  importPath,
  header,
  { cursorMarker = false, includeAnswers = true, mode = 'student' } = {}
) {
  const imports =
    `#import "/data/opdrachten/lib.typ": setup, opdracht_header, antwoorden_header, ` +
    `antwoorden_lijst, antwoorden_omgekeerd\n` +
    `#import "${importPath}": setup_extra, render_uitleg, render_opgaven\n\n` +
    `#show: setup\n` +
    (cursorMarker ? CURSOR_FOREGROUND : '') +
    `#setup_extra()\n\n`;

  if (mode === 'answers') {
    return (
      imports +
      `#antwoorden_header(title: ${typStr(header.title)})\n\n` +
      // The answers come from the vraag markers, so the content is laid out
      // invisibly (taking no space) for them to exist in this document.
      `#place(hide[#render_uitleg() #render_opgaven()])\n` +
      `#antwoorden_lijst()\n`
    );
  }

  const obs = (header.observaties ?? [])
    .map((o) => `(icon: ${typStr(o.icon)}, name: ${typStr(o.name)}),`)
    .join(' ');

  return (
    imports +
    `#opdracht_header(\n` +
    `  title: ${typStr(header.title)},\n` +
    `  student: ${typStr(header.student)},\n` +
    `  group: ${typStr(header.group)},\n` +
    `  exam_prefix: "N.a.v.",\n` +
    `  exam: ${typStr(header.exam)},\n` +
    `  observaties: (${obs}),\n` +
    `)\n\n` +
    `#render_uitleg()\n\n` +
    `#pagebreak()\n\n` +
    `#render_opgaven()\n` +
    (includeAnswers ? `#antwoorden_omgekeerd()\n` : '')
  );
}

// Compile an opdracht .typ file to PDF.
// typFile: filename only (e.g. 'opdracht-1.typ'), relative to data/opdrachten/
// title: plain-text title rendered as a level-1 heading in the wrapper
// Returns { success, pdfPath } or { success: false, error }.
ipcMain.handle('app:renderAssignmentPdf', (_event, typFile, title) => {
  const bin = getTypstBinary();
  const appDir = getAppDir();
  const tmpDir = path.join(appDir, 'temp');
  fs.mkdirSync(tmpDir, { recursive: true });

  const wrapperContent = buildAssignmentWrapper(
    `/data/opdrachten/${typFile}`,
    placeholderHeader(title)
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

ipcMain.handle('app:renderAssignmentSvg', (_event, typFile, title, previewContent) => {
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
      placeholderHeader(title),
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
});

// Compile many opdrachten into one PDF (Opdrachten genereren / Antwoordsleutel).
// Every job is compiled on its own: opdracht files share function names and may
// contain labels, so several of them (or several copies) can't live in one Typst
// document. The resulting PDFs are merged with pdf-lib.
//   jobs: [{ key, typFile, label, header, mode }] in output order; jobs with the
//         same key (one student) are kept together. mode: 'student' | 'answers'.
//   opts: { includeAnswers, duplex, outputName }
//         duplex: every key starts on an odd page (blank pages are inserted).
// Progress is reported to the sender as 'assignment:progress' { done, total }.
// Returns { success, pdfPath, pages } or { success: false, error }.
const BATCH_PARALLEL = Math.max(2, Math.min(4, os.cpus().length - 1));
let batchSeq = 0;

function compileTypst(bin, appDir, wrapperPath, outputPdf) {
  return new Promise((resolve) => {
    execFile(
      bin,
      ['compile', '--root', appDir, wrapperPath, outputPdf],
      { maxBuffer: 10 * 1024 * 1024 },
      (err, _stdout, stderr) => resolve(err ? stderr || err.message : null)
    );
  });
}

ipcMain.handle('app:renderAssignmentBatch', async (event, jobs, opts = {}) => {
  const { includeAnswers = true, duplex = false, outputName = 'opdrachten.pdf' } = opts;
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return { success: false, error: 'Er is niets om te genereren.' };
  }
  for (const job of jobs) {
    if (!job.typFile || path.basename(job.typFile) !== job.typFile) {
      return { success: false, error: `Ongeldige bestandsnaam: ${job.typFile}` };
    }
  }
  if (path.basename(outputName) !== outputName) {
    return { success: false, error: `Ongeldige bestandsnaam: ${outputName}` };
  }

  const bin = getTypstBinary();
  const appDir = getAppDir();
  const tmpDir = path.join(appDir, 'temp');
  // The folder is kept between runs (deleting it on OneDrive gives EPERM).
  const runDir = path.join(tmpDir, 'opdrachten_run');
  fs.mkdirSync(runDir, { recursive: true });
  const prefix = `b${++batchSeq}-`;

  const pdfPaths = new Array(jobs.length);
  let next = 0;
  let done = 0;
  let failure = null;
  const report = () => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('assignment:progress', { done, total: jobs.length });
    }
  };

  async function worker() {
    while (!failure && next < jobs.length) {
      const i = next++;
      const job = jobs[i];
      const wrapperPath = path.join(runDir, `${prefix}${i}.typ`);
      const outputPdf = path.join(runDir, `${prefix}${i}.pdf`);
      fs.writeFileSync(
        wrapperPath,
        buildAssignmentWrapper(`/data/opdrachten/${job.typFile}`, job.header ?? {}, {
          includeAnswers,
          mode: job.mode,
        }),
        'utf8'
      );
      const error = await compileTypst(bin, appDir, wrapperPath, outputPdf);
      tryUnlink(wrapperPath);
      if (error) {
        failure = failure ?? `Fout in opdracht "${job.label ?? job.typFile}":\n\n${error}`;
        return;
      }
      pdfPaths[i] = outputPdf;
      done++;
      report();
    }
  }

  const cleanup = () => {
    for (const f of fs.readdirSync(runDir)) {
      if (f.startsWith(prefix)) tryUnlink(path.join(runDir, f));
    }
  };

  try {
    report();
    await Promise.all(Array.from({ length: Math.min(BATCH_PARALLEL, jobs.length) }, worker));
    if (failure) return { success: false, error: failure };

    const merged = await PDFDocument.create();
    let prevKey;
    for (let i = 0; i < jobs.length; i++) {
      if (duplex && i > 0 && jobs[i].key !== prevKey && merged.getPageCount() % 2 === 1) {
        const last = merged.getPage(merged.getPageCount() - 1);
        merged.addPage([last.getWidth(), last.getHeight()]);
      }
      prevKey = jobs[i].key;
      const src = await PDFDocument.load(fs.readFileSync(pdfPaths[i]));
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach((p) => merged.addPage(p));
    }

    const outputPdf = path.join(tmpDir, outputName);
    fs.writeFileSync(outputPdf, await merged.save());
    return { success: true, pdfPath: outputPdf, pages: merged.getPageCount() };
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    cleanup();
  }
});

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
    // Packaged builds take the icon embedded in the .exe; in dev the window would show Electron's.
    ...(!app.isPackaged && { icon: path.join(__dirname, 'build', 'icon.ico') }),
  });
  win.removeMenu();
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

  // Always keep lib.typ in sync with the app — it is app-managed, not teacher-edited.
  // Only write when it differs, so a startup doesn't show up as a change for everyone.
  const libSrc = fs.readFileSync(path.join(getTemplatesDir(), 'lib.typ'));
  const libDest = path.join(dataDir, 'opdrachten', 'lib.typ');
  if (readWithHash(libDest)?.hash !== hashContent(libSrc)) {
    writeFileAtomic(libDest, libSrc);
  }

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
  fs.mkdirSync(path.join(dataDir, 'opdrachten', 'images'), { recursive: true });
  removeEmptyImageDirs();
}

app.whenReady().then(() => {
  seedInitialData();
  cleanupStalePreviewFiles();
  watcher = createWatcher(getDataDir(), {
    onChanges: (changes) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('data:changed', changes);
      }
    },
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('before-quit', markPresenceOffline);
app.on('window-all-closed', () => {
  markPresenceOffline();
  watcher?.close();
  if (process.platform !== 'darwin') app.quit();
});
