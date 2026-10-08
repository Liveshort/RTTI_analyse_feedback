/**
 * sync.js — Routes changes made by other teachers (reported by the file watcher
 * in main.js) to the parts of the UI that care about them.
 *
 * Each changed file first brings the Store cache up to date
 * (Store.applyExternalChange), then every subscriber of that change type is
 * called with the change description:
 *
 *   { type, kind, relPath, year, subject, id, before, after, meta, inScope }
 *
 * Screens and modals subscribe when they are built and unsubscribe when they
 * are torn down:
 *
 *   const off = Sync.on('scores', (ev) => { ... });   // later: off();
 *
 * Type '*' receives every change.
 */

const handlers = new Map(); // type -> Set<handler>
let started = false;

export function on(type, handler) {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type).add(handler);
  return () => handlers.get(type)?.delete(handler);
}

function dispatch(ev) {
  for (const type of [ev.type, '*']) {
    for (const handler of [...(handlers.get(type) ?? [])]) {
      try {
        handler(ev);
      } catch (e) {
        console.error('[sync] handler failed for', ev.relPath, e);
      }
    }
  }
}

// Changes are processed one at a time, in the order the watcher reported them.
let queue = Promise.resolve();

export function start() {
  if (started) return;
  started = true;
  window.rtti.onDataChanged((changes) => {
    for (const change of changes) {
      queue = queue.then(async () => {
        try {
          const ev = await Store.applyExternalChange(change);
          console.debug('[sync]', ev.kind, ev.relPath, ev.inScope ? '(in scope)' : '');
          dispatch(ev);
        } catch (e) {
          console.error('[sync] could not process', change.relPath, e);
        }
      });
    }
  });
}
