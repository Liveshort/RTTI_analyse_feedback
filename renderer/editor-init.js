/**
 * editor-init.js — CodeMirror 6 setup for the Typst assignment editor.
 *
 * Loaded as an ES module inside editor.html (which runs inside the #editor-frame
 * iframe). Does NOT have access to window.rtti directly; all file I/O and
 * compilation is done by posting messages to the parent window, which proxies
 * the calls via modals/editor.js.
 *
 * Imports from esm.sh, which deduplicates shared peer dependencies (e.g.
 * @codemirror/state) across packages — preventing the "multiple instances"
 * instanceof error that occurs when using separate jsdelivr ESM bundles.
 */

import { EditorState } from 'https://esm.sh/@codemirror/state@6';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
} from 'https://esm.sh/@codemirror/view@6';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  toggleComment,
} from 'https://esm.sh/@codemirror/commands@6';
import {
  StreamLanguage,
  syntaxHighlighting,
  defaultHighlightStyle,
  indentOnInput,
  bracketMatching,
} from 'https://esm.sh/@codemirror/language@6';

// ── postMessage bridge ────────────────────────────────────────────────────────

let _seq = 0;
const _pending = {};

function postToParent(type, data = {}) {
  return new Promise((resolve) => {
    const id = ++_seq;
    _pending[id] = resolve;
    window.parent.postMessage({ type, id, ...data }, '*');
  });
}

window.addEventListener('message', (evt) => {
  const msg = evt.data;
  if (msg?.type === 'rtti-response' && _pending[msg.id]) {
    _pending[msg.id](msg.result);
    delete _pending[msg.id];
  }
});

// ── Typst StreamLanguage definition ──────────────────────────────────────────

const typstLanguage = StreamLanguage.define({
  name: 'typst',
  languageData: { commentTokens: { line: '//' } },
  startState: () => ({
    inBlockComment: false,
    inMath: false,
    awaitUnderlineBracket: false,
    underlineDepth: 0,
  }),

  token(stream, state) {
    // Underline: waiting for [ after #underline
    if (state.awaitUnderlineBracket) {
      if (stream.eatSpace()) return null;
      state.awaitUnderlineBracket = false;
      if (stream.peek() === '[') {
        stream.next();
        state.underlineDepth = 1;
        return 'underline';
      }
    }

    // Underline: inside #underline[…]
    if (state.underlineDepth > 0) {
      if (stream.peek() === '[') {
        stream.next();
        state.underlineDepth++;
        return 'underline';
      }
      if (stream.peek() === ']') {
        stream.next();
        state.underlineDepth--;
        return 'underline';
      }
      while (!stream.eol() && stream.peek() !== '[' && stream.peek() !== ']') stream.next();
      return 'underline';
    }

    // Block comment
    if (state.inBlockComment) {
      if (stream.match('*/')) {
        state.inBlockComment = false;
      } else {
        stream.next();
      }
      return 'comment';
    }

    // Line comment
    if (stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }

    // Block comment start
    if (stream.match('/*')) {
      state.inBlockComment = true;
      return 'comment';
    }

    // Math mode toggle $...$
    if (stream.peek() === '$') {
      stream.next();
      if (state.inMath) {
        state.inMath = false;
        return 'meta';
      }
      state.inMath = true;
      return 'meta';
    }
    if (state.inMath) {
      stream.next();
      return 'meta';
    }

    // Raw string blocks (backtick)
    if (stream.peek() === '`') {
      stream.next();
      while (!stream.eol() && stream.peek() !== '`') stream.next();
      if (!stream.eol()) stream.next();
      return 'string';
    }

    // String literals
    if (stream.peek() === '"') {
      stream.next();
      while (!stream.eol() && stream.peek() !== '"') {
        if (stream.peek() === '\\') stream.next();
        stream.next();
      }
      if (!stream.eol()) stream.next();
      return 'string';
    }

    // Headings at the start of a line: = / == / ===
    if (stream.sol() && stream.match(/^={1,3}\s/)) {
      stream.skipToEnd();
      return 'heading';
    }

    // Typst keywords/functions: #identifier
    if (stream.peek() === '#') {
      stream.next();
      if (stream.match(/^underline(?![a-zA-Z0-9_])/)) {
        state.awaitUnderlineBracket = true;
        return 'keyword';
      }
      if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/)) {
        return 'keyword';
      }
      return null;
    }

    // Bold: *...*
    if (stream.peek() === '*') {
      stream.next();
      while (!stream.eol() && stream.peek() !== '*') stream.next();
      if (!stream.eol()) stream.next();
      return 'strong';
    }

    // Emphasis: _..._
    if (stream.peek() === '_') {
      stream.next();
      while (!stream.eol() && stream.peek() !== '_') stream.next();
      if (!stream.eol()) stream.next();
      return 'em';
    }

    // Numbers
    if (stream.match(/^\d+(\.\d+)?(pt|em|cm|mm|in|%)?/)) {
      return 'number';
    }

    stream.next();
    return null;
  },
});

