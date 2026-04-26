import { SEL, toast, showModal, closeModal } from '../app.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN: Rapport genereren
// ═══════════════════════════════════════════════════════════════════════════════

let _allExams = [];

export async function renderRapport() {
  const cfg = Store.getConfigSync();
  const year = cfg.activeYear;

  _allExams = [];
  SEL.rapportJaarlaag.setOptions([]);
  SEL.rapportExam.setOptions([]);
  SEL.rapportExam.setDisabled(true);
  document.getElementById('rapport-content').innerHTML =
    '<p class="hint">Selecteer een jaarlaag en een toets.</p>';

  document.getElementById('btn-rtti-uitleg').addEventListener('click', () => openRttiUitlegModal());

  if (!year) return;

  _allExams = await window.rtti.readAllJson(`${year}/exams`);

  const jaarlagen = [
    ...new Set(_allExams.map((e) => String(e.jaarlaag ?? '')).filter(Boolean)),
  ].sort((a, b) => Number(a) - Number(b));

  SEL.rapportJaarlaag.setOptions(jaarlagen.map((j) => ({ value: j, label: `Klas ${j}` })));
}

export function updateRapportExamsByJaarlaag(jaarlaag) {
  const subject = Store.getActiveSubject();
  const filtered = _allExams.filter(
    (e) => String(e.jaarlaag ?? '') === String(jaarlaag) && (!subject || e.subject === subject)
  );
  SEL.rapportExam.setOptions([
    { value: '', label: '— kies toets —' },
    ...filtered.map((e) => ({
      value: e.id,
      label: (e.volgnummer ? e.volgnummer + ' \u2013 ' : '') + e.title,
    })),
  ]);
  SEL.rapportExam.setDisabled(false);
  document.getElementById('rapport-content').innerHTML = '<p class="hint">Selecteer een toets.</p>';
}

// ── Lollipop data helpers ──────────────────────────────────────────────────────

const RTTI_COLORS = { R: '#5cb85c', T1: '#5bc0de', T2: '#f0ad4e', I: '#d9534f' };

