/**
 * presence.js — Which colleagues are using the app right now, and where.
 *
 * Own state is written to data/users/<userId>.json (via main.js): a heartbeat
 * every 15 s, right away when the score modal opens or closes, and at most
 * every 5 s for cursor moves and score edits inside it. Colleagues' files
 * arrive as 'presence' sync events.
 *
 * Timing is judged by when THIS PC received a change, not by the timestamps
 * in the files (the other PC's clock may be off). Only at startup, before any
 * change has been received, the file timestamps are used.
 *
 *   online  — a heartbeat was received in the last 60 s
 *   'active' — they also edited a score in the last 120 s (green)
 *   'idle'   — online, but no recent edit (orange)
 */
import * as Sync from './sync.js';
import { escHtml } from './app.js';

const HEARTBEAT_MS = 15000;
const CHANGE_WRITE_MS = 5000;
const OFFLINE_AFTER_MS = 60000;
const ACTIVE_EDIT_MS = 120000;
const TICK_MS = 5000;

let me = null; // logged-in user id
let own = { scoreModal: null };
let heartbeatTimer = null;
let writeTimer = null;
let lastWriteAt = 0;

// userId -> { state, seenAt, editSeenAt }  (local times)
const remote = new Map();
const listeners = new Set();
let lastSummary = '';

// ── Own state ──────────────────────────────────────────────────────────────

function write() {
  clearTimeout(writeTimer);
  writeTimer = null;
  if (!me) return;
  lastWriteAt = Date.now();
  window.rtti.updatePresence(me, {
    userId: me,
    online: true,
    heartbeatAt: new Date().toISOString(),
    scoreModal: own.scoreModal,
  });
}

// Write soon, but not more often than once per CHANGE_WRITE_MS.
function writeSoon() {
  if (writeTimer) return;
  const wait = Math.max(0, lastWriteAt + CHANGE_WRITE_MS - Date.now());
  writeTimer = setTimeout(write, wait);
}

/** Start publishing presence for the user who just logged in. */
export async function start(userId) {
  stop();
  me = userId;
  own = { scoreModal: null };
  write();
  heartbeatTimer = setInterval(write, HEARTBEAT_MS);
  const all = (await window.rtti.readAllJson('users')) ?? [];
  for (const state of all) receive(state, true);
  notify();
}

/** Stop publishing (logout); main.js marks the user's file offline. */
export function stop() {
  clearInterval(heartbeatTimer);
  clearTimeout(writeTimer);
  heartbeatTimer = writeTimer = null;
  if (me) window.rtti.updatePresence(null);
  me = null;
  own = { scoreModal: null };
  remote.clear();
  lastSummary = '';
}

/** The score modal for { year, subject, examId } was opened (or closed: null). */
export function setScoreModal(info) {
  own.scoreModal = info ? { ...info, cell: null, lastEditAt: null } : null;
  write();
}

/** The cursor in the score modal moved. questionId: question id or 'obs:<obsId>'. */
export function setPosition(studentId, questionId) {
  const sm = own.scoreModal;
  if (!sm) return;
  if (sm.cell?.studentId === String(studentId) && sm.cell?.questionId === questionId) return;
  sm.cell = { studentId: String(studentId), questionId };
  writeSoon();
}

/** A score or observation was entered in the score modal. */
export function markEdit() {
  if (!own.scoreModal) return;
  own.scoreModal.lastEditAt = new Date().toISOString();
  writeSoon();
}

// ── Colleagues ─────────────────────────────────────────────────────────────

function receive(state, initial) {
  if (!state?.userId || state.userId === me) return;
  const prev = remote.get(state.userId);
  const now = Date.now();
  const fileTime = (iso) => Math.min(now, Date.parse(iso) || 0);
  let seenAt = initial ? fileTime(state.heartbeatAt) : now;
  if (state.online === false) seenAt = 0;
  let editSeenAt = prev?.editSeenAt ?? 0;
  const lastEdit = state.scoreModal?.lastEditAt ?? null;
  if (lastEdit && lastEdit !== prev?.state?.scoreModal?.lastEditAt) {
    editSeenAt = initial ? fileTime(lastEdit) : now;
  }
  remote.set(state.userId, { state, seenAt, editSeenAt });
}

Sync.on('presence', (ev) => {
  if (!me) return;
  if (ev.after) receive(ev.after, false);
  else remote.delete(ev.id);
  notify();
});

// Statuses change with time alone (going idle / offline), so re-check regularly.
setInterval(() => {
  if (me) notify();
}, TICK_MS);

/** Colleagues online right now: [{ userId, status, scoreModal }]. */
export function online() {
  const now = Date.now();
  const out = [];
  for (const [userId, r] of remote) {
    if (now - r.seenAt > OFFLINE_AFTER_MS) continue;
    const active = r.editSeenAt && now - r.editSeenAt < ACTIVE_EDIT_MS;
    out.push({
      userId,
      status: active ? 'active' : 'idle',
      scoreModal: r.state.scoreModal ?? null,
    });
  }
  return out.sort((a, b) => a.userId.localeCompare(b.userId));
}

/** Colleagues that have the score modal of this exam open. */
export function inScoreModal(year, subject, examId) {
  return online().filter(
    (o) =>
      o.scoreModal?.year === year &&
      o.scoreModal?.subject === subject &&
      o.scoreModal?.examId === examId
  );
}

/** Call fn whenever who is online, where, or their status changes. Returns unsubscribe. */
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  const summary = JSON.stringify(online());
  if (summary === lastSummary) return;
  lastSummary = summary;
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch (e) {
      console.error('[presence] listener failed', e);
    }
  }
}

// ── Display ────────────────────────────────────────────────────────────────

/** Initials badge of a colleague with a green (active) or orange (idle) ring. */
export function badgeHtml(user, status, title) {
  const initials = user.afkorting || user.voornaam?.[0] || '?';
  const shape = user.isAdmin ? 'badge-square' : 'badge-circle';
  return (
    `<span class="user-badge-mini ${shape} presence-badge presence-${status}" ` +
    `data-len="${initials.length}" style="--badge-color:${escHtml(user.kleur ?? '#888')}" ` +
    `title="${escHtml(title)}">${escHtml(initials)}</span>`
  );
}