// ── Initialisation ────────────────────────────────────────────────────────────

const params = new URLSearchParams(window.location.search);
const typFile = params.get('typFile') ?? '';
const naam = params.get('naam') ?? 'Opdracht';
const obsIcon = params.get('obsIcon') ?? '❌';
const obsName = params.get('obsName') ?? 'Geen observatie';

document.getElementById('editor-title-naam').textContent = naam;

document.getElementById('btn-app-title').addEventListener('click', () => {
  window.parent.postMessage({ type: 'editor-close' }, '*');
});

// Render user badge from URL params (passed by modals/editor.js from the topbar DOM)
const badgeBtn = document.getElementById('editor-badge-btn');
badgeBtn.textContent = params.get('badgeInitials') ?? '?';
badgeBtn.dataset.len = badgeBtn.textContent.length;
badgeBtn.style.setProperty('--badge-color', params.get('badgeColor') ?? '#888');
badgeBtn.classList.add(params.get('badgeShape') === 'square' ? 'badge-square' : 'badge-circle');
badgeBtn.addEventListener('click', () => {
  window.parent.postMessage({ type: 'editor-logout' }, '*');
});

let view = null;
let dataDir = null;
let saveTimer = null;

// ── Error popover ─────────────────────────────────────────────────────────────

const _popover = document.getElementById('error-popover');
let _popoverOpen = false;

function openErrorPopover(anchorEl) {
  _popoverOpen = true;
  _popover.style.display = '';
  const rect = anchorEl.getBoundingClientRect();
  const pw = Math.min(560, window.innerWidth - 20);
  let left = rect.left;
  if (left + pw > window.innerWidth - 10) left = window.innerWidth - pw - 10;
  _popover.style.left = Math.max(10, left) + 'px';
  _popover.style.top = rect.bottom + 4 + 'px';
  _popover.style.maxWidth = pw + 'px';
  setTimeout(() => {
    document.addEventListener('mousedown', _dismissPopover);
  }, 0);
}

function closeErrorPopover() {
  _popoverOpen = false;
  _popover.style.display = 'none';
  document.removeEventListener('mousedown', _dismissPopover);
}

function _dismissPopover(e) {
  if (!_popover.contains(e.target)) closeErrorPopover();
}

function setStatus(msg, errorText = null) {
  const el = document.getElementById('editor-status');
  closeErrorPopover();
  if (errorText) {
    _popover.textContent = errorText;
    const btn = document.createElement('button');
    btn.id = 'btn-render-error';
    btn.textContent = msg;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_popoverOpen) {
        closeErrorPopover();
        return;
      }
      openErrorPopover(btn);
    });
    el.innerHTML = '';
    el.appendChild(btn);
  } else {
    el.textContent = msg;
  }
}

function refreshPdf(pdfAbsPath) {
  const fileUrl = 'file:///' + pdfAbsPath.replace(/\\/g, '/');
  const viewerSrc = `pdf-viewer.html?file=${encodeURIComponent(fileUrl + '?t=' + Date.now())}`;
  const frame = document.getElementById('pdf-frame');
  const placeholder = document.getElementById('pdf-placeholder');
  frame.src = viewerSrc;
  frame.style.display = '';
  placeholder.style.display = 'none';
}

async function doCompileOnly() {
  if (!dataDir || !typFile) return;
  setStatus('Bezig met renderen…');
  const result = await postToParent('rtti-render-assignment', {
    typFile,
    title: naam,
    obsIcon,
    obsName,
  });
  if (result?.success) {
    refreshPdf(result.pdfPath);
    setStatus('');
  } else {
    setStatus('Fout bij renderen', result?.error ?? 'Onbekende fout');
  }
}

async function doSaveAndCompile() {
  if (!view || !dataDir || !typFile) return;

  const content = view.state.doc.toString();
  const relPath = `opdrachten/${typFile}`;
  const writeResult = await postToParent('rtti-write-text', { path: relPath, content });
  if (!writeResult?.ok) {
    setStatus('Fout bij opslaan');
    return;
  }

  setStatus('Bezig met renderen…');
  const result = await postToParent('rtti-render-assignment', {
    typFile,
    title: naam,
    obsIcon,
    obsName,
  });

  if (result?.success) {
    refreshPdf(result.pdfPath);
    setStatus('Opgeslagen');
  } else {
    setStatus('Fout bij renderen', result?.error ?? 'Onbekende fout');
  }
}

function scheduleCompile() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(doSaveAndCompile, 600);
}

const changeListener = EditorView.updateListener.of((update) => {
  if (update.docChanged) {
    setStatus('Niet opgeslagen…');
    scheduleCompile();
  }
});