function lerpHex(hex1, hex2, t) {
  const h = (hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const [r1, g1, b1] = h(hex1),
    [r2, g2, b2] = h(hex2);
  return (
    '#' +
    [r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t]
      .map((c) => Math.round(c).toString(16).padStart(2, '0'))
      .join('')
  );
}

function scoreDotColor(score, max) {
  if (score === null) return '#b0b8c1'; // grey — not entered
  if (score <= 0) return '#e57373'; // red — zero
  if (score >= max) return '#66bb6a'; // green — full marks
  const t = score / max;
  return t <= 0.5
    ? lerpHex('#e57373', '#ffd54f', t * 2)
    : lerpHex('#ffd54f', '#66bb6a', (t - 0.5) * 2);
}

/**
 * Build the per-question data array for one student.
 * allQuestionScores: array of questionScores objects for ALL participants,
 * used to compute class averages.
 */
function assembleVragen(exam, questionScores, allQuestionScores) {
  return exam.questions.map((q) => {
    const raw = questionScores?.[q.id];
    const notEntered = raw === undefined || raw === null || String(raw).toUpperCase() === 'N';
    const score = notEntered ? null : Math.max(0, Number(raw));

    // Class average for this question across all participants
    let sum = 0,
      count = 0;
    for (const qs of allQuestionScores) {
      const v = qs[q.id];
      if (v === undefined || v === null || String(v).toUpperCase() === 'N') continue;
      const n = Number(v);
      if (!isNaN(n)) {
        sum += n;
        count++;
      }
    }
    const classAvg = count > 0 ? parseFloat((sum / count).toFixed(1)) : 0;
    const classPct = q.max_points > 0 ? Math.round((classAvg / q.max_points) * 100) : 0;

    const label = q.section ? `${q.section}${q.number}` : String(q.number);

    return {
      label,
      rtti: q.rtti,
      kind: qKind(q),
      rtti_color: RTTI_COLORS[q.rtti] ?? '#888888',
      score, // null if not entered
      max: q.max_points,
      class_avg: classAvg,
      class_pct: classPct,
      dot_color: scoreDotColor(score, q.max_points),
    };
  });
}

// ── Main generate function ─────────────────────────────────────────────────────

export async function generateRapport(examId) {
  const content = document.getElementById('rapport-content');

  // A — spinner
  content.innerHTML = '<div class="rapport-spinner">Rapport wordt gegenereerd\u2026</div>';

  // B — disable selectors while compiling
  SEL.rapportJaarlaag.setDisabled(true);
  SEL.rapportExam.setDisabled(true);

  const cfg = Store.getConfigSync();
  const year = cfg.activeYear;
  const exam = _allExams.find((e) => e.id === examId);
  const subject = exam?.subject;

  // Ensure students, groups, scores, and observations are loaded for this subject
  await Promise.all([
    Store.loadYear(year, subject),
    Store.preloadScores(year, subject),
    Store.getObservaties(subject),
  ]);

  const allStudents = Store.getStudentsSync(year);
  const groups = Store.getGroupsSync(year, subject);

  // Filter to the exam's jaarlaag
  const inJaarlaag = exam?.jaarlaag
    ? allStudents.filter((s) => Store.jaarlaagFromStamklas(s.stamklas) === String(exam.jaarlaag))
    : allStudents;

  // Build an entry for each student who has at least one score entered
  const entries = (
    await Promise.all(
      inJaarlaag.map(async (s) => {
        const rec = await Store.getStudentScores(s.id, year, subject);
        const questionScores = rec?.scores?.[examId];
        if (!questionScores) return null;
        const hasEntry = Object.values(questionScores).some((v) => v !== null && v !== undefined);
        if (!hasEntry) return null;
        const { scored, normalMax, grade } = Store.calcResults(exam, questionScores);
        const group = groups.find((g) => g.student_ids.includes(s.id));
        const obsIds = rec?.observations?.[examId] ?? [];
        const allObs = Store.getObservatiesSync(subject);
        const observaties = obsIds
          .map((id) => allObs.find((o) => o.id === id))
          .filter(Boolean)
          .map((o) => ({ icon: o.icon, naam: o.naam, uitleg: o.uitleg }));
        return { student: s, group, scored, normalMax, grade, questionScores, observaties };
      })
    )
  ).filter(Boolean);

  // Sort: group name first, then achternaam
  entries.sort((a, b) => {
    const gCmp = (a.group?.name ?? '').localeCompare(b.group?.name ?? '', 'nl');
    if (gCmp !== 0) return gCmp;
    return (a.student.achternaam ?? '').localeCompare(b.student.achternaam ?? '', 'nl');
  });

  // Pre-compute class averages once using all participants' question scores
  const allQuestionScores = entries.map((e) => e.questionScores);
  const globalMax = exam?.questions?.length
    ? Math.max(...exam.questions.map((q) => q.max_points))
    : 1;

  const studentData = entries.map((e) => ({
    name: Store.fullName(e.student),
    student_nr: String(e.student.id),
    group: e.group?.name ?? '\u2014',
    score: e.scored,
    max_score: e.normalMax,
    grade:
      e.grade !== null ? (Math.round(e.grade * 10) / 10).toFixed(1).replace('.', ',') : '\u2014',
    vragen: assembleVragen(exam, e.questionScores, allQuestionScores),
    observaties: e.observaties,
  }));

  const examInfo = {
    name: exam?.title ?? '',
    global_max_points: globalMax,
    n_term: exam?.n_term ?? 1,
  };

  let result;
  try {
    result = await window.rtti.renderRapportPdf(examId, studentData, examInfo);
  } finally {
    SEL.rapportJaarlaag.setDisabled(false);
    SEL.rapportExam.setDisabled(false);
  }

  if (!result.success) {
    content.innerHTML = `<p class="hint" style="color:var(--danger)">Compilatiefout: ${result.error}</p>`;
    // D — error toast
    toast('Compilatiefout bij het genereren van het rapport.', 'error');
    return;
  }

  // Convert Windows backslashes and build a file:// URL
  const pdfUrl = 'file:///' + result.pdfPath.replace(/\\/g, '/');
  content.innerHTML = `<iframe class="rapport-pdf-frame" src="${pdfUrl}"></iframe>`;

  // D — success toast
  toast('Rapport gegenereerd.', 'success');
}

// ═══════════════════════════════════════════════════════════════════════════════
// RTTI UITLEG / LEERADVIES MODAL
// ═══════════════════════════════════════════════════════════════════════════════

const RTTI_CATS = ['R', 'T1', 'T2', 'I'];

const RTTI_PLACEHOLDERS = {
  R: {
    uitleg:
      'Bijvoorbeeld: Reproductievragen zijn vragen die je kunt beantwoorden door de tekst in het boek en de aantekeningen te leren en goed op te letten in de les.',
    laag: 'Bijvoorbeeld: Je hebt veel punten laten liggen op Reproductie. Maak tijdens de les nauwkeurigere aantekeningen en leer deze goed voor de volgende toets. Neem ook het boek nog een keer extra door. Zet hem op!',
    midden:
      "Bijvoorbeeld: Je laat nog wat punten liggen op Reproductie. Leer voor de volgende toets goed de aantekeningen en neem het boek nog eens door. Let's go!",
    hoog: 'Bijvoorbeeld: Je hebt goed gescoord op Reproductie! Ga zo door met de aantekeningen en het bestuderen van de tekst!',
  },
  T1: {
    uitleg:
      'Bijvoorbeeld: Toepassen-1-vragen zijn vragen die erg lijken op de huiswerkopgaven, maar dan bijvoorbeeld met andere getallen. Je oefent door het huiswerk bij te houden.',
    laag: 'Bijvoorbeeld: Je hebt veel punten laten liggen op Toepassen 1. Zorg dat je het huiswerk bijhoudt en oefen de standaardopgaven goed. Je kunt het!',
    midden:
      'Bijvoorbeeld: Je laat nog wat punten liggen op Toepassen 1. Maak de oefenopgaven zorgvuldig en controleer je antwoorden. Tandje erbij!',
    hoog: 'Bijvoorbeeld: Je hebt goed gescoord op Toepassen 1! Lekker blijven oefenen!',
  },
  T2: {
    uitleg:
      'Bijvoorbeeld: Toepassen-2-vragen zijn lastigere vragen waarvoor je iets dat je hebt geleerd in een nieuwe context toe moet passen of twee dingen die je hebt geleerd samen moet gebruiken om een oplossing te vinden. Je oefent doordat je veel oefenopgaven maakt, zodat je je de stof echt eigen hebt gemaakt.',
    laag: 'Bijvoorbeeld: Je hebt veel punten laten liggen op Toepassen 2. Maak extra oefenopgaven en probeer de stof vanuit verschillende invalshoeken te bekijken. Ga ervoor!',
    midden:
      'Bijvoorbeeld: Je laat nog wat punten liggen op Toepassen 2. Oefen met gevarieerde opgaven om de stof echt eigen te maken. Ga ervoor!',
    hoog: 'Bijvoorbeeld: Je hebt goed gescoord op Toepassen 2! Lekker bezig en scherp blijven!',
  },
  I: {
    uitleg:
      'Bijvoorbeeld: Inzichtvragen zijn lastige vragen in een nieuwe context, die je alleen kunt beantwoorden als je echt begrepen hebt hoe de stof werkt. Vaak kun je de vraag pas plaatsen nadat je uitvoerig met de stof hebt geoefend en goed hebt opgelet in de les.',
    laag: 'Bijvoorbeeld: Je hebt veel punten laten liggen op Inzicht. Let extra goed op in de les en probeer te begrijpen waarom dingen werken zoals ze werken. Je kunt meer dan je denkt!',
    midden:
      'Bijvoorbeeld: Je laat nog wat punten liggen op Inzicht. Probeer verbanden te leggen tussen de verschillende onderdelen van de stof. Goed bezig!',
    hoog: 'Bijvoorbeeld: Je hebt goed gescoord op Inzicht! Dat laat zien dat je de stof echt begrijpt. Ga zo door!',
  },
};

function buildTabs(subject) {
  if (subject === 'wi') {
    return [
      { label: '1', fileKey: 'wi', jaar: 1 },
      { label: '2', fileKey: 'wi', jaar: 2 },
      { label: '3', fileKey: 'wi', jaar: 3 },
      { label: 'A4', fileKey: 'wisa', jaar: 4 },
      { label: 'A5', fileKey: 'wisa', jaar: 5 },
      { label: 'A6', fileKey: 'wisa', jaar: 6 },
      { label: 'B4', fileKey: 'wisb', jaar: 4 },
      { label: 'B5', fileKey: 'wisb', jaar: 5 },
      { label: 'B6', fileKey: 'wisb', jaar: 6 },
      { label: 'C4', fileKey: 'wisc', jaar: 4 },
      { label: 'C5', fileKey: 'wisc', jaar: 5 },
      { label: 'C6', fileKey: 'wisc', jaar: 6 },
      { label: 'D4', fileKey: 'wisd', jaar: 4 },
      { label: 'D5', fileKey: 'wisd', jaar: 5 },
      { label: 'D6', fileKey: 'wisd', jaar: 6 },
    ];
  }
  return [1, 2, 3, 4, 5, 6].map((j) => ({ label: String(j), fileKey: subject, jaar: j }));
}

function rttiExplFilePath(fileKey, jaar) {
  return `templates/RTTI explanations and advices/rtti_expl_adv_${fileKey}_${jaar}.json`;
}

function defaultTabData() {
  return {
    uitleg: { R: '', T1: '', T2: '', I: '' },
    leeradvies: {
      R: { laag: '', midden: '', hoog: '' },
      T1: { laag: '', midden: '', hoog: '' },
      T2: { laag: '', midden: '', hoog: '' },
      I: { laag: '', midden: '', hoog: '' },
    },
    grenswaarden: {
      R: { laag_midden: 40, midden_hoog: 70 },
      T1: { laag_midden: 40, midden_hoog: 70 },
      T2: { laag_midden: 40, midden_hoog: 70 },
      I: { laag_midden: 40, midden_hoog: 70 },
    },
  };
}

function buildTabHtml(data, tabs, activeTab) {
  function copyBtnHtml(block) {
    const targets = tabs
      .map((t, i) =>
        i !== activeTab ? `<button class="tog-btn" data-copy-tab="${i}">${t.label}</button>` : ''
      )
      .join('');
    return `
      <div class="rtti-copy-wrap">
        <button class="btn btn-secondary btn-sm" data-copy-open="${block}">Kopi\u00ebren naar\u2026</button>
        <div class="rtti-copy-popover hidden" data-copy-popover="${block}">
          <div class="rtti-copy-tab-grid">${targets}</div>
          <button class="btn btn-primary btn-sm" data-copy-confirm="${block}">Kopi\u00ebren</button>
        </div>
      </div>`;
  }

  const uitlegRows = RTTI_CATS.map(
    (cat) => `
    <tr>
      <td>${cat}</td>
      <td><textarea rows="3" data-uitleg="${cat}" placeholder="${RTTI_PLACEHOLDERS[cat].uitleg}">${data.uitleg[cat]}</textarea></td>
    </tr>`
  ).join('');

  const adviesRows = RTTI_CATS.filter((cat) => cat !== 'I')
    .map(
      (cat) => `
    <tr>
      <td>${cat}</td>
      <td><textarea rows="5" data-adv="${cat}-laag" placeholder="${RTTI_PLACEHOLDERS[cat].laag}">${data.leeradvies[cat].laag}</textarea></td>
      <td><textarea rows="5" data-adv="${cat}-midden" placeholder="${RTTI_PLACEHOLDERS[cat].midden}">${data.leeradvies[cat].midden}</textarea></td>
      <td><textarea rows="5" data-adv="${cat}-hoog" placeholder="${RTTI_PLACEHOLDERS[cat].hoog}">${data.leeradvies[cat].hoog}</textarea></td>
    </tr>`
    )
    .join('');

  const sliderRows = RTTI_CATS.filter((cat) => cat !== 'I')
    .map((cat) => {
      const low = data.grenswaarden[cat].laag_midden;
      const high = data.grenswaarden[cat].midden_hoog;
      return `
    <div class="slider-row">
      <span class="slider-row-cat">${cat}</span>
      <div class="dual-slider-wrap" data-slider-group="${cat}">
        <div class="dual-slider-track" data-slider-track="${cat}"></div>
        <input type="range" min="0" max="100" step="5" value="${low}" data-slider="${cat}-low">
        <input type="range" min="0" max="100" step="5" value="${high}" data-slider="${cat}-high">
      </div>
      <span class="slider-labels" data-slider-labels="${cat}">${low}% / ${high}%</span>
    </div>`;
    })
    .join('');

  return `
    <div class="rtti-uitleg-section-header">
      <h4 class="rtti-uitleg-section-title">Uitleg RTTI-categorieën</h4>
      ${copyBtnHtml('uitleg')}
    </div>
    <p class="rtti-uitleg-hint">Geef hieronder aan wat de uitleg van de verschillende RTTI-categorieën voor de leerlingen is. Deze uitleg wordt ook geprint op de toetsanalyseformulieren.</p>
    <table class="rtti-uitleg-table">
      <thead><tr><th>Cat.</th><th>Tekst</th></tr></thead>
      <tbody>${uitlegRows}</tbody>
    </table>

    <div class="rtti-uitleg-section-header">
      <h4 class="rtti-uitleg-section-title">Leeradvies RTTI-categorieën</h4>
      ${copyBtnHtml('leeradvies')}
    </div>
    <p class="rtti-uitleg-hint">Geef hieronder aan wat de tekst bij de leeradviezen per RTTI-categorie is bij verschillende scoregroepen. Bij lage scores is het advies waarschijnlijk anders dan bij hoge scores.</p>
    <table class="rtti-uitleg-table">
      <thead><tr><th>Cat.</th><th>Lage score</th><th>Middelmatige score</th><th>Hoge score</th></tr></thead>
      <tbody>${adviesRows}</tbody>
    </table>

    <div class="rtti-uitleg-section-header">
      <h4 class="rtti-uitleg-section-title">Grenswaarden leeradvies</h4>
      ${copyBtnHtml('grenswaarden')}
    </div>
    <p class="rtti-uitleg-hint">Geef hieronder aan vanaf welke score de bovenstaande leeradviezen aan een leerling moeten worden gegeven. Beide grenswaarden worden op dezelfde slider aangegeven.</p>
    ${sliderRows}
  `;
}

function updateSliderTrack(track, labels, low, high) {
  // Three-zone gradient: danger (low) → warning (mid) → success (high)
  const lo = Math.min(low, high);
  const hi = Math.max(low, high);
  track.style.background = `linear-gradient(to right,
    #e57373 0%, #e57373 ${lo}%,
    #ffd54f ${lo}%, #ffd54f ${hi}%,
    #66bb6a ${hi}%, #66bb6a 100%)`;
  labels.textContent = `${lo}% / ${hi}%`;
}

function initDualSliders(el) {
  for (const cat of RTTI_CATS.filter((c) => c !== 'I')) {
    const lowInput = el.querySelector(`[data-slider="${cat}-low"]`);
    const highInput = el.querySelector(`[data-slider="${cat}-high"]`);
    const track = el.querySelector(`[data-slider-track="${cat}"]`);
    const labels = el.querySelector(`[data-slider-labels="${cat}"]`);

    updateSliderTrack(track, labels, Number(lowInput.value), Number(highInput.value));

    lowInput.addEventListener('input', () => {
      updateSliderTrack(track, labels, Number(lowInput.value), Number(highInput.value));
    });
    highInput.addEventListener('input', () => {
      updateSliderTrack(track, labels, Number(lowInput.value), Number(highInput.value));
    });
  }
}

async function openRttiUitlegModal() {
  const subject = Store.getActiveSubject() ?? 'nat';
  const tabs = buildTabs(subject);

  const tabData = {};
  await Promise.all(
    tabs.map(async (t, i) => {
      const raw = await window.rtti.readJson(rttiExplFilePath(t.fileKey, t.jaar));
      tabData[i] = raw ?? defaultTabData();
    })
  );

  let activeTab = 0;

  const tabButtons = tabs
    .map(
      (t, i) =>
        `<button class="overview-tab${i === 0 ? ' selected' : ''}" data-tab-idx="${i}">${t.label}</button>`
    )
    .join('');

  const modalHtml = `
    <h3 class="modal-title">Leerlingrapport RTTI uitleg en leeradvies</h3>
    <div id="rtti-confirm-slot"></div>
    <div class="overview-tab-bar rtti-uitleg-tab-bar" id="rtti-uitleg-tabs">${tabButtons}</div>
    <div id="rtti-uitleg-tab-content"></div>
    <div class="rtti-uitleg-footer">
      <button class="btn btn-secondary" id="btn-rtti-uitleg-cancel">Annuleren</button>
      <button class="btn btn-primary" id="btn-rtti-uitleg-save">Opslaan</button>
    </div>
  `;

  showModal(
    modalHtml,
    (el) => {
      let _dirty = false;

      function markDirty() {
        _dirty = true;
      }

      function showUnsavedConfirm() {
        const slot = el.querySelector('#rtti-confirm-slot');
        if (slot.querySelector('.rtti-unsaved-confirm')) return; // already showing
        const bar = document.createElement('div');
        bar.className = 'rtti-unsaved-confirm';
        bar.innerHTML =
          '<span>Er zijn niet-opgeslagen wijzigingen. Toch sluiten?</span>' +
          '<div class="rtti-unsaved-actions">' +
          '<button class="btn btn-secondary btn-sm" id="btn-rtti-confirm-stay">Blijven bewerken</button>' +
          '<button class="btn btn-danger btn-sm" id="btn-rtti-confirm-discard">Toch sluiten</button>' +
          '</div>';
        slot.appendChild(bar);
        document.getElementById('modal-box').scrollTop = 0;
        bar.querySelector('#btn-rtti-confirm-stay').addEventListener('click', () => bar.remove());
        bar.querySelector('#btn-rtti-confirm-discard').addEventListener('click', () => {
          _dirty = false;
          cleanupAndClose();
        });
      }

      function tryClose() {
        if (_dirty) {
          showUnsavedConfirm();
        } else {
          cleanupAndClose();
        }
      }

      // Intercept overlay click and modal-close X button using capture phase
      const overlay = document.getElementById('modal-overlay');
      const modalCloseBtn = document.getElementById('modal-close');

      function onOverlayCapture(e) {
        if (e.target === overlay) {
          e.stopImmediatePropagation();
          tryClose();
        }
      }
      function onModalCloseBtnCapture(e) {
        e.stopImmediatePropagation();
        tryClose();
      }

      function cleanupAndClose() {
        overlay.removeEventListener('click', onOverlayCapture, true);
        modalCloseBtn.removeEventListener('click', onModalCloseBtnCapture, true);
        closeModal();
      }

      overlay.addEventListener('click', onOverlayCapture, true);
      modalCloseBtn.addEventListener('click', onModalCloseBtnCapture, true);

      function renderTab(idx) {
        el.querySelector('#rtti-uitleg-tab-content').innerHTML = buildTabHtml(
          tabData[idx],
          tabs,
          idx
        );
        initDualSliders(el);
        initCopyButtons(el, idx);
        // Mark dirty on any input change
        el.querySelector('#rtti-uitleg-tab-content').addEventListener('input', markDirty);
      }

      function initCopyButtons(el, srcIdx) {
        for (const block of ['uitleg', 'leeradvies', 'grenswaarden']) {
          const openBtn = el.querySelector(`[data-copy-open="${block}"]`);
          const popover = el.querySelector(`[data-copy-popover="${block}"]`);
          const confirmBtn = el.querySelector(`[data-copy-confirm="${block}"]`);

          openBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Close other popovers first
            el.querySelectorAll('.rtti-copy-popover').forEach((p) => {
              if (p !== popover) p.classList.add('hidden');
            });
            popover.classList.toggle('hidden');
          });

          confirmBtn.addEventListener('click', () => {
            readCurrentTabIntoData(srcIdx);
            const selected = [...popover.querySelectorAll('.tog-btn.selected')].map((b) =>
              Number(b.dataset.copyTab)
            );
            for (const destIdx of selected) {
              if (block === 'uitleg') {
                tabData[destIdx].uitleg = structuredClone(tabData[srcIdx].uitleg);
              } else if (block === 'leeradvies') {
                tabData[destIdx].leeradvies = structuredClone(tabData[srcIdx].leeradvies);
              } else {
                tabData[destIdx].grenswaarden = structuredClone(tabData[srcIdx].grenswaarden);
              }
            }
            // Deselect all and close
            popover.querySelectorAll('.tog-btn').forEach((b) => b.classList.remove('selected'));
            popover.classList.add('hidden');
            if (selected.length > 0) {
              toast(
                `${block === 'uitleg' ? 'Uitleg' : block === 'leeradvies' ? 'Leeradvies' : 'Grenswaarden'} gekopieerd naar ${selected.length} tab${selected.length > 1 ? 's' : ''}.`,
                'success'
              );
            }
          });

          // Toggle selection on tab buttons
          popover.querySelectorAll('.tog-btn[data-copy-tab]').forEach((b) => {
            b.addEventListener('click', () => b.classList.toggle('selected'));
          });
        }

        // Close popovers when clicking outside
        el.querySelector('#rtti-uitleg-tab-content').addEventListener('click', (e) => {
          if (!e.target.closest('.rtti-copy-wrap')) {
            el.querySelectorAll('.rtti-copy-popover').forEach((p) => p.classList.add('hidden'));
          }
        });
      }

      function readCurrentTabIntoData(idx) {
        const content = el.querySelector('#rtti-uitleg-tab-content');
        for (const cat of RTTI_CATS) {
          tabData[idx].uitleg[cat] = content.querySelector(`[data-uitleg="${cat}"]`).value;
          if (cat !== 'I') {
            for (const score of ['laag', 'midden', 'hoog']) {
              tabData[idx].leeradvies[cat][score] = content.querySelector(
                `[data-adv="${cat}-${score}"]`
              ).value;
            }
            tabData[idx].grenswaarden[cat].laag_midden = Number(
              content.querySelector(`[data-slider="${cat}-low"]`).value
            );
            tabData[idx].grenswaarden[cat].midden_hoog = Number(
              content.querySelector(`[data-slider="${cat}-high"]`).value
            );
          }
        }
      }

      el.querySelector('#rtti-uitleg-tabs').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-tab-idx]');
        if (!btn) return;
        readCurrentTabIntoData(activeTab);
        activeTab = Number(btn.dataset.tabIdx);
        el.querySelectorAll('.overview-tab').forEach((b) =>
          b.classList.toggle('selected', b.dataset.tabIdx === String(activeTab))
        );
        renderTab(activeTab);
      });

      el.querySelector('#btn-rtti-uitleg-cancel').addEventListener('click', () => tryClose());

      el.querySelector('#btn-rtti-uitleg-save').addEventListener('click', async () => {
        readCurrentTabIntoData(activeTab);
        const saveBtn = el.querySelector('#btn-rtti-uitleg-save');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Bezig\u2026';
        const results = await Promise.all(
          tabs.map((t, i) => window.rtti.writeJson(rttiExplFilePath(t.fileKey, t.jaar), tabData[i]))
        );
        saveBtn.disabled = false;
        saveBtn.textContent = 'Opslaan';
        if (results.every((r) => r.ok)) {
          _dirty = false;
          toast('RTTI uitleg en leeradvies opgeslagen.', 'success');
          cleanupAndClose();
        } else {
          toast('Fout bij opslaan. Controleer de logbestanden.', 'error');
        }
      });

      renderTab(0);
    },
    'modal-xl'
  );
}
