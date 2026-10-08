// ---------------------------------------------------------------------------
// sync.js — Change detection and safe writes for the shared (OneDrive) data folder.
//
// - writeFileAtomic: write to a temp file, then rename over the target, so
//   neither OneDrive nor another app instance ever reads a half-written file.
// - createWatcher: reports files that changed on disk by someone else.
//   fs.watch gives fast notifications; a periodic poll catches events that
//   OneDrive occasionally swallows. Own writes are recorded via noteWrite()
//   so they are never reported back as external changes.
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEBOUNCE_MS = 500;
const FLUSH_MS = 100;
const POLL_MS = 20000;
const RESTART_WATCH_MS = 30000;

// Top-level folders inside data/ that never contain shared app data.
const IGNORED_DIRS = new Set(['fotos', 'bak', 'templates', 'temp']);
const WATCHED_EXT = new Set(['.json', '.typ']);

function hashContent(bufOrString) {
  return crypto.createHash('sha1').update(bufOrString).digest('hex');
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Read a file and its content hash. Returns null if the file does not exist.
function readWithHash(filePath) {
  let buf;
  try {
    buf = fs.readFileSync(filePath);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  return { buf, hash: hashContent(buf) };
}

function writeFileAtomic(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  // OneDrive or a virus scanner can briefly hold the target open; retry the rename.
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, filePath);
      return;
    } catch (e) {
      if (attempt < 5 && ['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) {
        sleepSync(30 * (attempt + 1));
        continue;
      }
      // Last resort: a direct write is better than losing the change.
      try {
        fs.unlinkSync(tmp);
      } catch (_) {}
      fs.writeFileSync(filePath, content, 'utf8');
      return;
    }
  }
}

function toRel(p) {
  return p.split(path.sep).join('/');
}

function isRelevant(rel) {
  const parts = rel.split('/');
  if (IGNORED_DIRS.has(parts[0])) return false;
  const base = parts[parts.length - 1];
  if (base.startsWith('_preview_')) return false;
  return WATCHED_EXT.has(path.extname(base).toLowerCase());
}

/**
 * Watch dataDir for changes made by other app instances (via OneDrive).
 * onChanges receives a batch: [{ relPath, kind: 'added'|'changed'|'deleted', meta }]
 * where meta is the file's _meta block (JSON object files only), or null.
 */
function createWatcher(dataDir, { onChanges }) {
  // relPath -> { mtimeMs, size, hash? }  (hash is filled in lazily)
  const known = new Map();
  const pending = new Map();
  let batch = [];
  let flushTimer = null;
  let fsWatcher = null;
  let pollTimer = null;

  function walk(relDir, visit) {
    let entries;
    try {
      entries = fs.readdirSync(path.join(dataDir, relDir), { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!relDir && IGNORED_DIRS.has(entry.name)) continue;
        walk(rel, visit);
      } else if (isRelevant(rel)) {
        visit(rel);
      }
    }
  }

  function statOf(rel) {
    try {
      const st = fs.statSync(path.join(dataDir, rel));
      return { mtimeMs: st.mtimeMs, size: st.size };
    } catch (_) {
      return null;
    }
  }

  function emit(change) {
    batch.push(change);
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        const out = batch;
        batch = [];
        flushTimer = null;
        onChanges(out);
      }, FLUSH_MS);
    }
  }

  function check(rel, retried = false) {
    const prev = known.get(rel);
    let file;
    try {
      file = readWithHash(path.join(dataDir, rel));
    } catch (_) {
      return; // Unreadable right now (locked); the next event or poll retries.
    }
    if (!file) {
      if (prev) {
        known.delete(rel);
        emit({ relPath: rel, kind: 'deleted', meta: null });
      }
      return;
    }
    const st = statOf(rel);
    if (prev) {
      const same = prev.hash
        ? prev.hash === file.hash
        : st && prev.mtimeMs === st.mtimeMs && prev.size === st.size;
      if (same) {
        known.set(rel, { ...st, hash: file.hash });
        return;
      }
    }

    let meta = null;
    if (rel.endsWith('.json')) {
      try {
        const data = JSON.parse(file.buf.toString('utf8'));
        meta = data && !Array.isArray(data) ? (data._meta ?? null) : null;
      } catch (_) {
        // Probably still being synced; look again shortly.
        if (!retried) setTimeout(() => check(rel, true), 1000);
        return;
      }
    }
    known.set(rel, { ...st, hash: file.hash });
    emit({ relPath: rel, kind: prev ? 'changed' : 'added', meta });
  }

  function schedule(rel) {
    clearTimeout(pending.get(rel));
    pending.set(
      rel,
      setTimeout(() => {
        pending.delete(rel);
        check(rel);
      }, DEBOUNCE_MS)
    );
  }

  function activeYear() {
    try {
      return JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8')).activeYear;
    } catch (_) {
      return null;
    }
  }

  // Compare mtime/size of everything in scope; schedule a check for anything that differs.
  function poll() {
    const year = activeYear();
    const inScope = (rel) => {
      const first = rel.split('/')[0];
      return !rel.includes('/') || first === year || !/^\d{4}-\d{4}$/.test(first);
    };
    const seen = new Set();
    const visit = (rel) => {
      seen.add(rel);
      const st = statOf(rel);
      const prev = known.get(rel);
      if (!st) return;
      if (!prev || prev.mtimeMs !== st.mtimeMs || prev.size !== st.size) schedule(rel);
    };
    for (const entry of fs.readdirSync(dataDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        if (/^\d{4}-\d{4}$/.test(entry.name) && entry.name !== year) continue;
        walk(entry.name, visit);
      } else if (isRelevant(entry.name)) {
        visit(entry.name);
      }
    }
    for (const rel of known.keys()) {
      if (inScope(rel) && !seen.has(rel)) schedule(rel);
    }
  }

  function startFsWatch() {
    try {
      fsWatcher = fs.watch(dataDir, { recursive: true }, (_evt, filename) => {
        if (!filename) return;
        const rel = toRel(filename);
        if (isRelevant(rel)) schedule(rel);
      });
      fsWatcher.on('error', (e) => {
        console.error('[sync] fs.watch error, relying on polling:', e.message);
        fsWatcher.close();
        fsWatcher = null;
        setTimeout(startFsWatch, RESTART_WATCH_MS);
      });
    } catch (e) {
      console.error('[sync] fs.watch unavailable, relying on polling:', e.message);
    }
  }

  // Initial snapshot (mtime/size only; hashes are computed when something changes).
  walk('', (rel) => {
    const st = statOf(rel);
    if (st) known.set(rel, st);
  });
  startFsWatch();
  pollTimer = setInterval(() => {
    try {
      poll();
    } catch (e) {
      console.error('[sync] poll failed:', e.message);
    }
  }, POLL_MS);

  return {
    // Record a write made by this instance so it is not reported as external.
    noteWrite(rel, content) {
      const st = statOf(rel);
      if (st) known.set(rel, { ...st, hash: hashContent(content) });
    },
    noteDelete(rel) {
      known.delete(rel);
    },
    close() {
      clearInterval(pollTimer);
      fsWatcher?.close();
    },
  };
}

module.exports = { hashContent, readWithHash, writeFileAtomic, createWatcher };