async function init() {
  const [content, dir] = await Promise.all([
    postToParent('rtti-read-text', { path: `opdrachten/${typFile}` }),
    postToParent('rtti-get-data-dir'),
  ]);

  dataDir = dir ?? '';

  const state = EditorState.create({
    doc: content ?? '',
    extensions: [
      history(),
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      typstLanguage,
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      changeListener,
      EditorView.lineWrapping,
    ],
  });

  view = new EditorView({
    state,
    parent: document.getElementById('cm-container'),
  });

  await doCompileOnly();
}

init();

// ── Toolbar ───────────────────────────────────────────────────────────────────

// Symbol data: { char, name, typst }
const SYMBOLS = {
  letterlike: [
    { char: 'ℕ', name: 'natuurlijke getallen', typst: 'sym.NN' },
    { char: 'ℤ', name: 'gehele getallen', typst: 'sym.ZZ' },
    { char: 'ℚ', name: 'rationale getallen', typst: 'sym.QQ' },
    { char: 'ℝ', name: 'reële getallen', typst: 'sym.RR' },
    { char: 'ℂ', name: 'complexe getallen', typst: 'sym.CC' },
    { char: 'ℋ', name: 'hilbert ruimte', typst: 'sym.scr.H' },
    { char: 'ℓ', name: 'script l', typst: 'sym.ell' },
    { char: 'ℏ', name: 'h-balk', typst: 'sym.planck.reduce' },
    { char: 'ℐ', name: 'script I', typst: 'sym.scr.I' },
    { char: 'ℑ', name: 'imaginair deel', typst: 'sym.Im' },
    { char: 'ℜ', name: 'reëel deel', typst: 'sym.Re' },
    { char: 'ℬ', name: 'script B', typst: 'sym.scr.B' },
    { char: 'ℰ', name: 'script E', typst: 'sym.scr.E' },
    { char: 'ℱ', name: 'script F', typst: 'sym.scr.F' },
    { char: 'ℳ', name: 'script M', typst: 'sym.scr.M' },
    { char: '℘', name: 'weierstrass p', typst: 'sym.wp' },
  ],
  math: [
    { char: '∈', name: 'element van', typst: 'sym.in' },
    { char: '∉', name: 'geen element van', typst: 'sym.in.not' },
    { char: '⊂', name: 'deelverzameling', typst: 'sym.subset' },
    { char: '⊃', name: 'superverzameling', typst: 'sym.supset' },
    { char: '⊆', name: 'deelverzameling of gelijk', typst: 'sym.subset.eq' },
    { char: '⊇', name: 'superverzameling of gelijk', typst: 'sym.supset.eq' },
    { char: '∩', name: 'doorsnede', typst: 'sym.sect' },
    { char: '∪', name: 'vereniging', typst: 'sym.union' },
    { char: '±', name: 'plus of min', typst: 'sym.plus.minus' },
    { char: '∓', name: 'min of plus', typst: 'sym.minus.plus' },
    { char: '×', name: 'vermenigvuldigen', typst: 'sym.times' },
    { char: '÷', name: 'delen', typst: 'sym.div' },
    { char: '≤', name: 'kleiner of gelijk', typst: 'sym.lt.eq' },
    { char: '≥', name: 'groter of gelijk', typst: 'sym.gt.eq' },
    { char: '≠', name: 'ongelijk', typst: 'sym.eq.not' },
    { char: '≈', name: 'ongeveer gelijk', typst: 'sym.approx' },
    { char: '≡', name: 'identiek', typst: 'sym.equiv' },
    { char: '∝', name: 'evenredig met', typst: 'sym.prop' },
    { char: '∞', name: 'oneindig', typst: 'sym.infinity' },
    { char: '∑', name: 'som', typst: 'sym.sum' },
    { char: '∏', name: 'product', typst: 'sym.product' },
    { char: '∫', name: 'integraal', typst: 'sym.integral' },
    { char: '∂', name: 'partiële afgeleide', typst: 'sym.partial' },
    { char: '∇', name: 'nabla', typst: 'sym.nabla' },
    { char: '√', name: 'vierkantswortel', typst: 'sym.sqrt' },
    { char: '∀', name: 'voor alle', typst: 'sym.forall' },
    { char: '∃', name: 'er bestaat', typst: 'sym.exists' },
    { char: '¬', name: 'niet', typst: 'sym.not' },
    { char: '∧', name: 'en', typst: 'sym.and' },
    { char: '∨', name: 'of', typst: 'sym.or' },
    { char: '⊕', name: 'exclusief of', typst: 'sym.xor' },
    { char: '∅', name: 'lege verzameling', typst: 'sym.emptyset' },
  ],
  misc: [
    { char: '→', name: 'pijl rechts', typst: 'sym.arrow.r' },
    { char: '←', name: 'pijl links', typst: 'sym.arrow.l' },
    { char: '↑', name: 'pijl omhoog', typst: 'sym.arrow.t' },
    { char: '↓', name: 'pijl omlaag', typst: 'sym.arrow.b' },
    { char: '↔', name: 'dubbele pijl', typst: 'sym.arrow.l.r' },
    { char: '⇒', name: 'impliceert', typst: 'sym.arrow.r.double' },
    { char: '⇐', name: 'volgt uit', typst: 'sym.arrow.l.double' },
    { char: '⇔', name: 'dan en slechts dan', typst: 'sym.arrow.l.r.double' },
    { char: '↦', name: 'afbeelding pijl', typst: 'sym.arrow.r.bar' },
    { char: '★', name: 'ster', typst: 'sym.star.filled' },
    { char: '☆', name: 'ster (leeg)', typst: 'sym.star' },
    { char: '●', name: 'cirkel', typst: 'sym.circle.filled' },
    { char: '○', name: 'cirkel (leeg)', typst: 'sym.circle' },
    { char: '■', name: 'vierkant', typst: 'sym.square.filled' },
    { char: '□', name: 'vierkant (leeg)', typst: 'sym.square' },
    { char: '▲', name: 'driehoek', typst: 'sym.triangle.filled' },
    { char: '△', name: 'driehoek (leeg)', typst: 'sym.triangle' },
    { char: '♦', name: 'ruit', typst: 'sym.diamond.filled' },
    { char: '◇', name: 'ruit (leeg)', typst: 'sym.diamond' },
    { char: '†', name: 'kruis', typst: 'sym.dagger' },
    { char: '‡', name: 'dubbel kruis', typst: 'sym.dagger.double' },
    { char: '§', name: 'paragraaf', typst: 'sym.section' },
    { char: '¶', name: 'alinea', typst: 'sym.pilcrow' },
    { char: '©', name: 'copyright', typst: 'sym.copyright' },
    { char: '®', name: 'geregistreerd', typst: 'sym.trademark.registered' },
    { char: '™', name: 'handelsmerk', typst: 'sym.trademark' },
    { char: '°', name: 'graden', typst: 'sym.degree' },
    { char: '′', name: 'priemteken', typst: 'sym.prime' },
    { char: '″', name: 'dubbel priemteken', typst: 'sym.prime.double' },
    { char: '…', name: 'ellips', typst: 'sym.dots.h' },
    { char: '—', name: 'gedachtestreep', typst: 'sym.dash.em' },
    { char: '–', name: 'koppelteken', typst: 'sym.dash.en' },
  ],
  emoji: [
    { char: '😀', name: 'blij', typst: 'emoji.face.smile' },
    { char: '😊', name: 'glimlach', typst: 'emoji.face.smile.slight' },
    { char: '😄', name: 'lachen', typst: 'emoji.face.grin' },
    { char: '😂', name: 'tranen van het lachen', typst: 'emoji.face.joy' },
    { char: '🙂', name: 'enigszins blij', typst: 'emoji.face.smile.slight' },
    { char: '😎', name: 'coole zonnebril', typst: 'emoji.face.sunglasses' },
    { char: '🤔', name: 'nadenkend', typst: 'emoji.face.thinking' },
    { char: '😮', name: 'verrast', typst: 'emoji.face.surprise' },
    { char: '😢', name: 'bedroefd', typst: 'emoji.face.cry' },
    { char: '😡', name: 'boos', typst: 'emoji.face.angry' },
    { char: '👍', name: 'duim omhoog', typst: 'emoji.hand.thumbsup' },
    { char: '👎', name: 'duim omlaag', typst: 'emoji.hand.thumbsdown' },
    { char: '👋', name: 'zwaai', typst: 'emoji.hand.wave' },
    { char: '🙌', name: 'handen omhoog', typst: 'emoji.hand.raised.both' },
    { char: '✅', name: 'vinkje', typst: 'emoji.mark.check' },
    { char: '❌', name: 'kruis', typst: 'emoji.mark.cross' },
    { char: '⚠️', name: 'waarschuwing', typst: 'emoji.mark.warning' },
    { char: '💡', name: 'lamp', typst: 'emoji.object.bulb' },
    { char: '📌', name: 'punaise', typst: 'emoji.object.pin' },
    { char: '📝', name: 'notitie', typst: 'emoji.object.pencil' },
    { char: '📊', name: 'grafiek', typst: 'emoji.object.chart' },
    { char: '🔍', name: 'vergrootglas', typst: 'emoji.object.search' },
    { char: '🔑', name: 'sleutel', typst: 'emoji.object.key' },
    { char: '🎯', name: 'doel', typst: 'emoji.object.target' },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function insertAtCursor(editorView, text) {
  const { from, to } = editorView.state.selection.main;
  editorView.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
  });
  editorView.focus();
}

