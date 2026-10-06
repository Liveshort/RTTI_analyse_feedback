import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.9.155/build/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.9.155/build/pdf.worker.min.mjs';

const INITIAL_SCALE = 1.25;
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

// ── Elements ───────────────────────────────────────────────────────────────────
const viewer = document.getElementById('viewer');
const statusEl = document.getElementById('status');
const pageNumInput = document.getElementById('page-num');
const pageTotalEl = document.getElementById('page-total');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');
const btnZoomIn = document.getElementById('btn-zoom-in');
const btnZoomOut = document.getElementById('btn-zoom-out');
const zoomSelect = document.getElementById('zoom-select');

// ── Load PDF ───────────────────────────────────────────────────────────────────
const fileUrl = new URLSearchParams(window.location.search).get('file');
if (!fileUrl) {
  statusEl.textContent = 'Geen PDF opgegeven.';
  throw new Error('Missing ?file= parameter');
}

let pdfDoc, numPages;
let currentScale = INITIAL_SCALE;
let currentPage = 1;
let isNavigating = false; // true while a button-triggered smooth scroll is in flight
const pageWraps = [];
const activeRenders = new Map(); // pageNum → RenderTask

try {
  pdfDoc = await pdfjsLib.getDocument(fileUrl).promise;
} catch (err) {
  statusEl.textContent = 'Fout bij laden: ' + (err?.message ?? err);
  throw err;
}

numPages = pdfDoc.numPages;
pageTotalEl.textContent = `/ ${numPages}`;
pageNumInput.max = numPages;
btnPrev.disabled = true;
btnNext.disabled = numPages <= 1;
statusEl.remove();

// ── Build page wrappers ────────────────────────────────────────────────────────
const firstPage = await pdfDoc.getPage(1);
const placeholderVp = firstPage.getViewport({ scale: INITIAL_SCALE });

for (let i = 1; i <= numPages; i++) {
  const wrap = document.createElement('div');
  wrap.className = 'page-wrap';
  wrap.dataset.page = String(i);
  wrap.style.width = `${Math.round(placeholderVp.width)}px`;
  wrap.style.height = `${Math.round(placeholderVp.height)}px`;
  viewer.appendChild(wrap);
  pageWraps.push(wrap);
}

// ── Render a single page ───────────────────────────────────────────────────────
async function renderPage(pageNum, scale) {
  const wrap = pageWraps[pageNum - 1];

  if (activeRenders.has(pageNum)) {
    try {
      activeRenders.get(pageNum).cancel();
    } catch (_) {}
    activeRenders.delete(pageNum);
  }

  const dpr = window.devicePixelRatio || 1;
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: scale * dpr });

  let canvas = wrap.querySelector('canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    wrap.appendChild(canvas);
  }

  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const cssW = Math.round(viewport.width / dpr);
  const cssH = Math.round(viewport.height / dpr);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  wrap.style.width = `${cssW}px`;
  wrap.style.height = `${cssH}px`;

  const renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport });
  activeRenders.set(pageNum, renderTask);

  try {
    await renderTask.promise;
    canvas.dataset.scale = String(scale);
  } catch (err) {
    if (err?.name !== 'RenderingCancelledException') throw err;
  } finally {
    activeRenders.delete(pageNum);
  }
}

// ── Lazy rendering via IntersectionObserver ────────────────────────────────────
const renderObserver = new IntersectionObserver(
  (entries) => {
    for (const { isIntersecting, target } of entries) {
      if (!isIntersecting) continue;
      const n = Number(target.dataset.page);
      const canvas = target.querySelector('canvas');
      if (canvas?.dataset.scale !== String(currentScale)) {
        renderPage(n, currentScale);
      }
    }
  },
  { root: viewer, rootMargin: '500px 0px' }
);

for (const wrap of pageWraps) renderObserver.observe(wrap);

// ── Page tracking via scroll position ─────────────────────────────────────────
// Compares each page's offsetTop against viewer.scrollTop to find the page
// whose top edge is nearest the top of the visible area. This is reliable
// during both free scrolling and programmatic smooth scrolls.
//
// While isNavigating is true (a button-triggered scroll is in flight), we
// suppress updates so the counter doesn't flicker back to the old page
// mid-animation. The `scrollend` event clears the flag exactly when the
// animation finishes — no timeout guessing needed.
function updatePageFromScroll() {
  let best = 1;
  let bestDist = Infinity;
  for (const wrap of pageWraps) {
    const dist = Math.abs(wrap.offsetTop - viewer.scrollTop);
    if (dist < bestDist) {
      bestDist = dist;
      best = Number(wrap.dataset.page);
    }
  }
  if (best !== currentPage) {
    currentPage = best;
    pageNumInput.value = best;
    btnPrev.disabled = best <= 1;
    btnNext.disabled = best >= numPages;
  }
}