function wrapSelection(editorView, before, after) {
  const { from, to } = editorView.state.selection.main;
  const selected = editorView.state.sliceDoc(from, to);
  if (selected) {
    editorView.dispatch({
      changes: { from, to, insert: before + selected + after },
      selection: { anchor: from + before.length + selected.length + after.length },
    });
  } else {
    const insert = before + after;
    editorView.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + before.length },
    });
  }
  editorView.focus();
}

function isCursorInMath(editorView) {
  const doc = editorView.state.doc.toString();
  const pos = editorView.state.selection.main.head;
  let inMath = false;
  let i = 0;
  while (i < pos) {
    if (doc[i] === '$') inMath = !inMath;
    i++;
  }
  return inMath;
}

function insertMath(editorView, snippet) {
  if (isCursorInMath(editorView)) {
    insertAtCursor(editorView, snippet);
  } else {
    // Wrap snippet in $…$ and place cursor after closing $
    const { from, to } = editorView.state.selection.main;
    const insert = `$${snippet}$`;
    editorView.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
    });
    editorView.focus();
  }
}

function wrapWithFunction(editorView, fn) {
  const { from, to } = editorView.state.selection.main;
  const selected = editorView.state.sliceDoc(from, to);
  const inner = selected || '…';
  const insert = `#${fn}[${inner}]`;
  editorView.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
  });
  editorView.focus();
}

function extractLabels(editorView) {
  const doc = editorView.state.doc.toString();
  const matches = [...doc.matchAll(/<([a-zA-Z0-9_-]+)>/g)];
  return [...new Set(matches.map((m) => m[1]))];
}

// ── Popup management ──────────────────────────────────────────────────────────

let _activePopup = null;
let _dismissHandler = null;

function closeActivePopup() {
  if (_activePopup) {
    _activePopup.style.display = 'none';
    _activePopup = null;
  }
  if (_dismissHandler) {
    document.removeEventListener('mousedown', _dismissHandler);
    _dismissHandler = null;
  }
}

function openPopup(triggerEl, popupEl) {
  if (_activePopup === popupEl) {
    closeActivePopup();
    return;
  }
  closeActivePopup();

  // Position popup below the trigger button
  const toolbarEl = document.getElementById('editor-toolbar');
  const triggerRect = triggerEl.getBoundingClientRect();
  const toolbarRect = toolbarEl.getBoundingClientRect();

  popupEl.style.display = '';
  popupEl.style.left = triggerRect.left - toolbarRect.left + 'px';
  popupEl.style.top = triggerRect.bottom - toolbarRect.top + 'px';

  // Prevent popup from going off right edge
  const popupWidth = popupEl.offsetWidth;
  const toolbarWidth = toolbarEl.offsetWidth;
  const leftPos = triggerRect.left - toolbarRect.left;
  if (leftPos + popupWidth > toolbarWidth - 4) {
    popupEl.style.left = Math.max(0, toolbarWidth - popupWidth - 4) + 'px';
  }

  _activePopup = popupEl;
  setTimeout(() => {
    _dismissHandler = (e) => {
      if (!popupEl.contains(e.target) && e.target !== triggerEl) {
        closeActivePopup();
      }
    };
    document.addEventListener('mousedown', _dismissHandler);
  }, 0);
}

// ── Symbol panel builder ──────────────────────────────────────────────────────

function buildSymbolPanel(popupEl, symbols) {
  if (popupEl.dataset.built) return;
  popupEl.dataset.built = '1';

  popupEl.innerHTML = '';
  popupEl.classList.add('tb-symbol-panel');

  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Zoeken…';
  search.className = 'tb-symbol-search';
  popupEl.appendChild(search);

  const grid = document.createElement('div');
  grid.className = 'tb-symbol-grid';
  popupEl.appendChild(grid);

  const hint = document.createElement('div');
  hint.className = 'tb-symbol-hint';
  popupEl.appendChild(hint);

  function render(list) {
    grid.innerHTML = '';
    list.forEach((sym) => {
      const btn = document.createElement('button');
      btn.className = 'tb-symbol-btn';
      btn.textContent = sym.char;
      btn.addEventListener('mouseenter', () => {
        hint.textContent = `${sym.name} — ${sym.typst}`;
      });
      btn.addEventListener('mouseleave', () => {
        hint.textContent = '';
      });
      btn.addEventListener('click', () => {
        if (view) {
          const inMath = isCursorInMath(view);
          const insert = inMath ? sym.typst.replace(/^sym\./, '') : `#${sym.typst}`;
          insertAtCursor(view, insert);
        }
        closeActivePopup();
      });
      grid.appendChild(btn);
    });
  }

  render(symbols);

  search.addEventListener('input', () => {
    const q = search.value.toLowerCase();
    if (!q) {
      render(symbols);
      return;
    }
    render(symbols.filter((s) => s.name.includes(q) || s.typst.includes(q)));
  });
}