viewer.addEventListener(
  'scroll',
  () => {
    if (isNavigating) return;
    updatePageFromScroll();
  },
  { passive: true }
);

// `scrollend` fires once when a smooth scroll animation completes.
// Re-enabling the scroll listener at this point guarantees the counter is
// in sync after any programmatic navigation.
viewer.addEventListener('scrollend', () => {
  isNavigating = false;
  updatePageFromScroll();
});

// ── Scale management ───────────────────────────────────────────────────────────
function applyScale(scale) {
  currentScale = scale;

  for (const [, task] of activeRenders) {
    try {
      task.cancel();
    } catch (_) {}
  }
  activeRenders.clear();

  for (const wrap of pageWraps) {
    const canvas = wrap.querySelector('canvas');
    if (canvas) canvas.dataset.scale = 'stale';
  }

  for (const wrap of pageWraps) {
    renderObserver.unobserve(wrap);
    renderObserver.observe(wrap);
  }
}

async function applyScaleFromSelect(value) {
  let scale;
  if (value === 'fit-width') {
    const vp = firstPage.getViewport({ scale: 1 });
    scale = (viewer.clientWidth - 32) / vp.width;
  } else if (value === 'fit-page') {
    const vp = firstPage.getViewport({ scale: 1 });
    scale = Math.min((viewer.clientWidth - 32) / vp.width, (viewer.clientHeight - 32) / vp.height);
  } else {
    scale = parseFloat(value);
  }
  applyScale(scale);
}

// ── Zoom controls ──────────────────────────────────────────────────────────────
function syncZoomSelect(scale) {
  const match = [...zoomSelect.options].find((o) => Math.abs(parseFloat(o.value) - scale) < 0.01);
  if (match) zoomSelect.value = match.value;
}

zoomSelect.addEventListener('change', () => applyScaleFromSelect(zoomSelect.value));

btnZoomIn.addEventListener('click', () => {
  const next = ZOOM_STEPS.find((s) => s > currentScale + 0.01) ?? ZOOM_STEPS.at(-1);
  syncZoomSelect(next);
  applyScale(next);
});

btnZoomOut.addEventListener('click', () => {
  const prev = [...ZOOM_STEPS].reverse().find((s) => s < currentScale - 0.01) ?? ZOOM_STEPS[0];
  syncZoomSelect(prev);
  applyScale(prev);
});

// Ctrl+scroll: accumulate deltaY so a trackpad gesture counts as one step.
let scrollAccum = 0;
document.addEventListener(
  'wheel',
  (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    scrollAccum += e.deltaY;
    if (scrollAccum > 50) {
      scrollAccum = 0;
      const prev = [...ZOOM_STEPS].reverse().find((s) => s < currentScale - 0.01) ?? ZOOM_STEPS[0];
      syncZoomSelect(prev);
      applyScale(prev);
    } else if (scrollAccum < -50) {
      scrollAccum = 0;
      const next = ZOOM_STEPS.find((s) => s > currentScale + 0.01) ?? ZOOM_STEPS.at(-1);
      syncZoomSelect(next);
      applyScale(next);
    }
  },
  { passive: false }
);

// ── Navigation ─────────────────────────────────────────────────────────────────
function scrollToPage(n) {
  currentPage = n;
  pageNumInput.value = n;
  btnPrev.disabled = n <= 1;
  btnNext.disabled = n >= numPages;
  isNavigating = true;
  pageWraps[n - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

btnPrev.addEventListener('click', () => scrollToPage(currentPage - 1));
btnNext.addEventListener('click', () => scrollToPage(currentPage + 1));

pageNumInput.addEventListener('change', () => {
  const n = Math.max(1, Math.min(numPages, Number(pageNumInput.value) || 1));
  pageNumInput.value = n;
  scrollToPage(n);
});
pageNumInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') pageNumInput.dispatchEvent(new Event('change'));
});

document.addEventListener('keydown', (e) => {
  if (e.target === pageNumInput) return;
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
    if (currentPage > 1) scrollToPage(currentPage - 1);
  } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
    if (currentPage < numPages) scrollToPage(currentPage + 1);
  }
});

// ── Print ──────────────────────────────────────────────────────────────────────
// window.print() does not work inside an Electron iframe. Instead, tell the
// parent page to open the PDF file in the system viewer (Edge, Acrobat, …)
// where the user can print at full vector quality.
document.getElementById('btn-print').addEventListener('click', () => {
  window.parent.postMessage({ type: 'print-pdf' }, '*');
});

// ── Initial render ─────────────────────────────────────────────────────────────
syncZoomSelect(INITIAL_SCALE);
applyScale(INITIAL_SCALE);