// ── Reference panel builder ───────────────────────────────────────────────────

function buildReferencePanel(popupEl) {
  if (!view) return;
  const labels = extractLabels(view);
  const listEl = popupEl.querySelector('#ref-list');
  listEl.innerHTML = '';

  if (labels.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'tb-ref-empty';
    empty.textContent = 'Geen verwijzingen gevonden in dit document.';
    listEl.appendChild(empty);
    return;
  }

  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Zoeken…';
  search.className = 'tb-symbol-search';
  search.style.marginBottom = '4px';
  popupEl.querySelector('.tb-ref-panel').insertBefore(search, listEl);

  function render(list) {
    listEl.innerHTML = '';
    list.forEach((label) => {
      const btn = document.createElement('button');
      btn.className = 'tb-ref-item';
      btn.textContent = `@${label}`;
      btn.addEventListener('click', () => {
        if (view) insertAtCursor(view, `@${label}`);
        closeActivePopup();
      });
      listEl.appendChild(btn);
    });
  }

  render(labels);
  search.addEventListener('input', () => {
    const q = search.value.toLowerCase();
    render(q ? labels.filter((l) => l.includes(q)) : labels);
  });
}

// ── Insert helpers ────────────────────────────────────────────────────────────

function cellLabel(i) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (i < 26) return alpha[i];
  return alpha[Math.floor(i / 26) - 1] + alpha[i % 26];
}

function genTable(cols, rows) {
  const rowLines = [];
  for (let r = 0; r < rows; r++) {
    const cells = Array.from({ length: cols }, (_, c) => `[${cellLabel(r * cols + c)}]`).join(', ');
    rowLines.push('  ' + cells + ',');
  }
  return [
    '#table(',
    `  columns: (1fr,) * ${cols},`,
    '  align: center,',
    '  fill: (x, y) => if calc.odd(y) { luma(240) } else { white },',
    ...rowLines,
    ')',
  ].join('\n');
}

const GRID_PRESETS = [
  { label: '50 – 50', cols: [1, 1] },
  { label: '33 – 33 – 33', cols: [1, 1, 1] },
  { label: '33 – 67', cols: [1, 2] },
  { label: '67 – 33', cols: [2, 1] },
  { label: '25 – 25 – 25 – 25', cols: [1, 1, 1, 1] },
  { label: '50 – 25 – 25', cols: [2, 1, 1] },
  { label: '25 – 50 – 25', cols: [1, 2, 1] },
  { label: '25 – 25 – 50', cols: [1, 1, 2] },
  { label: '75 – 25', cols: [3, 1] },
  { label: '25 – 75', cols: [1, 3] },
];

const LOREM = '#lorem(20)';

function genGrid(cols) {
  const colDef = cols.map((c) => `${c}fr`).join(', ');
  const cells = cols.map(() => `  [${LOREM}]`).join(',\n');
  return `#grid(\n  columns: (${colDef}),\n  gutter: 1em,\n${cells},\n)`;
}

function withIndent(v, snippet) {
  const line = v.state.doc.lineAt(v.state.selection.main.from);
  const indent = line.text.match(/^(\s*)/)[1];
  if (!indent) return snippet;
  return snippet
    .split('\n')
    .map((l, i) => (i === 0 ? l : indent + l))
    .join('\n');
}

const CONTENT_BLOCKS = {
  formule: [
    '#formule_blok(name: "Formule van Einstein")[',
    '  Volgens Einstein zijn massa en energie uitwisselbaar:',
    '  #align(center)[$E = m dot c^2$]',
    '  Energie $E$ in J;\\',
    '  Massa $m$ in kg;\\',
    '  Lichtsnelheid $c$ in m/s.',
    ']',
  ].join('\n'),
  voorbeeld: '#voorbeeld_blok(name: "Lorem ipsum")[\n  #lorem(20)\n]',
  context: '#context_blok(name: "Lorem ipsum")[\n  #lorem(20)\n]',
  belangrijk: '#belangrijk_blok[\n  #lorem(20)\n]',
};

function insertContentBlock(v, kind) {
  insertAtCursor(v, withIndent(v, CONTENT_BLOCKS[kind]));
}

// ── Action map ────────────────────────────────────────────────────────────────

const ACTIONS = {
  // Content blocks group
  'blok-formule': (v) => insertContentBlock(v, 'formule'),
  'blok-voorbeeld': (v) => insertContentBlock(v, 'voorbeeld'),
  'blok-context': (v) => insertContentBlock(v, 'context'),
  'blok-belangrijk': (v) => insertContentBlock(v, 'belangrijk'),

  // Insert group
  figure: (v) => {
    const snippet = withIndent(v, '#figure(\n  image("naam.png"),\n  caption: [Bijschrift],\n)');
    const { from, to } = v.state.selection.main;
    const nameStart = snippet.indexOf('"') + 1;
    const nameEnd = nameStart + 'naam.png'.length;
    v.dispatch({
      changes: { from, to, insert: snippet },
      selection: { anchor: from + nameStart, head: from + nameEnd },
    });
    v.focus();
  },

  // Group 1
  bold: (v) => wrapSelection(v, '*', '*'),
  italic: (v) => wrapSelection(v, '_', '_'),
  underline: (v) => wrapWithFunction(v, 'underline'),
  overline: (v) => wrapWithFunction(v, 'overline'),
  strike: (v) => wrapWithFunction(v, 'strike'),
  highlight: (v) => wrapWithFunction(v, 'highlight'),
  lower: (v) => wrapWithFunction(v, 'lower'),
  upper: (v) => wrapWithFunction(v, 'upper'),
  smallcaps: (v) => wrapWithFunction(v, 'smallcaps'),
  sub: (v) => wrapWithFunction(v, 'sub'),
  super: (v) => wrapWithFunction(v, 'super'),
  quote: (v) => wrapWithFunction(v, 'quote'),

  // Group 2
  list: (v) => {
    const { from } = v.state.selection.main;
    const line = v.state.doc.lineAt(from);
    v.dispatch({ changes: { from: line.from, to: line.from, insert: '- ' } });
    v.focus();
  },
  enumerate: (v) => {
    const { from } = v.state.selection.main;
    const line = v.state.doc.lineAt(from);
    v.dispatch({ changes: { from: line.from, to: line.from, insert: '+ ' } });
    v.focus();
  },
  math: (v) => wrapSelection(v, '$', '$'),
  codeblock: (v) => {
    const { from, to } = v.state.selection.main;
    const insert = '```\n' + (v.state.sliceDoc(from, to) || '') + '\n```';
    v.dispatch({ changes: { from, to, insert }, selection: { anchor: from + 4 } });
    v.focus();
  },

  // Group 3 – math elements
  'math-accent': (v) => insertMath(v, 'accent(x, hat)'),
  'math-binom': (v) => insertMath(v, 'binom(n, k)'),
  'math-cancel': (v) => insertMath(v, 'cancel(x)'),
  'math-cases': (v) => insertMath(v, 'cases(a "als" x > 0, b "anders")'),
  'math-numeq': (v) => {
    const insert = '$ x = y $ <eq1>';
    insertAtCursor(v, insert);
  },
  'math-frac': (v) => insertMath(v, 'frac(a, b)'),
  'math-lr': (v) => insertMath(v, 'lr([x])'),
  'math-mat': (v) => insertMath(v, 'mat(a, b; c, d)'),
  'math-primes': (v) => insertMath(v, "x'"),
  'math-root': (v) => insertMath(v, 'root(n, x)'),
  'math-sizes': (v) => insertMath(v, 'display(x)'),
  'math-op': (v) => insertMath(v, 'op("sin")'),
  'math-variants': (v) => insertMath(v, 'bb(A)'),
  'math-vec': (v) => insertMath(v, 'vec(a, b)'),
};

// ── Table picker builder ──────────────────────────────────────────────────────

function buildTablePicker(popupEl) {
  if (popupEl.dataset.built) return;
  popupEl.dataset.built = '1';

  const COLS = 10,
    ROWS = 10;
  let hoverCol = -1,
    hoverRow = -1;

  const grid = document.createElement('div');
  grid.className = 'tb-table-grid';

  const label = document.createElement('div');
  label.className = 'tb-table-label';

  function updateHighlight() {
    for (let i = 0; i < COLS * ROWS; i++) {
      const r = Math.floor(i / COLS),
        c = i % COLS;
      grid.children[i].classList.toggle('active', c <= hoverCol && r <= hoverRow);
    }
    label.textContent = hoverCol >= 0 ? `${hoverCol + 1} × ${hoverRow + 1}` : '';
  }

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'tb-table-cell';
      cell.addEventListener('mousemove', () => {
        hoverCol = c;
        hoverRow = r;
        updateHighlight();
      });
      cell.addEventListener('click', () => {
        if (view) insertAtCursor(view, withIndent(view, genTable(hoverCol + 1, hoverRow + 1)));
        closeActivePopup();
      });
      grid.appendChild(cell);
    }
  }

  grid.addEventListener('mouseleave', () => {
    hoverCol = -1;
    hoverRow = -1;
    updateHighlight();
  });

  popupEl.appendChild(grid);
  popupEl.appendChild(label);
}

// ── Grid picker builder ───────────────────────────────────────────────────────

function buildGridPicker(popupEl) {
  if (popupEl.dataset.built) return;
  popupEl.dataset.built = '1';

  GRID_PRESETS.forEach((preset) => {
    const item = document.createElement('button');
    item.className = 'tb-grid-item';

    const visual = document.createElement('div');
    visual.className = 'tb-grid-visual';
    preset.cols.forEach((w) => {
      const col = document.createElement('div');
      col.className = 'tb-grid-col';
      col.style.flex = w;
      visual.appendChild(col);
    });

    const lbl = document.createElement('span');
    lbl.className = 'tb-grid-label';
    lbl.textContent = preset.label;

    item.appendChild(visual);
    item.appendChild(lbl);
    item.addEventListener('click', () => {
      if (view) insertAtCursor(view, withIndent(view, genGrid(preset.cols)));
      closeActivePopup();
    });

    popupEl.appendChild(item);
  });
}

// ── Setup toolbar ─────────────────────────────────────────────────────────────

function setupToolbar() {
  // Pre-build symbol panels
  buildSymbolPanel(document.getElementById('popup-sym-letterlike'), SYMBOLS.letterlike);
  buildSymbolPanel(document.getElementById('popup-sym-math'), SYMBOLS.math);
  buildSymbolPanel(document.getElementById('popup-sym-misc'), SYMBOLS.misc);
  buildSymbolPanel(document.getElementById('popup-sym-emoji'), SYMBOLS.emoji);
  buildTablePicker(document.getElementById('popup-tabel'));
  buildGridPicker(document.getElementById('popup-grid'));

  const toolbar = document.getElementById('editor-toolbar');

  toolbar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    e.stopPropagation();

    const action = btn.dataset.action;
    const popupId = btn.dataset.popup;

    // Handle reference popup separately (needs live label scan)
    if (action === 'reference') {
      const popupEl = document.getElementById('popup-reference');
      // Rebuild each time so labels are fresh
      const listEl = popupEl.querySelector('#ref-list');
      listEl.innerHTML = '';
      // Remove old search input if present
      const oldSearch = popupEl.querySelector('.tb-symbol-search');
      if (oldSearch) oldSearch.remove();
      buildReferencePanel(popupEl);
      openPopup(btn, popupEl);
      return;
    }

    // Handle popup-opening buttons
    if (popupId) {
      const popupEl = document.getElementById(popupId);
      if (popupEl) openPopup(btn, popupEl);
      return;
    }

    // Handle direct actions (including buttons inside open popups)
    if (action && ACTIONS[action] && view) {
      ACTIONS[action](view);
      closeActivePopup();
    }
  });
}

setupToolbar();

// ── Context menu ──────────────────────────────────────────────────────────────

function setupContextMenu() {
  const menu = document.getElementById('cm-context-menu');

  document.getElementById('cm-container').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const hasSel = view && !view.state.selection.main.empty;
    menu.querySelector('[data-cm-action="cut"]').disabled = !hasSel;
    menu.querySelector('[data-cm-action="copy"]').disabled = !hasSel;

    // Position — avoid going off-screen
    const mw = 190,
      mh = 130;
    const x = Math.min(e.clientX, window.innerWidth - mw - 4);
    const y = Math.min(e.clientY, window.innerHeight - mh - 4);
    menu.style.left = Math.max(0, x) + 'px';
    menu.style.top = Math.max(0, y) + 'px';
    menu.style.display = '';

    setTimeout(() => {
      document.addEventListener('mousedown', function dismiss(ev) {
        if (!menu.contains(ev.target)) {
          menu.style.display = 'none';
          document.removeEventListener('mousedown', dismiss);
        }
      });
    }, 0);
  });

  menu.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-cm-action]')?.dataset.cmAction;
    if (!action || !view) return;
    menu.style.display = 'none';

    const { from, to } = view.state.selection.main;

    if (action === 'copy') {
      await navigator.clipboard.writeText(view.state.sliceDoc(from, to)).catch(() => {});
    } else if (action === 'cut') {
      await navigator.clipboard.writeText(view.state.sliceDoc(from, to)).catch(() => {});
      view.dispatch({ changes: { from, to, insert: '' }, selection: { anchor: from } });
      view.focus();
    } else if (action === 'paste') {
      const text = await navigator.clipboard.readText().catch(() => '');
      if (text) {
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
        });
        view.focus();
      }
    } else if (action === 'comment') {
      toggleComment(view);
      view.focus();
    }
  });
}

// ── Math group responsive layout ──────────────────────────────────────────────
// Threshold: width at which all 15 math buttons fit on one row.
// Insert group adds ~99 px vs the original 836 threshold.
const MATH_EXPAND_THRESHOLD = 1080;

setupContextMenu();

(function setupMathLayout() {
  const toolbar = document.getElementById('editor-toolbar');
  function update() {
    toolbar.classList.toggle('tb-math-compact', toolbar.offsetWidth < MATH_EXPAND_THRESHOLD);
  }
  new ResizeObserver(update).observe(toolbar);
  update();
})();
