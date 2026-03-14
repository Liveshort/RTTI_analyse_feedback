/**
 * app.js — Renderer process.
 * CSP: NO inline event handlers. All cancel buttons use data-close-modal="1".
 */

// ── Navigation ───────────────────────────────────────────────────────────────
const screens = {};
document.querySelectorAll('.screen').forEach(el => {
  screens[el.id.replace('screen-', '')] = el;
});
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => navigateTo(btn.dataset.screen));
});

function navigateTo(name) {
  document.querySelectorAll('.nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.screen === name));
  Object.values(screens).forEach(s => s.classList.remove('active'));
  if (screens[name]) {
    renderScreen(name);             // render content while still hidden
    screens[name].classList.add('active');  // then reveal — no flash/reflow
    window.scrollTo(0, 0);         // reset scroll so all tabs start at top
  }
}

function renderScreen(name) {
  switch (name) {
    case 'leerlingen': return renderLeerlingen();
    case 'groepen':    return renderGroepen();
    case 'toetsen':    return renderToetsen();
    case 'scores':     return renderScores();
    case 'rapport':    return renderRapport();
  }
}

// ── Modal ─────────────────────────────────────────────────────────────────────
const overlay      = document.getElementById('modal-overlay');
const modalBox     = document.getElementById('modal-box');
const modalContent = document.getElementById('modal-content');

function showModal(html, onShow, wide = false) {
  modalContent.innerHTML = html;
  modalBox.classList.remove('modal-xl', 'modal-profile');
  if (wide === true)              modalBox.classList.add('modal-xl');
  else if (typeof wide === 'string') modalBox.classList.add(wide);
  overlay.classList.remove('hidden');
  if (onShow) onShow(modalContent);
}

function closeModal() {
  overlay.classList.add('hidden');
  modalBox.classList.remove('modal-xl', 'modal-profile');
  modalContent.innerHTML = '';
  // destroy any Chart instances that were inside the modal
  if (_modalCharts) { _modalCharts.forEach(c => { try { c.destroy(); } catch (_) {} }); _modalCharts = []; }
}

let _modalCharts = [];

modalContent.addEventListener('click', e => {
  if (e.target.closest('[data-close-modal]')) closeModal();
});
document.getElementById('modal-close').addEventListener('click', closeModal);
overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

// ── Notifications ─────────────────────────────────────────────────────────────
function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3500);
}

function persistentError(message) {
  const container = document.getElementById('toast-container');
  for (const existing of container.querySelectorAll('.toast-persistent')) {
    if (existing.dataset.msg === message) return;
  }
  const el = document.createElement('div');
  el.className = 'toast toast-error toast-persistent show';
  el.dataset.msg = message;
  el.innerHTML = `<span>${escHtml(message)}</span><button class="toast-dismiss">✕</button>`;
  el.querySelector('.toast-dismiss').addEventListener('click', () => el.remove());
  container.appendChild(el);
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatGrade(g) {
  if (g === null || g === undefined) return '—';
  return (Math.round(g * 10) / 10).toFixed(1).replace('.', ',');
}

/**
 * Wire all .num-spinner elements inside `root`.
 * The spinner stores its current numeric value in data-val.
 * Displays with comma decimal separator.
 */
function wireSpinners(root) {
  root.querySelectorAll('.num-spinner').forEach(sp => {
    const step = parseFloat(sp.dataset.step ?? 1);
    const min  = parseFloat(sp.dataset.min  ?? 0);
    const max  = parseFloat(sp.dataset.max  ?? 999);
    const dec  = (() => { const s = step.toString(); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; })();
    const inp  = sp.querySelector('.spin-val');

    function set(v) {
      v = Math.min(max, Math.max(min, Math.round(v / step) * step));
      v = parseFloat(v.toFixed(dec));
      sp.dataset.val = v;
      inp.value = v.toFixed(dec).replace('.', ',');
    }

    sp.querySelector('.spin-minus').addEventListener('click', () => set(parseFloat(sp.dataset.val) - step));
    sp.querySelector('.spin-plus' ).addEventListener('click', () => set(parseFloat(sp.dataset.val) + step));

    inp.addEventListener('change', () => {
      const v = parseFloat(inp.value.replace(',', '.'));
      if (!isNaN(v)) set(v); else inp.value = parseFloat(sp.dataset.val).toFixed(dec).replace('.', ',');
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'ArrowUp')   { e.preventDefault(); set(parseFloat(sp.dataset.val) + step); }
      if (e.key === 'ArrowDown') { e.preventDefault(); set(parseFloat(sp.dataset.val) - step); }
    });
  });
}

/** Read the current numeric value from a .num-spinner element. */
function spinnerValue(sp) {
  return parseFloat((sp?.dataset?.val ?? sp?.querySelector?.('.spin-val')?.value ?? '0').replace(',', '.'));
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };
  const semiCount = (lines[0].match(/;/g) || []).length;
  const commaCount = (lines[0].match(/,/g) || []).length;
  const delim = semiCount >= commaCount ? ';' : ',';

  function parseLine(line) {
    const result = []; let cur = '', inQ = false;
    for (const c of line) {
      if (c === '"') { inQ = !inQ; }
      else if (c === delim && !inQ) { result.push(cur.trim()); cur = ''; }
      else { cur += c; }
    }
    result.push(cur.trim());
    return result;
  }

  const headers = parseLine(lines[0]).map(h => h.replace(/^"|"$/g, '').trim());
  const rows = lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = parseLine(line).map(v => v.replace(/^"|"$/g, '').trim());
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
    return obj;
  });
  return { headers, rows };
}

/** Show a year-selection modal before running a CSV import. Returns a promise that resolves to the chosen year or null. */
function askSchoolYear(activeYear, existingYears) {
  return new Promise(resolve => {
    const allYears = [...new Set([activeYear, ...existingYears])].sort((a, b) => b.localeCompare(a));
    showModal(`
      <h3>Schooljaar kiezen</h3>
      <p class="muted" style="margin-bottom:12px">
        Voor welk schooljaar wil je deze gegevens importeren?
        Als het schooljaar al bestaat, worden de gegevens bijgewerkt.
      </p>
      <div class="form-group">
        <label>Schooljaar</label>
        <div id="f-import-year-host" class="csel-host"></div>
      </div>
      <div class="form-group">
        <label>Of voer een schooljaar in</label>
        <input id="f-import-year-custom" type="text" placeholder="2025-2026" />
      </div>
      <div class="form-actions">
        <button class="btn-primary" id="f-year-ok">Verder</button>
        <button class="btn-secondary" data-close-modal="1">Annuleren</button>
      </div>
    `, (el) => {
      const yearSel = new CustomSelect(el.querySelector('#f-import-year-host'), {
        placeholder: '— kies schooljaar —',
      });
      yearSel.setOptions(allYears.map(y => ({ value: y, label: y })));
      yearSel.setValue(activeYear);

      el.querySelector('#f-year-ok').addEventListener('click', () => {
        const custom = el.querySelector('#f-import-year-custom').value.trim();
        const chosen = custom || yearSel.getValue();
        if (!chosen) { toast('Kies een schooljaar.', 'error'); return; }
        closeModal();
        resolve(chosen);
      });
    });
    overlay.addEventListener('click', function handler(e) {
      if (e.target === overlay) { overlay.removeEventListener('click', handler); resolve(null); }
    }, { once: true });
    document.getElementById('modal-close').addEventListener('click', () => resolve(null), { once: true });
  });
}

// ── CustomSelect instances (created once at init, reused every render) ─────────
const SEL = {};   // keyed by host element id

function initSelects() {
  SEL.studentYear = new CustomSelect(document.getElementById('student-year-select'), {
    placeholder: '— kies schooljaar —',
    onChange: async (v) => { await Store.loadYear(v); leerlingenState.year = v; renderStudentList(); },
  });
  SEL.groupsYear = new CustomSelect(document.getElementById('groups-year-select'), {
    placeholder: '— kies schooljaar —',
    onChange: async (v) => { await Store.loadYear(v); renderGroepenForYear(v); },
  });
  SEL.scoreJaarlaag = new CustomSelect(document.getElementById('score-jaarlaag-select'), {
    placeholder: '— kies jaarlaag —',
    onChange: async (v) => {
      scoreState.jaarlaag = v; scoreState.examId = '';
      destroyHotInstances();
      document.getElementById('score-grid-container').innerHTML = '<p class="hint">Selecteer een toets.</p>';
      setScoreNterm('', false);
      document.getElementById('btn-edit-exam-scores').disabled = true;
      populateScoreExamSelect(v);
      // Auto-select the last exam (highest volgnummer) for this jaarlaag
      if (v) {
        const cfg = Store.getConfigSync();
        const exams = Store.getExamsSync(cfg.activeYear)
          .filter(e => String(e.jaarlaag) === String(v))
          .sort((a, b) => (b.volgnummer ?? 0) - (a.volgnummer ?? 0));
        if (exams.length > 0) {
          const lastExam = exams[0];
          scoreState.examId = lastExam.id;
          SEL.scoreExam.setValue(lastExam.id);
          setScoreNterm(lastExam.n_term, true);
          await loadScoreGrid(v, lastExam.id);
        }
      }
    },
  });
  SEL.scoreExam = new CustomSelect(document.getElementById('score-exam-select'), {
    placeholder: '— kies eerst jaarlaag —',
    onChange: async (v) => {
      scoreState.examId = v;
      document.getElementById('btn-edit-exam-scores').disabled = !v;
      if (v) {
        const ex = Store.getExamsSync(Store.getConfigSync().activeYear).find(e => e.id === v);
        if (ex) {
          setScoreNterm(ex.n_term, true);
        }
      } else {
        setScoreNterm('', false);
      }
      await loadScoreGrid(SEL.scoreJaarlaag.getValue(), v);
    },
  });
  SEL.scoreExam.setDisabled(true);
  SEL.toetsenYear = new CustomSelect(document.getElementById('toetsen-year-select'), {
    placeholder: '— kies schooljaar —',
    onChange: () => renderToetsenList(),
  });
  SEL.rapportExam = new CustomSelect(document.getElementById('rapport-exam-select'), {
    placeholder: '— kies toets —',
    onChange: (v) => {
      const content = document.getElementById('rapport-content');
      content.innerHTML = v
        ? `<p>Rapport genereren komt in Phase 4.</p>
           <button class="btn-primary" disabled>&#128196; Download .docx (binnenkort)</button>`
        : '<p class="hint">Selecteer een toets.</p>';
    },
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await Store.preload();
  initSelects();
  const cfg = Store.getConfigSync();
  document.getElementById('active-year-label').textContent = cfg.activeYear;
  renderScreen('leerlingen');
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN: Leerlingen
// ═══════════════════════════════════════════════════════════════════════════════

const leerlingenState = { year: null, search: '' };

function renderLeerlingen() {
  const cfg = Store.getConfigSync();
  const allYears = [...Store.listYearsSync()];
  if (!allYears.includes(cfg.activeYear)) allYears.unshift(cfg.activeYear);

  SEL.studentYear.setOptions(allYears.map(y => ({ value: y, label: y })));
  if (!leerlingenState.year || !allYears.includes(leerlingenState.year)) leerlingenState.year = cfg.activeYear;
  SEL.studentYear.setValue(leerlingenState.year);

  const searchInput = document.getElementById('student-search');
  searchInput.value = leerlingenState.search;
  searchInput.oninput = () => { leerlingenState.search = searchInput.value; renderStudentList(); };

  document.getElementById('btn-add-student').onclick = () => openStudentModal(null);
  document.getElementById('btn-import-students').onclick = () => openStudentCSVImport();

  renderStudentList();
}

function renderStudentList() {
  const year  = leerlingenState.year;
  const query = leerlingenState.search.trim().toLowerCase();
  const container = document.getElementById('student-list');

  let students = [...Store.getStudentsSync(year)];

  // Filter by search (after sort so filtered results stay ordered)
  if (query) {
    students = students.filter(s =>
      Store.fullName(s).toLowerCase().includes(query) ||
      String(s.id).includes(query) ||
      (s.stamklas ?? '').toLowerCase().includes(query)
    );
  }

  if (students.length === 0) {
    container.innerHTML = query
      ? '<p class="hint">Geen leerlingen gevonden voor deze zoekopdracht.</p>'
      : '<p class="hint">Geen leerlingen voor dit schooljaar. Voeg leerlingen toe of kies een ander schooljaar.</p>';
    return;
  }

  let html = '';
  let lastJl = null;
  let lastSk = null;

  for (const s of students) {
    const stamklas = s.stamklas || '—';
    const jl = Store.jaarlaagFromStamklas(stamklas) || '—';
    if (jl !== lastJl) {
      html += `<div class="section-heading-jaarlaag">Jaarlaag ${escHtml(jl)}</div>`;
      lastJl = jl; lastSk = null;
    }
    if (stamklas !== lastSk) {
      html += `<div class="section-heading-stamklas">${escHtml(stamklas)}</div>`;
      lastSk = stamklas;
    }
    html += `
      <div class="card">
        <div class="card-main">
          <div class="student-card-row">
            <button class="student-name-btn" data-action="profile" data-id="${s.id}">${escHtml(Store.fullName(s))}</button>
            <span class="card-sep">·</span>
            <span class="student-id-inline">${s.id}${s._geslacht ? ' · ' + escHtml(s._geslacht) : ''}</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn-sm" data-action="edit-student" data-id="${s.id}">Bewerken</button>
          <button class="btn-sm btn-danger" data-action="del-student" data-id="${s.id}">Verwijderen</button>
        </div>
      </div>`;
  }
  container.innerHTML = html;

  const _peers = students; // capture current filtered+sorted list for nav
  container.querySelectorAll('[data-action="profile"]').forEach(b =>
    b.addEventListener('click', () => openProfielModal(Number(b.dataset.id), null, _peers)));
  container.querySelectorAll('[data-action="edit-student"]').forEach(b =>
    b.addEventListener('click', () => openStudentModal(Number(b.dataset.id))));
  container.querySelectorAll('[data-action="del-student"]').forEach(b =>
    b.addEventListener('click', () => deleteStudent(Number(b.dataset.id))));
}


// ── Group students modal ──────────────────────────────────────────────────────
async function openGroupStudentsModal(groupId, year) {
  const group    = Store.getGroupsSync(year).find(g => g.id === groupId);
  if (!group) return;
  const allStudents = Store.getStudentsSync(year);
  const students = allStudents
    .filter(s => group.student_ids.includes(s.id))
    .sort((a, b) => (a.achternaam ?? '').localeCompare(b.achternaam ?? ''));

  // Load exams for this group's jaarlaag, sorted by volgnummer
  const exams = Store.getExamsSync(year)
    .filter(e => String(e.jaarlaag) === String(group.jaarlaag ?? ''))
    .filter(e => e.volgnummer)
    .sort((a, b) => (a.volgnummer ?? 0) - (b.volgnummer ?? 0));

  // Load all student scores (async)
  const scoreMap = {};
  for (const s of students) {
    const rec = await Store.getStudentScores(s.id, year);
    scoreMap[s.id] = rec?.scores ?? {};
  }

  // Compute grades per student per exam
  function studentGrade(s, exam) {
    const examScores = scoreMap[s.id][exam.id];
    if (!examScores || Object.keys(examScores).length === 0) return null;
    const qs = {};
    exam.questions.forEach(q => {
      const v = examScores[q.id];
      if (v !== undefined) qs[q.id] = v;
    });
    if (Object.keys(qs).length === 0) return null;
    const res = Store.calcResults(exam, qs);
    return res.grade;
  }

  // Colour for grade value (returns CSS color string)
  function gradeTextColor(g) {
    if (g === null) return 'var(--muted)';
    if (g < 5.5) return '#c0392b';
    return lerpColor('#b8860b', '#2e7d32', (g - 5.5) / 4.5);
  }
  function gradeBorderColor(g) {
    if (g === null) return 'var(--border)';
    if (g < 5.5) return '#e57373';
    return lerpColor('#ffd54f', '#66bb6a', (g - 5.5) / 4.5);
  }

  // Build header row with coloured volgnummer badges
  const examCols = exams.map(e =>
    `<th style="text-align:center;padding:2px 4px;font-weight:500;white-space:nowrap">` +
    `<span class="volgnummer" style="background:${examTypeColor(e)}">${e.volgnummer}</span></th>`
  ).join('');

  // Build student rows
  const rows = students.map(s => {
    const nameCell = `<td style="padding:4px 8px 4px 4px;white-space:nowrap">
      <button class="student-name-btn group-name-btn" data-action="open-student-from-group"
        data-id="${s.id}" data-groupid="${escHtml(groupId)}" data-year="${escHtml(year)}"
        style="font-size:13px">${escHtml(Store.fullName(s))}</button>
      <span class="card-sep" style="margin:0 4px">·</span>
      <span class="student-id-inline">${s.id}</span>
    </td>`;
    const gradeCells = exams.map(e => {
      const g = studentGrade(s, e);
      const label = g !== null ? formatGrade(g) : '—';
      const bc = gradeBorderColor(g);
      const tc = gradeTextColor(g);
      const fw = (g !== null && g < 5.5) ? 'bold' : '500';
      return `<td style="text-align:center;padding:3px 4px">
        <span style="display:inline-block;min-width:34px;padding:1px 5px;border:2px solid ${bc};
          border-radius:4px;font-size:12px;font-weight:${fw};color:${tc}">${label}</span>
      </td>`;
    }).join('');
    return `<tr>${nameCell}${gradeCells}</tr>`;
  }).join('');

  showModal(`
    <h3>${escHtml(group.name)}</h3>
    <p class="muted" style="margin-bottom:10px">${students.length} leerlingen &mdash; klik een naam om het leerlingprofiel te openen</p>
    <div style="overflow-x:auto">
      <table style="border-collapse:collapse;width:100%;font-size:13px">
        <thead><tr>
          <th style="text-align:left;padding:4px 8px 4px 4px;font-weight:600">Naam</th>
          ${examCols}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `, (el) => {
    el.querySelectorAll('[data-action="open-student-from-group"]').forEach(b =>
      b.addEventListener('click', () =>
        openProfielModal(Number(b.dataset.id),
          () => openGroupStudentsModal(b.dataset.groupid, b.dataset.year),
          students)
      ));
  }, true); // wide modal
}

// ── Student profile modal ─────────────────────────────────────────────────
async function openProfielModal(studentId, backFn = null, peers = null) {
  const year     = leerlingenState.year || Store.getConfigSync().activeYear;
  const students = await Store.getStudents(year);
  const student  = students.find(s => s.id === studentId);
  if (!student) return;

  const history = await Store.getStudentHistory(studentId);

  if (history.length === 0) {
    showModal(`
      <h3>${escHtml(Store.fullName(student))}</h3>
      <p class="hint">Nog geen scores voor deze leerling.</p>
    `);
    return;
  }

  const results = history.map(({ exam, questionScores }) => ({
    exam, res: Store.calcResults(exam, questionScores)
  }));

  // ── Weighted avg helper ──────────────────────────────────────────────────
  function calcWeightedAvg(rs) {
    let sumW = 0, sumWG = 0;
    for (const { exam, res } of rs) {
      if (res.grade === null) continue;
      const w = Number(exam.weging ?? 1);
      sumW += w; sumWG += w * res.grade;
    }
    return sumW > 0 ? Math.round(sumWG / sumW * 100) / 100 : null;
  }

  // ── Year groups for graph 1 ──────────────────────────────────────────────
  const barLabels = results.map(r => r.exam.volgnummer ? `${r.exam.volgnummer}` : r.exam.title);
  const grades    = results.map(r => r.res.grade !== null ? Math.round(r.res.grade * 10) / 10 : null);
  const barColors = results.map(r => examTypeColor(r.exam));

  const yearGroups = [];
  results.forEach((r, i) => {
    const yr = r.exam.academic_year ?? '\u2014';
    if (!yearGroups.length || yearGroups[yearGroups.length - 1].year !== yr)
      yearGroups.push({ year: yr, startIdx: i, endIdx: i });
    else yearGroups[yearGroups.length - 1].endIdx = i;
  });

  const yearGroupPlugin = {
    id: 'yearGroups',
    afterDraw(chart) {
      const { ctx, scales: { x, y } } = chart;
      const bandY = x.bottom + 4;
      const bandH = 18;
      ctx.save();
      ctx.font = 'bold 11px sans-serif';
      ctx.textBaseline = 'middle';
      yearGroups.forEach((g, gi) => {
        const half = x.width / (2 * barLabels.length);
        const x0   = x.getPixelForValue(g.startIdx) - half;
        const x1   = x.getPixelForValue(g.endIdx)   + half;
        ctx.fillStyle = gi % 2 === 0 ? 'rgba(74,144,217,.08)' : 'rgba(0,0,0,.03)';
        ctx.fillRect(x0, bandY, x1 - x0, bandH);
        if (gi > 0) {
          ctx.strokeStyle = '#c8d4e8'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x0, y.bottom); ctx.lineTo(x0, bandY + bandH); ctx.stroke();
        }
        ctx.fillStyle = '#4A90D9'; ctx.textAlign = 'center';
        ctx.fillText(g.year, (x0 + x1) / 2, bandY + bandH / 2);
      });
      ctx.restore();
    }
  };

  // ── Per-year stats for graph 3 ───────────────────────────────────────────
  const allYears     = [...new Set(results.map(r => r.exam.academic_year))].sort();
  const ptaResults   = results.filter(r => r.exam.type === 'pta');
  const avgByYear    = allYears.map(yr => calcWeightedAvg(results.filter(r => r.exam.academic_year === yr)));
  const dossierAvg   = calcWeightedAvg(ptaResults);
  const avg3Labels   = [...allYears, 'Examendossier'];
  const avg3Data     = [...avgByYear, dossierAvg];
  const avg3Colors   = [...allYears.map(() => '#4A90D9'), '#d9534f'];

  showModal(`
    <div style="padding:0 2px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:8px;flex-wrap:wrap">
        <div>${backFn ? '<button class=\"btn-secondary btn-sm\" id=\"mc-prof-back\">← Terug</button>' : ''}</div>
        <div style="display:flex;gap:6px" id="mc-prof-nav"></div>
      </div>
      <h3 style="margin-bottom:12px">${escHtml(Store.fullName(student))}</h3>
      <h4 style="margin:0 0 6px">Cijferverloop</h4>
      <div class="chart-wrap" style="height:300px;margin-bottom:16px"><canvas id="mc-grades"></canvas></div>
      <div style="display:flex;gap:16px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <h4 style="margin:0">RTTI-score per toets</h4>
            <div id="mc-rtti-year-host" class="csel-host" style="width:180px"></div>
          </div>
          <div class="chart-wrap" style="height:240px"><canvas id="mc-rtti"></canvas></div>
        </div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;margin-bottom:8px">
            <h4 style="margin:0">Gemiddeld cijfer per schooljaar</h4>
            <div style="height:30px;width:1px"></div>
          </div>
          <div class="chart-wrap" style="height:240px"><canvas id="mc-avg"></canvas></div>
        </div>
      </div>
    </div>
  `, (el) => {
    if (backFn) el.querySelector('#mc-prof-back')?.addEventListener('click', backFn);
    // Wire prev/next navigation
    if (peers && peers.length > 1) {
      const navEl = el.querySelector('#mc-prof-nav');
      const idx = peers.findIndex(p => p.id === studentId);
      const prev = idx > 0 ? peers[idx - 1] : null;
      const next = idx < peers.length - 1 ? peers[idx + 1] : null;
      if (prev) {
        const pb = document.createElement('button');
        pb.className = 'btn-secondary btn-sm';
        pb.textContent = `← ${Store.fullName(prev)}`;
        pb.addEventListener('click', () => openProfielModal(prev.id, backFn, peers));
        navEl.appendChild(pb);
      }
      if (next) {
        const nb = document.createElement('button');
        nb.className = 'btn-secondary btn-sm';
        nb.textContent = `${Store.fullName(next)} →`;
        nb.addEventListener('click', () => openProfielModal(next.id, backFn, peers));
        navEl.appendChild(nb);
      }
    }
    // Double-rAF: wait two paint frames so fullscreen layout fully settles before Chart.js measures canvas sizes
    requestAnimationFrame(() => requestAnimationFrame(() => {
    // ── Shared bar-label plugin factory ─────────────────────────────────
    // Draws the value on top of each bar; NVT bars use a grey 50%-height stand-in
    function makeBarLabelPlugin(opts = {}) {
      return {
        id: 'barLabels',
        afterDatasetsDraw(chart) {
          const { ctx } = chart;
          chart.data.datasets.forEach((ds, di) => {
            const meta = chart.getDatasetMeta(di);
            if (meta.hidden) return;
            meta.data.forEach((bar, pi) => {
              const raw = ds.data[pi];
              if (raw === null || raw === undefined) return;
              const nvtArr = opts.nvt?.[di];
              const isNvt  = nvtArr?.[pi] === true;
              const text   = isNvt ? 'NVT' : (opts.format ? opts.format(raw, di, pi) : String(Math.round(raw)));
              ctx.save();
              ctx.fillStyle    = isNvt ? '#8895a4' : '#333';
              ctx.font         = opts.font || 'bold 9px sans-serif';
              ctx.textAlign    = 'center';
              ctx.textBaseline = 'bottom';
              ctx.fillText(text, bar.x, bar.y - 2);
              ctx.restore();
            });
          });
        }
      };
    }

        // ── Graph 1: Cijferverloop ─────────────────────────────────────────────
    const gc = new Chart(el.querySelector('#mc-grades'), {
      type: 'bar',
      plugins: [yearGroupPlugin, makeBarLabelPlugin({ font: 'bold 10px sans-serif', format: (v) => formatGrade(v) })],
      data: {
        labels: barLabels,
        datasets: [{
          label: 'Cijfer', data: grades,
          backgroundColor: barColors,
          borderColor: barColors.map(c => c + 'cc'),
          borderWidth: 1, borderRadius: 3,
        }]
      },
      options: {
        maintainAspectRatio: false,
        layout: { padding: { bottom: 32 } },
        scales: {
          y: {
            min: 1, max: 10,
            ticks: {
              stepSize: 0.5,
              callback: v => Number.isInteger(v) ? v : '',
            },
            grid: {
              color:     ctx => Number.isInteger(ctx.tick.value) ? 'rgba(0,0,0,.08)' : 'rgba(0,0,0,.03)',
              lineWidth: ctx => Number.isInteger(ctx.tick.value) ? 1 : 0.5,
            },
          },
          x: { grid: { display: false } }
        },
        plugins: {
          legend: { display: false },
          annotation: {
            annotations: {
              passLine: {
                type: 'line', yMin: 5.5, yMax: 5.5,
                borderColor: 'rgba(120,120,120,.55)',
                borderWidth: 1.5, borderDash: [5, 4],
              }
            }
          },
          tooltip: {
            callbacks: {
              title: (items) => {
                const r = results[items[0].dataIndex];
                return (r.exam.volgnummer ? `Toets ${r.exam.volgnummer}: ` : '') + r.exam.title;
              },
              label: (item) => ` Cijfer: ${formatGrade(item.raw)}`,
            }
          }
        }
      }
    });

    // ── Graph 3: Avg grades per year ───────────────────────────────────────
    const avgChart = new Chart(el.querySelector('#mc-avg'), {
      type: 'bar',
      plugins: [makeBarLabelPlugin({ font: 'bold 10px sans-serif', format: (v) => formatGrade(v) })],
      data: {
        labels: avg3Labels,
        datasets: [{
          label: 'Gemiddeld cijfer',
          data: avg3Data,
          backgroundColor: avg3Colors,
          borderColor: avg3Colors.map(c => c + 'cc'),
          borderWidth: 1, borderRadius: 3,
        }]
      },
      options: {
        maintainAspectRatio: false,
        layout: { padding: { bottom: 4 } },
        scales: {
          y: {
            min: 1, max: 10,
            ticks: { stepSize: 1, autoSkip: false },
            grid: { color: 'rgba(0,0,0,.06)' },
          },
          x: { grid: { display: false } }
        },
        plugins: {
          legend: { display: false },
          annotation: {
            annotations: {
              passLine: {
                type: 'line', yMin: 5.5, yMax: 5.5,
                borderColor: 'rgba(120,120,120,.55)',
                borderWidth: 1.5, borderDash: [5, 4],
              }
            }
          },
          tooltip: {
            callbacks: {
              label: (item) => ` Gemiddeld: ${formatGrade(item.raw)}`,
            }
          }
        }
      }
    });

    // ── Graph 2: RTTI per toets (with year selector) ───────────────────────
    const profielState = { rttiChart: null };

    function buildRttiChart(selectedYear) {
      if (profielState.rttiChart) {
        _modalCharts = _modalCharts.filter(c => c !== profielState.rttiChart);
        profielState.rttiChart.destroy();
        profielState.rttiChart = null;
      }

      let filtered;
      if (selectedYear === 'examendossier') {
        filtered = results.filter(r => r.exam.type === 'pta');
      } else {
        filtered = results.filter(r => r.exam.academic_year === selectedYear);
      }

      const canvas  = el.querySelector('#mc-rtti');
      const rLabels = filtered.map(r => r.exam.volgnummer ? `${r.exam.volgnummer}` : r.exam.title);

      function avg(cat) {
        const vals = filtered.map(r => r.res[cat] === 'NVT' ? null : r.res[cat]).filter(v => v !== null);
        return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
      }

      const NVT_CLR = '#c0c8d4';
      // Helper: map raw value to chart data (NVT → 50 for grey bar at half height)
      const toVal   = v => v === 'NVT' ? 50  : (v === null ? null : v);
      const toClr   = (v, c) => v === 'NVT' ? NVT_CLR : c;
      const isNvtFn = v => v === 'NVT';

      // Add gap + average bar at end
      const labels  = filtered.length ? [...rLabels, null, 'Gem.'] : ['Gem.'];
      const gap     = filtered.length ? [null] : [];
      const gapB    = filtered.length ? [false] : [];

      const cats = { R: '#5cb85c', T1: '#5bc0de', T2: '#f0ad4e', I: '#d9534f' };
      const datasets = Object.entries(cats).map(([cat, color]) => {
        const raw = filtered.map(r => r.res[cat]);
        const data   = [...raw.map(toVal),       ...gap, avg(cat)];
        const colors = [...raw.map(v => toClr(v, color)), ...(gap.length ? [null] : []), color];
        const nvtArr = [...raw.map(isNvtFn),     ...gapB, false];
        return { label: cat, data, backgroundColor: colors, nvtArr };
      });

      // Build nvt map for plugin: { datasetIndex: nvtArray }
      const nvtMap = {};
      datasets.forEach((ds, di) => { nvtMap[di] = ds.nvtArr; });

      profielState.rttiChart = new Chart(canvas, {
        type: 'bar',
        plugins: [makeBarLabelPlugin({ nvt: nvtMap, format: (v, di, pi) => {
          if (nvtMap[di]?.[pi]) return 'NVT';
          return Math.round(v) + '%';
        }}), {
          id: 'legendMargin',
          beforeInit(chart) {
            const orig = chart.legend.fit.bind(chart.legend);
            chart.legend.fit = function() { orig(); this.height += 14; };
          }
        }],
        data: {
          labels,
          datasets: datasets.map(({ label, data, backgroundColor }) => ({
            label, data, backgroundColor,
          }))
        },
        options: {
          maintainAspectRatio: false,
          layout: { padding: {} },
          scales: { y: { min: 0, max: 100, ticks: { callback: v => v + '%' } } },
          plugins: {
            legend: {
              position: 'top',
              labels: {
                generateLabels(chart) {
                  const catColors = { R: '#5cb85c', T1: '#5bc0de', T2: '#f0ad4e', I: '#d9534f' };
                  return chart.data.datasets.map((ds, i) => ({
                    text: ds.label,
                    fillStyle: catColors[ds.label] ?? ds.backgroundColor,
                    strokeStyle: catColors[ds.label] ?? ds.backgroundColor,
                    lineWidth: 0,
                    hidden: !chart.isDatasetVisible(i),
                    datasetIndex: i,
                  }));
                }
              }
            }
          }
        }
      });
      _modalCharts.push(profielState.rttiChart);
    }

    const rttiyearSel = new CustomSelect(el.querySelector('#mc-rtti-year-host'), {
      placeholder: '\u2014 kies jaar \u2014',
      onChange: (val) => buildRttiChart(val),
    });
    rttiyearSel.setOptions([
      ...allYears.map(y => ({ value: y, label: y })),
      { value: 'examendossier', label: 'Examendossier' },
    ]);
    const initYear = allYears[allYears.length - 1];
    rttiyearSel.setValue(initYear);
    buildRttiChart(initYear);

    _modalCharts = [gc, avgChart];
  })); // end double-requestAnimationFrame
  }, 'modal-profile');
}

// ── Student add/edit modal ────────────────────────────────────────────────────
function openStudentModal(id) {
  showModal(`
    <h3>${id ? 'Leerling bewerken' : 'Leerling toevoegen'}</h3>
    <div class="form-row">
      <div class="form-group" style="flex:1">
        <label>Leerlingnummer</label>
        <input id="f-sid" type="number" placeholder="105455" ${id ? 'disabled' : ''} />
      </div>
      <div class="form-group" style="flex:1">
        <label>Geslacht</label>
        <div id="f-sgeslacht-host" class="csel-host"></div>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group" style="flex:2">
        <label>Voornaam</label>
        <input id="f-svoornaam" type="text" />
      </div>
      <div class="form-group" style="flex:1">
        <label>Tussenvoegsel</label>
        <input id="f-stussen" type="text" placeholder="van" />
      </div>
      <div class="form-group" style="flex:2">
        <label>Achternaam</label>
        <input id="f-sachter" type="text" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group" style="flex:2">
        <label>Stamklas</label>
        <input id="f-sstamklas" type="text" placeholder="5A" />
      </div>
      <div class="form-group" style="flex:1.5">
        <label>Schooljaar</label>
        <div id="f-syear-label" style="padding:7px 0;font-size:13px;color:var(--muted);font-style:italic"></div>
      </div>
    </div>
    <div class="form-actions">
      <button class="btn-primary" id="f-s-save">Opslaan</button>
      <button class="btn-secondary" data-close-modal="1">Annuleren</button>
    </div>
  `, async (el) => {
    const year = leerlingenState.year || Store.getConfigSync().activeYear;
    el.querySelector('#f-syear-label').textContent = year;

    const geslachtSel = new CustomSelect(el.querySelector('#f-sgeslacht-host'), {
      placeholder: '—',
    });
    geslachtSel.setOptions([
      { value: '',  label: '—' },
      { value: 'M', label: 'M' },
      { value: 'V', label: 'V' },
      { value: 'X', label: 'X' },
    ]);
    geslachtSel.setValue('');

    if (id) {
      const s = (await Store.getStudents(year)).find(s => s.id === id);
      if (s) {
        el.querySelector('#f-sid').value        = s.id;
        el.querySelector('#f-svoornaam').value  = s.voornaam ?? '';
        el.querySelector('#f-stussen').value    = s.tussenvoegsel ?? '';
        el.querySelector('#f-sachter').value    = s.achternaam ?? s.name ?? '';
        el.querySelector('#f-sstamklas').value  = s.stamklas ?? '';
        geslachtSel.setValue(s.geslacht ?? '');
      }
    }

    el.querySelector('#f-s-save').addEventListener('click', async () => {
      const sid = Number(el.querySelector('#f-sid').value);
      const achternaam = el.querySelector('#f-sachter').value.trim();
      if (!sid || !achternaam) { toast('Vul leerlingnummer en achternaam in.', 'error'); return; }
      await Store.upsertStudent({
        id: sid,
        voornaam:      el.querySelector('#f-svoornaam').value.trim(),
        tussenvoegsel: el.querySelector('#f-stussen').value.trim(),
        achternaam,
        stamklas:  el.querySelector('#f-sstamklas').value.trim(),
        geslacht:  geslachtSel.getValue(),
      }, year);
      closeModal();
      toast('Leerling opgeslagen.', 'success');
      renderLeerlingen();
    });
  });
}

async function deleteStudent(id) {
  if (!confirm('Leerling verwijderen?')) return;
  await Store.deleteStudent(id, leerlingenState.year);
  toast('Leerling verwijderd.', 'info');
  renderStudentList();
}

// ── Student CSV import ────────────────────────────────────────────────────────
async function openStudentCSVImport() {
  const cfg = await Store.getConfig();
  const existingYears = Store.listYearsSync();

  const year = await askSchoolYear(cfg.activeYear, existingYears);
  if (!year) return;

  showModal(`
    <h3>Leerlingen importeren — ${escHtml(year)}</h3>
    <p class="muted" style="margin-bottom:12px">
      Verwachte kolommen: <code>Leerlingnummer, Voornaam, Tussenvoegsel, Achternaam, Geslacht, Stamklas</code>
    </p>
    <div class="form-group">
      <label>CSV-bestand</label>
      <input type="file" id="f-csv-students" accept=".csv,.txt" />
    </div>
    <div id="csv-preview"></div>
    <div class="form-actions" style="margin-top:12px">
      <button class="btn-primary" id="f-csv-import" disabled>Importeren</button>
      <button class="btn-secondary" data-close-modal="1">Annuleren</button>
    </div>
  `, (el) => {
    let parsed = null;
    el.querySelector('#f-csv-students').addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      parsed = parseCSV(await file.text()).rows;
      const preview = el.querySelector('#csv-preview');
      if (!parsed.length) {
        preview.innerHTML = '<p class="hint">Geen rijen gevonden.</p>';
        el.querySelector('#f-csv-import').disabled = true; return;
      }
      preview.innerHTML = `
        <p style="margin:8px 0 4px"><strong>${parsed.length}</strong> leerlingen gevonden (eerste 5):</p>
        <table class="preview-table">
          <thead><tr>${Object.keys(parsed[0]).map(h => `<th>${escHtml(h)}</th>`).join('')}</tr></thead>
          <tbody>${parsed.slice(0,5).map(r =>
            `<tr>${Object.values(r).map(v => `<td>${escHtml(v)}</td>`).join('')}</tr>`).join('')}
          </tbody></table>`;
      el.querySelector('#f-csv-import').disabled = false;
    });
    el.querySelector('#f-csv-import').addEventListener('click', async () => {
      if (!parsed) return;
      const students = parsed.map(r => ({
        id: Number(r['Leerlingnummer'] ?? r['leerlingnummer']),
        voornaam:      r['Voornaam']      ?? r['voornaam']      ?? '',
        tussenvoegsel: r['Tussenvoegsel'] ?? r['tussenvoegsel'] ?? '',
        achternaam:    r['Achternaam']    ?? r['achternaam']    ?? '',
        geslacht:      r['Geslacht']      ?? r['geslacht']      ?? '',
        stamklas:      r['Stamklas']      ?? r['stamklas']      ?? '',
      })).filter(s => s.id && s.achternaam);
      await Store.upsertStudents(students, year);
      closeModal();
      toast(`${students.length} leerlingen geïmporteerd voor ${year}.`, 'success');
      leerlingenState.year = year;
      renderLeerlingen();
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN: Groepen
// ═══════════════════════════════════════════════════════════════════════════════
function renderGroepen() {
  const cfg = Store.getConfigSync();
  const years = [...Store.listYearsSync()];
  if (!years.includes(cfg.activeYear)) years.unshift(cfg.activeYear);

  const currentYear = SEL.groupsYear.getValue() || cfg.activeYear;
  SEL.groupsYear.setOptions(years.map(y => ({ value: y, label: y })));
  SEL.groupsYear.setValue(years.includes(currentYear) ? currentYear : years[0]);

  document.getElementById('btn-add-group').onclick = () => openGroupModal(null);
  document.getElementById('btn-import-groups').onclick = () => openGroupCSVImport();
  renderGroepenForYear(SEL.groupsYear.getValue());
}

function renderGroepenForYear(year) {
  const groups = Store.getGroupsSync(year);
  const students = Store.getStudentsSync(year);
  const container = document.getElementById('group-list');

  groups.sort((a, b) =>
    String(a.jaarlaag).localeCompare(String(b.jaarlaag), undefined, { numeric: true }) ||
    a.name.localeCompare(b.name)
  );

  if (groups.length === 0) {
    container.innerHTML = `<p class="hint">Geen groepen voor ${escHtml(year)}.</p>`; return;
  }

  let html = ''; let lastJl = null;
  for (const g of groups) {
    const jl = String(g.jaarlaag ?? '—');
    if (jl !== lastJl) {
      html += `<div class="section-heading-jaarlaag">Jaarlaag ${escHtml(jl)}</div>`;
      lastJl = jl;
    }
    const memberNames = g.student_ids
      .map(id => { const s = students.find(s => s.id === id); return s ? (s.voornaam || Store.fullName(s)) : `#${id}`; })
      .sort().join(', ');
    html += `
      <div class="card">
        <div class="card-main">
          <button class="student-name-btn group-name-btn" data-action="open-group" data-id="${escHtml(g.id)}">${escHtml(g.name)}</button>
          <span class="muted">${g.student_ids.length} leerlingen</span>
          <p class="small">${escHtml(memberNames) || '—'}</p>
        </div>
        <div class="card-actions">
          <button class="btn-sm" data-action="edit-group" data-id="${escHtml(g.id)}">Bewerken</button>
          <button class="btn-sm btn-danger" data-action="del-group" data-id="${escHtml(g.id)}">Verwijderen</button>
        </div>
      </div>`;
  }
  container.innerHTML = html;
  container.querySelectorAll('[data-action="open-group"]').forEach(b =>
    b.addEventListener('click', () => openGroupStudentsModal(b.dataset.id, SEL.groupsYear.getValue() || Store.getConfigSync().activeYear)));
  container.querySelectorAll('[data-action="edit-group"]').forEach(b =>
    b.addEventListener('click', () => openGroupModal(b.dataset.id)));
  container.querySelectorAll('[data-action="del-group"]').forEach(b =>
    b.addEventListener('click', () => deleteGroup(b.dataset.id)));
}

async function openGroupModal(id) {
  const year = SEL.groupsYear.getValue() || Store.getConfigSync().activeYear;
  const students = await Store.getStudents(year);
  students.sort((a, b) => Store.fullName(a).localeCompare(Store.fullName(b)));

  let group = { id: '', name: '', jaarlaag: '', student_ids: [] };
  if (id) {
    const all = await Store.getGroups(year);
    group = JSON.parse(JSON.stringify(all.find(g => g.id === id) ?? group));
  }

  showModal(`
    <h3>${id ? 'Groep bewerken' : 'Groep toevoegen'}</h3>
    <div class="form-row">
      <div class="form-group" style="flex:2">
        <label>Naam (bijv. 6nat4)</label>
        <input id="f-gname" type="text" value="${escHtml(group.name)}" />
      </div>
      <div class="form-group" style="flex:1.5">
        <label>Jaarlaag</label>
        <div class="btn-toggle-group">
          ${[1,2,3,4,5,6].map(n =>
            `<button class="tog-btn jl-btn${String(group.jaarlaag) === String(n) ? ' selected' : ''}" data-jl="${n}">${n}</button>`
          ).join('')}
        </div>
      </div>
    </div>
    <div class="form-group">
      <label>Leerlingen</label>
      <div class="checkbox-list" id="f-gstudents">
        ${students.map(s => `
          <label class="checkbox-item">
            <input type="checkbox" value="${s.id}" ${group.student_ids.includes(s.id) ? 'checked' : ''} />
            ${escHtml(Store.fullName(s))} <span class="muted">(${s.id})</span>
          </label>`).join('')}
      </div>
    </div>
    <div class="form-actions">
      <button class="btn-primary" id="f-g-save">Opslaan</button>
      <button class="btn-secondary" data-close-modal="1">Annuleren</button>
    </div>
  `, (el) => {
    // Jaarlaag toggle buttons
    el.querySelectorAll('.jl-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        el.querySelectorAll('.jl-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });

    el.querySelector('#f-g-save').addEventListener('click', async () => {
      const name     = el.querySelector('#f-gname').value.trim();
      const jaarlaag = exam.jaarlaag;  // locked field — read from exam object, not DOM
      const ids = [...el.querySelectorAll('#f-gstudents input:checked')].map(i => Number(i.value));
      if (!name) { toast('Vul een naam in.', 'error'); return; }
      const gid = id || Store.makeGroupId(name, year);
      await Store.upsertGroup({ id: gid, name, jaarlaag, student_ids: ids }, year);
      closeModal(); toast('Groep opgeslagen.', 'success'); renderGroepen();
    });
  });
}

async function deleteGroup(id) {
  if (!confirm('Groep verwijderen?')) return;
  const year = SEL.groupsYear.getValue() || Store.getConfigSync().activeYear;
  await Store.deleteGroup(id, year);
  toast('Groep verwijderd.', 'info'); renderGroepen();
}

async function openGroupCSVImport() {
  const cfg = await Store.getConfig();
  const existingYears = Store.listYearsSync();
  const year = await askSchoolYear(cfg.activeYear, existingYears);
  if (!year) return;

  showModal(`
    <h3>Groepen importeren — ${escHtml(year)}</h3>
    <p class="muted" style="margin-bottom:12px">
      Verwachte kolommen: <code>Jaarlaag, Groep, Leerlingnummer</code>
    </p>
    <div class="form-group">
      <label>CSV-bestand</label>
      <input type="file" id="f-csv-groups" accept=".csv,.txt" />
    </div>
    <div id="csv-grp-preview"></div>
    <div class="form-actions" style="margin-top:12px">
      <button class="btn-primary" id="f-csv-grp-import" disabled>Importeren</button>
      <button class="btn-secondary" data-close-modal="1">Annuleren</button>
    </div>
  `, (el) => {
    let groupMap = null;
    el.querySelector('#f-csv-groups').addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      const { rows } = parseCSV(await file.text());
      groupMap = {};
      for (const r of rows) {
        const jaarlaag = String(r['Jaarlaag'] ?? r['jaarlaag'] ?? '').trim();
        const naam     = (r['Groep'] ?? r['groep'] ?? '').trim();
        const llnr     = Number(r['Leerlingnummer'] ?? r['leerlingnummer']);
        if (!naam || !llnr) continue;
        if (!groupMap[naam]) groupMap[naam] = { jaarlaag, name: naam, student_ids: [] };
        if (!groupMap[naam].student_ids.includes(llnr)) groupMap[naam].student_ids.push(llnr);
      }
      const entries = Object.values(groupMap);
      el.querySelector('#csv-grp-preview').innerHTML = entries.length === 0
        ? '<p class="hint">Geen groepen gevonden.</p>'
        : `<p style="margin:8px 0 4px"><strong>${entries.length}</strong> groepen:</p>
           <table class="preview-table">
             <thead><tr><th>Groep</th><th>Jaarlaag</th><th>Leerlingen</th></tr></thead>
             <tbody>${entries.map(g =>
               `<tr><td>${escHtml(g.name)}</td><td>${escHtml(g.jaarlaag)}</td><td>${g.student_ids.length}</td></tr>`
             ).join('')}</tbody></table>`;
      el.querySelector('#f-csv-grp-import').disabled = entries.length === 0;
    });
    el.querySelector('#f-csv-grp-import').addEventListener('click', async () => {
      if (!groupMap) return;
      const toSave = Object.values(groupMap).map(g => ({
        id: Store.makeGroupId(g.name, year), name: g.name,
        jaarlaag: g.jaarlaag, student_ids: g.student_ids,
      }));
      await Store.upsertGroups(toSave, year);
      closeModal(); toast(`${toSave.length} groepen geïmporteerd voor ${year}.`, 'success'); renderGroepen();
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN: Toetsen
// ═══════════════════════════════════════════════════════════════════════════════
function renderToetsen() {
  const cfg = Store.getConfigSync();
  const years = [...Store.listYearsSync()];
  if (!years.includes(cfg.activeYear)) years.unshift(cfg.activeYear);

  const currentYear = SEL.toetsenYear.getValue() || cfg.activeYear;
  SEL.toetsenYear.setOptions(years.map(y => ({ value: y, label: y })));
  SEL.toetsenYear.setValue(years.includes(currentYear) ? currentYear : years[0]);

  document.getElementById('btn-add-exam').onclick = () => openExamModal(null);
  renderToetsenList();
}


async function computeExamStats(year, exam) {
  const students = Store.getStudentsSync(year);
  const examMaxTotal = exam.questions.reduce((s,q) => s + q.max_points, 0);
  const grades = [], points = [];
  for (const s of students) {
    const rec = await Store.getStudentScores(s.id, year);
    const examScores = rec?.scores?.[exam.id];
    if (!examScores || Object.keys(examScores).length === 0) continue;
    const qs = {};
    exam.questions.forEach(q => { const v = examScores[q.id]; if (v !== undefined) qs[q.id] = v; });
    if (Object.keys(qs).length === 0) continue;
    const res = Store.calcResults(exam, qs);
    if (res.grade !== null) { grades.push(res.grade); points.push(res.scored); }
  }
  if (grades.length === 0) return null;
  const mean = arr => arr.reduce((a,b)=>a+b,0)/arr.length;
  const sd   = (arr,m) => arr.length<2 ? 0 : Math.sqrt(arr.reduce((s,v)=>s+(v-m)**2,0)/arr.length);
  const mg = mean(grades), mp = mean(points);
  return {
    n:      grades.length,
    avgPts: mp.toFixed(1).replace('.',','),
    avgG:   mg.toFixed(1).replace('.',','),
    sd:     sd(grades,mg).toFixed(1).replace('.',','),
    fails:  Math.round(grades.filter(g=>g<5.5).length / grades.length * 100),
    examMaxTotal,
  };
}

async function renderToetsenList() {
  const year = SEL.toetsenYear.getValue();
  const exams = Store.getExamsSync(year);
  const container = document.getElementById('exam-list');

  exams.sort((a, b) =>
    String(a.jaarlaag).localeCompare(String(b.jaarlaag), undefined, { numeric: true }) ||
    (a.volgnummer ?? 0) - (b.volgnummer ?? 0)
  );

  if (exams.length === 0) {
    container.innerHTML = `<p class="hint">Geen toetsen voor ${escHtml(year)}.</p>`; return;
  }

  let html = ''; let lastJl = null;
  for (const e of exams) {
    const jl = String(e.jaarlaag ?? '—');
    if (jl !== lastJl) {
      html += `<div class="section-heading-jaarlaag">Jaarlaag ${escHtml(jl)}</div>`;
      lastJl = jl;
    }
    const total = e.questions.reduce((s, q) => s + q.max_points, 0);
    const cats = ['R','T1','T2','I'].map(c => {
      const pts = e.questions.filter(q => q.rtti === c).reduce((s,q) => s + q.max_points, 0);
      return pts > 0 ? `${c}: ${pts}p` : null;
    }).filter(Boolean).join(' · ');
    html += `
      <div class="card">
        <div class="card-main">
          <strong>${e.volgnummer ? `<span class="volgnummer" style="background:${examTypeColor(e)}">${e.volgnummer}</span> ` : ''}<button class="student-name-btn exam-title-link" data-action="goto-scores" data-examid="${escHtml(e.id)}" data-jaarlaag="${escHtml(String(e.jaarlaag))}">${escHtml(e.title)}</button></strong>
          <span class="muted">
            ${e.periode ? 'Periode ' + escHtml(String(e.periode)) + ' · ' : ''}
            ${e.questions.length} vragen · ${total}p · N-term: ${String(e.n_term).replace('.',',')} · Weging: ${String(e.weging ?? 1).replace('.',',')}
          </span>
          <span class="rtti-summary">${cats}</span>
          <span class="exam-stats muted" data-examid="${escHtml(e.id)}" style="display:none"></span>
        </div>
        <div class="card-actions">
          <button class="btn-sm" data-action="edit-exam" data-id="${escHtml(e.id)}">Bewerken</button>
          <button class="btn-sm btn-danger" data-action="del-exam" data-id="${escHtml(e.id)}">Verwijderen</button>
        </div>
      </div>`;
  }
  container.innerHTML = html;

  container.querySelectorAll('[data-action="edit-exam"]').forEach(b =>
    b.addEventListener('click', () => openExamModal(b.dataset.id)));
  container.querySelectorAll('[data-action="del-exam"]').forEach(b =>
    b.addEventListener('click', () => deleteExam(b.dataset.id)));
  container.querySelectorAll('[data-action="goto-scores"]').forEach(b =>
    b.addEventListener('click', () => {
      scoreState.jaarlaag = b.dataset.jaarlaag;
      scoreState.examId   = b.dataset.examid;
      SEL.scoreJaarlaag.setValue(b.dataset.jaarlaag);
      SEL.scoreExam.setValue(b.dataset.examid);
      navigateTo('scores');
    }));

  // Fill in per-exam stats asynchronously (reads from score cache, non-blocking)
  for (const e of exams) {
    const statsEl = container.querySelector(`.exam-stats[data-examid="${CSS.escape(e.id)}"]`);
    if (!statsEl) continue;
    computeExamStats(year, e).then(st => {
      if (!st) { statsEl.remove(); return; }
      const gv = parseFloat(st.avgG.replace(',','.'));
      const circleColor = gv < 5.5
        ? '#e57373'
        : lerpColor('#ffd54f', '#66bb6a', (gv - 5.5) / 4.5);
      statsEl.innerHTML =
        `<svg width="10" height="10" viewBox="0 0 10 10" style="vertical-align:middle;margin-right:5px;flex-shrink:0"><circle cx="5" cy="5" r="5" fill="${circleColor}"/></svg>` +
        `Gemiddelde: <strong>${st.avgG}</strong> ± ${st.sd}. Onvoldoende: <strong>${st.fails}%</strong>.`;
      statsEl.style.display = 'flex';
      statsEl.style.alignItems = 'center';
    });
  }
}

async function openExamModal(existingId, afterSave = null) {
  const cfg = await Store.getConfig();
  const toetsYear = SEL.toetsenYear.getValue() || cfg.activeYear;
  await Store.loadYear(toetsYear);

  if (!existingId) {
    showModal(`
      <h3>Nieuwe toets — stap 1 van 2</h3>
      <div class="form-row" style="align-items:flex-end;gap:20px">
        <div class="form-group" style="flex:999;min-width:0;margin-bottom:0">
          <label>Naam</label>
          <input id="f-etitle" type="text" placeholder="PTA t.na-3 (H4, 9, 11, K3)" />
        </div>
        <div class="form-group" style="flex:none;margin-bottom:0">
          <label>PTA</label>
          <button type="button" class="pta-btn" id="f-epta-btn" data-checked="false">✓</button>
        </div>
        <div style="flex:1"></div>
        <div class="form-group" style="flex:none;width:110px;margin-bottom:0">
          <label>Schooljaar</label>
          <div id="f-exam-year-label" style="height:30px;display:flex;align-items:center;font-size:13px;color:var(--muted);font-style:italic"></div>
        </div>
      </div>
      <div class="form-row" style="align-items:flex-end;gap:20px;margin-top:10px">
        <div class="form-group" style="flex:2;margin-bottom:0">
          <label>Jaarlaag</label>
          <div class="btn-toggle-group">
            ${[1,2,3,4,5,6].map(n =>
              `<button class="tog-btn jl-btn" data-jl="${n}">${n}</button>`
            ).join('')}
          </div>
        </div>
        <div class="form-group" style="flex:2;margin-bottom:0">
          <label>Periode</label>
          <div class="btn-toggle-group">
            ${[1,2,3,4,5].map(n =>
              `<button class="tog-btn per-btn" data-per="${n}">${n}</button>`
            ).join('')}
          </div>
        </div>
        <div class="form-group spinner-wrap-sm" style="margin-bottom:0">
          <label>Weging</label>
          <div class="num-spinner" id="f-eweging" data-val="1" data-step="0.5" data-min="0" data-max="10">
            <button type="button" class="spin-btn spin-minus">−</button>
            <input class="spin-val" value="1" />
            <button type="button" class="spin-btn spin-plus">+</button>
          </div>
        </div>
        <div class="form-group spinner-wrap-sm" style="margin-bottom:0">
          <label>N-term</label>
          <div class="num-spinner" id="f-enterm" data-val="1" data-step="0.1" data-min="0" data-max="3">
            <button type="button" class="spin-btn spin-minus">−</button>
            <input class="spin-val" value="1,0" />
            <button type="button" class="spin-btn spin-plus">+</button>
          </div>
        </div>
      </div>
      <div class="form-row" style="margin-top:10px;gap:20px">
        <div class="form-group" style="flex:2">
          <label>Opgave- &amp; Vraagstructuur</label>
          <div id="f-struct-host" class="csel-host"></div>
        </div>
        <div class="form-group" style="flex:none;width:108px">
          <label>Aantal vragen</label>
          <div class="num-spinner" id="f-enum" data-val="10" data-step="1" data-min="1" data-max="40">
            <button type="button" class="spin-btn spin-minus">−</button>
            <input class="spin-val" value="10" />
            <button type="button" class="spin-btn spin-plus">+</button>
          </div>
        </div>
      </div>
      <div class="form-actions">
        <button class="btn-primary" id="f-e-next">Verder →</button>
        <button class="btn-secondary" data-close-modal="1">Annuleren</button>
      </div>
    `, (el) => {
      el.querySelector('#f-exam-year-label').textContent = toetsYear;

      const ptaBtn = el.querySelector('#f-epta-btn');
      ptaBtn.addEventListener('click', () => {
        ptaBtn.dataset.checked = String(ptaBtn.dataset.checked !== 'true');
      });

      el.querySelectorAll('.jl-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          el.querySelectorAll('.jl-btn').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
        });
      });
      el.querySelectorAll('.per-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const already = btn.classList.contains('selected');
          el.querySelectorAll('.per-btn').forEach(b => b.classList.remove('selected'));
          if (!already) btn.classList.add('selected');
        });
      });

      wireSpinners(el);

      const structSel = new CustomSelect(el.querySelector('#f-struct-host'), { placeholder: '— kies structuur —' });
      structSel.setOptions([
        { value: 'roman',  label: 'I1 I2 II3 … (Romeins cijfer + Volgnummer)' },
        { value: 'alpha',  label: '1a 1b 2a … (Opgave + Letter)' },
        { value: 'alpha2', label: 'A1 A2 B3 … (Sectieletter + Volgnummer)' },
        { value: 'seq',    label: '1, 2, 3, … (Volgnummer)' },
      ]);
      structSel.setValue('roman');

      el.querySelector('#f-e-next').addEventListener('click', () => {
        const title         = el.querySelector('#f-etitle').value.trim();
        const jlBtn         = el.querySelector('.jl-btn.selected');
        const jaarlaag      = jlBtn ? jlBtn.dataset.jl : '';
        const structureMode = structSel.getValue() || 'roman';
        const nterm         = spinnerValue(el.querySelector('#f-enterm'));
        const weging        = spinnerValue(el.querySelector('#f-eweging'));
        const periode       = el.querySelector('.per-btn.selected')?.dataset.per || null;
        const isPta         = ptaBtn.dataset.checked === 'true';
        const count         = Math.round(spinnerValue(el.querySelector('#f-enum')));
        if (!title || isNaN(nterm) || count < 1) { toast('Vul alle velden in.', 'error'); return; }
        const exam = {
          id: Store.makeExamId(title, toetsYear), title, jaarlaag,
          n_term: nterm, weging, periode, type: isPta ? 'pta' : 'regular',
          structureMode,
          questions: Array.from({ length: count }, (_, i) => ({
            id: `q${i+1}`, section: 'I', number: i + 1, max_points: 2, rtti: 'T1'
          }))
        };
        showExamEditor(exam, false, toetsYear, afterSave);
      });
    });
  } else {
    const all = await Store.getExams(toetsYear);
    const exam = JSON.parse(JSON.stringify(all.find(e => e.id === existingId)));
    if (!exam.structureMode) {
      const firstSec = exam.questions[0]?.section ?? '';
      exam.structureMode = SEC_ROMAN.includes(firstSec) ? 'roman' : SEC_ALPHA2.includes(firstSec) ? 'alpha2' : (firstSec === '' || firstSec == null) ? 'seq' : 'alpha';
    }
    showExamEditor(exam, true, toetsYear, afterSave);
  }
}

// Helpers for cascade-based section/number system
const SEC_ROMAN  = ['I','II','III','IV','V','VI','VII','VIII','IX','X'];
const SEC_ALPHA2 = ['A','B','C','D','E','F','G','H','I','J'];

function extractBoundaries(questions, mode) {
  const b = new Array(questions.length).fill(null);
  if (!questions.length) return b;
  b[0] = 1;
  let lastSec = secIndexOf(questions[0], mode);
  for (let i = 1; i < questions.length; i++) {
    const sec = secIndexOf(questions[i], mode);
    if (sec !== lastSec) { b[i] = sec; lastSec = sec; }
  }
  return b;
}

function secIndexOf(q, mode) {
  if (mode === 'seq') return 1;
  if (mode === 'roman') {
    const idx = SEC_ROMAN.indexOf(q.section);
    return idx >= 0 ? idx + 1 : 1;
  }
  if (mode === 'alpha2') {
    const idx = SEC_ALPHA2.indexOf(q.section);
    return idx >= 0 ? idx + 1 : 1;
  }
  const n = parseInt(q.section, 10);
  return isNaN(n) ? 1 : n;
}

function cascadeStructure(questions, boundaries, mode) {
  let currentSec = 1, letterIdx = 0;
  questions.forEach((q, i) => {
    const b = boundaries[i];
    if (b !== null && b !== undefined) {
      if (b !== currentSec) letterIdx = 0;
      currentSec = b;
    }
    if (mode === 'seq') {
      q.section = '';
      q.number  = i + 1;
    } else if (mode === 'roman') {
      q.section = SEC_ROMAN[Math.min(currentSec - 1, 14)];
      q.number  = i + 1;
    } else if (mode === 'alpha2') {
      q.section = SEC_ALPHA2[Math.min(currentSec - 1, 14)];
      q.number  = i + 1;
    } else {
      // alpha: 1a 1b 2a ...
      q.section = String(currentSec);
      q.number  = String.fromCharCode(96 + letterIdx + 1);
      letterIdx++;
    }
  });
}

function showExamEditor(exam, isEdit, toetsYear, afterSave = null) {
  const mode       = exam.structureMode ?? 'roman';
  const secLabels  = mode === 'roman' ? SEC_ROMAN : mode === 'alpha2' ? SEC_ALPHA2 : mode === 'seq' ? Array.from({length:10}, () => '') : Array.from({length:10}, (_,i) => String(i+1));
  const boundaries = extractBoundaries(exam.questions, mode);
  cascadeStructure(exam.questions, boundaries, mode);

  showModal(`
    <h3>${isEdit ? 'Toets bewerken' : 'Nieuwe toets — stap 2 van 2'}: <em>${escHtml(exam.title)}</em></h3>
    <div class="form-row" style="align-items:flex-end;gap:20px;margin-bottom:10px;flex-wrap:nowrap">
      <div class="form-group" style="flex:2;min-width:0;margin-bottom:0">
        <label>Naam</label>
        <input id="f-etitle2" type="text" value="${escHtml(exam.title)}" />
      </div>
      <div class="form-group" style="flex:none;margin-bottom:0">
        <label>PTA</label>
        <button type="button" class="pta-btn" id="f-epta-btn"
          data-checked="${exam.type === 'pta' ? 'true' : 'false'}">✓</button>
      </div>
      <div class="form-group" style="flex:none;width:90px;margin-bottom:0">
        <label>Schooljaar</label>
        <input id="f-eyear2" type="text" value="${escHtml(toetsYear)}" readonly
          style="background:var(--bg);color:var(--muted);font-size:12px;padding:0 6px" />
      </div>
      <div class="form-group" style="flex:none;margin-bottom:0">
        <label>Jaar</label>
        <button class="tog-btn jl-btn jl-locked selected" disabled>${escHtml(String(exam.jaarlaag))}</button>
      </div>
      <div class="form-group" style="flex:1.5;margin-bottom:0">
        <label>Periode</label>
        <div class="btn-toggle-group">
          ${[1,2,3,4,5].map(n =>
            `<button class="tog-btn per-btn${String(exam.periode) === String(n) ? ' selected' : ''}" data-per="${n}">${n}</button>`
          ).join('')}
        </div>
      </div>
      <div class="form-group spinner-wrap-sm" style="margin-bottom:0">
        <label>Weging</label>
        <div class="num-spinner" id="f-eweging2" data-val="${exam.weging ?? 1}" data-step="0.5" data-min="0" data-max="10">
          <button type="button" class="spin-btn spin-minus">−</button>
          <input class="spin-val" value="${String(exam.weging ?? 1).replace('.',',')}" />
          <button type="button" class="spin-btn spin-plus">+</button>
        </div>
      </div>
      <div class="form-group spinner-wrap-sm" style="margin-bottom:0">
        <label>N-term</label>
        <div class="num-spinner" id="f-enterm2" data-val="${exam.n_term}" data-step="0.1" data-min="0" data-max="3">
          <button type="button" class="spin-btn spin-minus">−</button>
          <input class="spin-val" value="${String(exam.n_term).replace('.',',')}" />
          <button type="button" class="spin-btn spin-plus">+</button>
        </div>
      </div>
    </div>
    <div class="questions-scroll">
      <table class="questions-table">
        <thead><tr>
          <th style="width:270px">Opgave</th>
          <th style="width:60px">Vraag</th>
          <th style="width:290px">Max punten</th>
          <th>RTTI</th>
          <th style="width:36px"></th>
        </tr></thead>
        <tbody id="f-qbody"></tbody>
      </table>
    </div>
    <button class="btn-secondary" id="f-addq" style="margin-top:8px">+ Vraag toevoegen</button>
    <div class="form-actions" style="margin-top:14px">
      <button class="btn-primary" id="f-esave">Opslaan</button>
      <button class="btn-secondary" data-close-modal="1">Annuleren</button>
    </div>
  `, (el) => {
    const tbody = el.querySelector('#f-qbody');

    // PTA toggle button
    const ptaBtn2 = el.querySelector('#f-epta-btn');
    ptaBtn2.addEventListener('click', () => {
      ptaBtn2.dataset.checked = String(ptaBtn2.dataset.checked !== 'true');
    });

    // Periode toggle buttons
    el.querySelectorAll('.per-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const already = btn.classList.contains('selected');
        el.querySelectorAll('.per-btn').forEach(b => b.classList.remove('selected'));
        if (!already) btn.classList.add('selected');
      });
    });

    wireSpinners(el);

    function renderQRows() {
      cascadeStructure(exam.questions, boundaries, mode);
      tbody.innerHTML = exam.questions.map((q, i) => {
        const effectiveSec = secIndexOf(q, mode);
        const secBtns = secLabels.map((label, si) => {
          const secNum     = si + 1;
          const isSelected = effectiveSec === secNum;
          const isLocked   = i === 0;
          const isSeq = mode === 'seq';
          return `<button class="sec-btn${isSelected && !isSeq ? ' selected' : ''}${isLocked || isSeq ? ' locked' : ''} ${isSeq ? 'sec-btn-inactive' : ''}" data-qi="${i}" data-sec="${secNum}" ${isSeq ? 'disabled' : ''}>${isSeq ? '' : escHtml(label)}</button>`;
        }).join('');
        const nrLabel = mode === 'seq' ? escHtml(String(q.number)) : `${escHtml(String(q.section))}${escHtml(String(q.number))}`;
        return `
          <tr data-qi="${i}">
            <td><div class="sec-btn-group">${secBtns}</div></td>
            <td><span class="qi-nr-display">${nrLabel}</span></td>
            <td>
              <div class="btn-toggle-group">
                ${Array.from({length:11}, (_,n) =>
                  `<button class="tog-btn pts-btn${q.max_points===n?' selected':''}" data-qi="${i}" data-pts="${n}">${n}</button>`
                ).join('')}
              </div>
            </td>
            <td>
              <div class="btn-toggle-group">
                ${['R','T1','T2','I'].map(cat =>
                  `<button class="tog-btn rtti-btn${q.rtti===cat?' selected':''}" data-qi="${i}" data-rtti="${cat}">${cat}</button>`
                ).join('')}
              </div>
            </td>
            <td><button class="btn-sm btn-danger qi-del" data-qi="${i}">\u2715</button></td>
          </tr>`;
      }).join('');
    }

    tbody.addEventListener('click', e => {
      if (e.target.matches('.sec-btn')) {
        const i = Number(e.target.dataset.qi);
        if (i === 0) return;
        boundaries[i] = Number(e.target.dataset.sec);
        renderQRows();
        return;
      }
      if (e.target.matches('.pts-btn')) {
        const i = Number(e.target.dataset.qi);
        exam.questions[i].max_points = Number(e.target.dataset.pts);
        e.target.closest('.btn-toggle-group').querySelectorAll('.pts-btn')
          .forEach(b => b.classList.toggle('selected', b === e.target));
        return;
      }
      if (e.target.matches('.rtti-btn')) {
        const i = Number(e.target.dataset.qi);
        exam.questions[i].rtti = e.target.dataset.rtti;
        e.target.closest('.btn-toggle-group').querySelectorAll('.rtti-btn')
          .forEach(b => b.classList.toggle('selected', b === e.target));
        return;
      }
      if (e.target.matches('.qi-del')) {
        const i = Number(e.target.dataset.qi);
        exam.questions.splice(i, 1);
        boundaries.splice(i, 1);
        if (boundaries.length > 0) boundaries[0] = 1;
        renderQRows();
      }
    });

    el.querySelector('#f-addq').addEventListener('click', () => {
      const last = exam.questions[exam.questions.length - 1];
      exam.questions.push({
        id: `q${exam.questions.length + 1}`,
        section: last?.section ?? 'I', number: (last?.number ?? 0) + 1,
        max_points: last?.max_points ?? 2, rtti: 'T1'
      });
      boundaries.push(null);
      renderQRows();
    });

    el.querySelector('#f-esave').addEventListener('click', async () => {
      cascadeStructure(exam.questions, boundaries, mode);
      const title    = el.querySelector('#f-etitle2').value.trim();
      const jaarlaag = exam.jaarlaag;  // locked field — read from exam object, not DOM
      const nterm    = spinnerValue(el.querySelector('#f-enterm2'));
      const weging   = spinnerValue(el.querySelector('#f-eweging2'));
      const periode  = el.querySelector('.per-btn.selected')?.dataset.per || null;
      const isPta    = el.querySelector('#f-epta-btn').dataset.checked === 'true';
      if (!title || isNaN(nterm) || exam.questions.length === 0) {
        toast('Vul alle velden in en zorg voor minstens \u00e9\u00e9n vraag.', 'error'); return;
      }
      await Store.upsertExam({ ...exam, title, jaarlaag, n_term: nterm, weging, periode, structureMode: mode, type: isPta ? 'pta' : 'regular' }, toetsYear);
      closeModal(); toast('Toets opgeslagen.', 'success'); if (afterSave) afterSave(); else renderToetsen();
    });
    renderQRows();
  }, true);
}

async function deleteExam(id) {
  if (!confirm('Toets verwijderen?')) return;
  const toetsYear = SEL.toetsenYear.getValue() || Store.getConfigSync().activeYear;
  await Store.deleteExam(id, toetsYear);
  toast('Toets verwijderd.', 'info'); renderToetsen();
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN: Scores invoeren
// Col layout: [id, naam, ...N scores, spacer, totaal, cijfer, spacer, R%, T1%, T2%, I%]
// ═══════════════════════════════════════════════════════════════════════════════

// ── Colour helpers ────────────────────────────────────────────────────────────
/**
 * Returns the badge/bar colour for an exam based on its type field.
 *   'pta' → red, 'po' → amber/yellow, anything else → blue
 */
function examTypeColor(exam) {
  if (exam?.type === 'pta') return '#d9534f';
  if (exam?.type === 'po')  return '#f0ad4e';
  return '#4A90D9';  // regular toets
}

function hexToRgb(hex) {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
}
function lerpColor(hex1, hex2, t) {
  const [r1,g1,b1] = hexToRgb(hex1), [r2,g2,b2] = hexToRgb(hex2);
  return `rgb(${Math.round(r1+(r2-r1)*t)},${Math.round(g1+(g2-g1)*t)},${Math.round(b1+(b2-b1)*t)})`;
}
function stdDevGradeColor(sdStr) {
  if (!sdStr) return null;
  const n = parseFloat(String(sdStr).replace(',', '.'));
  if (isNaN(n)) return null;
  const t = Math.min(1, n / 2.0);
  if (t <= 0.5) return lerpColor('#c3e6cb', '#fff3cd', t * 2);
  return lerpColor('#fff3cd', '#f8d7da', (t - 0.5) * 2);
}

function setScoreNterm(v, enable = true) {
  const sp = document.getElementById('score-nterm');
  if (!sp) return;
  const inp = sp.querySelector('.spin-val');
  const btns = sp.querySelectorAll('.spin-btn');
  if (enable && v !== null && v !== undefined && v !== '') {
    const n = parseFloat(String(v).replace(',', '.'));
    if (!isNaN(n)) {
      sp.dataset.val = n;
      inp.value = n.toFixed(1).replace('.', ',');
    }
    sp.classList.remove('spinner-disabled');
    btns.forEach(b => b.disabled = false);
    inp.disabled = false;
  } else {
    sp.dataset.val = '';
    inp.value = '';
    sp.classList.add('spinner-disabled');
    btns.forEach(b => b.disabled = true);
    inp.disabled = true;
  }
}

function gradeColor(gradeStr) {
  if (!gradeStr || gradeStr === '—') return null;
  const n = parseFloat(String(gradeStr).replace(',', '.'));
  if (isNaN(n)) return null;
  if (n < 5.5) return '#f8d7da';
  return lerpColor('#fff3cd', '#c3e6cb', (n - 5.5) / 4.5);
}
function rttiPctColor(valStr) {
  if (!valStr || valStr === 'NVT') return null;
  const pct = parseInt(valStr);
  if (isNaN(pct)) return null;
  const t = Math.max(0, Math.min(100, pct)) / 100;
  return t <= 0.5
    ? lerpColor('#f8d7da', '#fff3cd', t * 2)
    : lerpColor('#fff3cd', '#c3e6cb', (t - 0.5) * 2);
}

// ── Persistent state ──────────────────────────────────────────────────────────
const scoreState = { jaarlaag: '', examId: '' };
let activeExam = null;
let activeGridData = [];
let hotInstances = [];

function destroyHotInstances() {
  hotInstances.forEach(h => { try { h.destroy(); } catch (_) {} });
  hotInstances = []; activeGridData = []; activeExam = null;
}

function populateScoreExamSelect(jl) {
  const cfg = Store.getConfigSync();
  if (!jl) {
    SEL.scoreExam.setOptions([{ value: '', label: '— kies eerst jaarlaag —' }]);
    SEL.scoreExam.setValue('');
    SEL.scoreExam.setDisabled(true);
    setScoreNterm('', false);
    return;
  }
  const exams = Store.getExamsSync(cfg.activeYear)
    .filter(e => String(e.jaarlaag) === String(jl))
    .sort((a, b) => (a.volgnummer ?? 0) - (b.volgnummer ?? 0));
  SEL.scoreExam.setOptions(exams.map(e => ({
    value: e.id,
    label: (e.volgnummer ? e.volgnummer + ' \u2013 ' : '') + e.title,
  })));
  SEL.scoreExam.setDisabled(false);
  if (scoreState.examId && exams.find(e => e.id === scoreState.examId))
    SEL.scoreExam.setValue(scoreState.examId);
}

function renderScores() {
  const cfg = Store.getConfigSync();
  const allGroups = Store.getGroupsSync(cfg.activeYear);
  const jaarlagenSet = new Set(allGroups.map(g => String(g.jaarlaag ?? '')).filter(Boolean));
  const jaarlagen = [...jaarlagenSet].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  SEL.scoreJaarlaag.setOptions(jaarlagen.map(j => ({ value: j, label: j })));
  if (scoreState.jaarlaag && jaarlagen.includes(scoreState.jaarlaag))
    SEL.scoreJaarlaag.setValue(scoreState.jaarlaag);

  populateScoreExamSelect(SEL.scoreJaarlaag.getValue());

  const scoreNtermSp = document.getElementById('score-nterm');
  // Wire display (data-val) updates first, then attach save logic
  wireSpinners(document.getElementById('screen-scores'));
  async function handleNtermChange() {
    const val = spinnerValue(scoreNtermSp);
    if (isNaN(val) || !activeExam) return;
    activeExam.n_term = val;
    await Store.upsertExam({ ...activeExam }, cfg.activeYear);
    activeGridData.forEach(gd => {
      const ai = gd.findIndex(r=>r[0]==='__avg__');
      const si2 = gd.findIndex(r=>r[0]==='__std__');
      gd.forEach((_, ri) => { if (ri < ai) recomputeRow(gd, activeExam, ri); });
      recomputeSummaryRow(gd, ai, si2, activeExam);
    });
    hotInstances.forEach(h => h.render());
  }
  // Bind handleNtermChange AFTER wireSpinners so data-val is already updated when we read it
  scoreNtermSp.querySelectorAll('.spin-btn').forEach(b =>
    b.addEventListener('click', () => setTimeout(handleNtermChange, 0)));
  scoreNtermSp.querySelector('.spin-val')?.addEventListener('change', handleNtermChange);

  document.getElementById('btn-edit-exam-scores').onclick = () => {
    const examId = SEL.scoreExam.getValue();
    if (!examId) { toast('Selecteer eerst een toets.', 'error'); return; }
    openExamModal(examId, () => {
      renderToetsenList();
      const ex = Store.getExamsSync(cfg.activeYear).find(e => e.id === examId);
      if (ex) { activeExam = { ...ex }; setScoreNterm(ex.n_term, true); }
      activeGridData.forEach(gd => {
        const ai = gd.findIndex(r=>r[0]==='__avg__');
        const si2 = gd.findIndex(r=>r[0]==='__std__');
        gd.forEach((_, ri) => { if (ri < ai) recomputeRow(gd, activeExam, ri); });
        recomputeSummaryRow(gd, ai, si2, activeExam);
      });
      hotInstances.forEach(h => h.render());
    });
  };

  // setValue() does not fire onChange, so set button state explicitly here
  const currentExamId = SEL.scoreExam.getValue();
  document.getElementById('btn-edit-exam-scores').disabled = !currentExamId;
  if (SEL.scoreJaarlaag.getValue() && currentExamId) {
    const ex = Store.getExamsSync(cfg.activeYear).find(e => e.id === currentExamId);
    if (ex) setScoreNterm(ex.n_term, true);
    loadScoreGrid(SEL.scoreJaarlaag.getValue(), currentExamId);
  }
}

async function loadScoreGrid(jaarlaag, examId) {
  destroyHotInstances();
  const container = document.getElementById('score-grid-container');
  if (!examId) { container.innerHTML = '<p class="hint">Selecteer een toets.</p>'; return; }

  const cfg  = Store.getConfigSync();
  const year = cfg.activeYear;
  const exam = Store.getExamsSync(year).find(e => e.id === examId);
  if (!exam) return;
  activeExam = { ...exam };

  const groups = Store.getGroupsSync(year)
    .filter(g => String(g.jaarlaag) === String(jaarlaag))
    .sort((a, b) => a.name.localeCompare(b.name));
  const allStudents = Store.getStudentsSync(year);

  if (groups.length === 0) {
    container.innerHTML = '<p class="hint">Geen groepen gevonden. Voeg eerst groepen toe.</p>'; return;
  }

  container.innerHTML = '';

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    const groupStudents = allStudents
      .filter(s => group.student_ids.includes(s.id))
      .sort((a, b) => (a.achternaam ?? '').localeCompare(b.achternaam ?? ''));
    if (groupStudents.length === 0) continue;

    const section = document.createElement('div');
    section.className = 'score-group-section';
    section.innerHTML = `<h3 class="group-heading">${escHtml(group.name)}</h3><div id="hot-g${gi}"></div>`;
    container.appendChild(section);

    // Row: [id, naam, ...N scores, spacer, totaal, cijfer, spacer, R%, T1%, T2%, I%]
    const N = exam.questions.length;
    const gridData = [];
    for (const s of groupStudents) {
      const rec = await Store.getStudentScores(s.id, year);
      const examScores = rec.scores[examId] ?? {};
      const row = [String(s.id), Store.fullName(s)];
      exam.questions.forEach(q => {
        const v = examScores[q.id];
        row.push(v === undefined ? '' : v === null ? 'N' : String(v));
      });
      row.push('', '', '', '', '', '', '', ''); // spacer, totaal, cijfer, spacer, R%, T1%, T2%, I%
      gridData.push(row);
    }

    // Summary rows: avg (sentinel __avg__) then std dev (sentinel __std__)
    gridData.push(['__avg__', 'Gemiddelde',      ...Array(N).fill(''), '', '', '', '', '', '', '', '']);
    gridData.push(['__std__', 'Standaarddeviatie',...Array(N).fill(''), '', '', '', '', '', '', '', '']);

    const avgIdx = gridData.length - 2;
    const stdIdx = gridData.length - 1;
    gridData.forEach((_, ri) => { if (ri < avgIdx) recomputeRow(gridData, activeExam, ri); });
    recomputeSummaryRow(gridData, avgIdx, stdIdx, activeExam);
    activeGridData.push(gridData);

    const hot = createGroupHOT(document.getElementById(`hot-g${gi}`), activeExam, groupStudents, gridData, year);
    hotInstances.push(hot);
  }
}

/**
 * Col offsets (N = number of questions):
 *   0      = leerlingnummer
 *   1      = naam
 *   2..N+1 = question scores
 *   N+2    = spacer
 *   N+3    = totaal  ("scored / examMaxTotal")
 *   N+4    = cijfer
 *   N+5    = spacer
 *   N+6    = R%
 *   N+7    = T1%
 *   N+8    = T2%
 *   N+9    = I%
 * Last row in gridData is always the summary (average) row.
 */
function recomputeRow(gridData, exam, rowIdx) {
  const N = exam.questions.length;
  const row = gridData[rowIdx];
  const examMaxTotal = exam.questions.reduce((s, q) => s + q.max_points, 0);

  const questionScores = {};
  exam.questions.forEach((q, qi) => {
    const raw = row[2 + qi];
    if (raw === '' || raw === undefined || raw === null) return;
    const s = String(raw).toUpperCase().trim();
    if (s === 'N') { questionScores[q.id] = null; return; }
    const n = Number(raw);
    questionScores[q.id] = isNaN(n) ? raw : n;
  });

  if (Object.keys(questionScores).length === 0) {
    row[N+2]=''; row[N+3]=''; row[N+4]=''; row[N+5]='';
    row[N+6]=''; row[N+7]=''; row[N+8]=''; row[N+9]=''; return;
  }

  const res = Store.calcResults(exam, questionScores);
  row[N+2] = '';
  row[N+3] = `${res.scored} / ${examMaxTotal}`;
  row[N+4] = res.grade !== null ? formatGrade(res.grade) : '';
  row[N+5] = '';
  row[N+6] = res.R  === 'NVT' ? 'NVT' : res.R  + '%';
  row[N+7] = res.T1 === 'NVT' ? 'NVT' : res.T1 + '%';
  row[N+8] = res.T2 === 'NVT' ? 'NVT' : res.T2 + '%';
  row[N+9] = res.I  === 'NVT' ? 'NVT' : res.I  + '%';
}

function recomputeSummaryRow(gridData, summaryIdx, stdIdx, exam) {
  const N = exam.questions.length;
  const examMaxTotal = exam.questions.reduce((s, q) => s + q.max_points, 0);
  const totaals = [], grades = [];

  for (let r = 0; r < summaryIdx; r++) {
    const totaalStr = gridData[r][N+3];
    const gradeStr  = gridData[r][N+4];
    if (totaalStr) {
      const scored = parseInt(totaalStr, 10);
      if (!isNaN(scored)) totaals.push(scored);
    }
    if (gradeStr && gradeStr !== '—') {
      const g = parseFloat(gradeStr.replace(',', '.'));
      if (!isNaN(g)) grades.push(g);
    }
  }

  // Avg row
  const avgRow = gridData[summaryIdx];
  const meanTotaal = totaals.length > 0 ? totaals.reduce((a,b)=>a+b,0)/totaals.length : null;
  const meanGrade  = grades.length  > 0 ? grades.reduce((a,b)=>a+b,0)/grades.length   : null;
  avgRow[N+2] = '';
  avgRow[N+3] = meanTotaal !== null ? meanTotaal.toFixed(1).replace('.',',') + ' / ' + examMaxTotal : '';
  avgRow[N+4] = meanGrade  !== null ? meanGrade.toFixed(1).replace('.',',') : '';
  avgRow[N+5] = ''; avgRow[N+6] = ''; avgRow[N+7] = ''; avgRow[N+8] = ''; avgRow[N+9] = '';

  // Std dev row
  if (stdIdx == null) return;
  const sdRow = gridData[stdIdx];
  function sd(arr, mean) {
    if (arr.length < 2) return null;
    const variance = arr.reduce((s,v) => s + (v-mean)**2, 0) / arr.length;
    return Math.sqrt(variance);
  }
  const sdTotaal = meanTotaal !== null ? sd(totaals, meanTotaal) : null;
  const sdGrade  = meanGrade  !== null ? sd(grades,  meanGrade)  : null;
  sdRow[N+2] = '';
  sdRow[N+3] = sdTotaal !== null ? sdTotaal.toFixed(1).replace('.',',') : '';
  sdRow[N+4] = sdGrade  !== null ? sdGrade.toFixed(1).replace('.',',')  : '';
  sdRow[N+5] = ''; sdRow[N+6] = ''; sdRow[N+7] = ''; sdRow[N+8] = ''; sdRow[N+9] = '';
}

function createGroupHOT(container, exam, students, gridData, year) {
  const N = exam.questions.length;
  const summaryIdx = gridData.findIndex(r => r[0] === '__avg__');
  const stdIdx     = gridData.findIndex(r => r[0] === '__std__');

  // Question headers: RTTI (top) → pts (+ gap below) → section → number (bottom)
  // All spans same font size; whitespace gap added via padding-bottom on hdr-pts
  const qHeaders = exam.questions.map(q =>
    `<span class="hdr-rtti">${escHtml(q.rtti)}</span>` +
    `<span class="hdr-pts">${q.max_points}p</span>` +
    `<span class="hdr-opgave">${escHtml(q.section)}</span>` +
    `<span class="hdr-vraag">${q.number}</span>`
  );

  const colHeaders = ['#', 'Naam', ...qHeaders, '', 'Totaal', 'Cijfer', '', 'R%', 'T1%', 'T2%', 'I%'];

  // ── Custom renderers ──────────────────────────────────────────────────────

  function idRenderer(hot, TD, row, col, prop, value) {
    Handsontable.renderers.TextRenderer.apply(this, arguments);
    const isSpecial = row === summaryIdx || row === stdIdx;
    TD.style.background = isSpecial ? '#e8ecf2' : '#f8f9fb';
    TD.style.textAlign  = 'center';
    if (isSpecial) TD.style.color = 'transparent';
  }

  function naamRenderer(hot, TD, row, col, prop, value) {
    Handsontable.renderers.TextRenderer.apply(this, arguments);
    const isSpecial = row === summaryIdx || row === stdIdx;
    TD.style.background = isSpecial ? '#e8ecf2' : '#f8f9fb';
    TD.style.color      = isSpecial ? 'var(--muted, #7f8c8d)' : '#000';
    TD.style.fontWeight = isSpecial ? '700' : '400';
    TD.style.fontStyle  = isSpecial ? 'italic' : 'normal';
  }

  function calcCentered(hot, TD, row, col, prop, value) {
    Handsontable.renderers.TextRenderer.apply(this, arguments);
    TD.style.textAlign  = 'center';
    TD.style.background = (row === summaryIdx || row === stdIdx) ? '#dde4f0' : '#eef2f7';
    TD.style.fontWeight = '600';
  }

  function gradeRenderer(hot, TD, row, col, prop, value) {
    Handsontable.renderers.TextRenderer.apply(this, arguments);
    TD.style.textAlign  = 'center';
    TD.style.fontWeight = 'bold';
    TD.style.color      = '#000';
    if (row === stdIdx) {
      TD.style.background = stdDevGradeColor(value) || '#dde4f0';
    } else if (row === summaryIdx) {
      TD.style.background = gradeColor(value) || '#dde4f0';
    } else {
      TD.style.background = gradeColor(value) || '#eef2f7';
    }
  }

  function rttiRenderer(hot, TD, row, col, prop, value) {
    Handsontable.renderers.TextRenderer.apply(this, arguments);
    TD.style.textAlign  = 'center';
    TD.style.fontWeight = '500';
    TD.style.background = row === summaryIdx ? '#e8ecf2' : (rttiPctColor(value) || '#eef2f7');
  }

  function scoreRenderer(hot, TD, row, col, prop, value) {
    Handsontable.renderers.TextRenderer.apply(this, arguments);
    TD.style.textAlign = 'center';
    if (row === summaryIdx || row === stdIdx) { TD.style.background = '#e8ecf2'; return; }
    if (!value) return;
    const q = exam.questions[col - 2];
    if (!q) return;
    const upper = String(value).toUpperCase().trim();
    if (upper === 'N') { TD.style.background='#cce5ff'; TD.style.color='#004085'; TD.style.fontWeight='600'; return; }
    if (value === '0') { TD.style.background='#f8d7da'; return; }
    const num = Number(value);
    if (isNaN(num)||num<0||num>q.max_points) { TD.style.background='#ff0033'; TD.style.color='#fff'; TD.style.fontWeight='700'; return; }
    if (num === q.max_points) { TD.style.background='#d4edda'; return; }
    TD.style.background = '#fff3cd';
  }

  const guard = { processing: false };

  const hot = new Handsontable(container, {
    data: gridData,
    colHeaders,
    rowHeaders: false,
    height: 'auto',
    licenseKey: 'non-commercial-and-evaluation',
    columns: [
      { type: 'text', readOnly: true, renderer: idRenderer,    width: 72  }, // 0: #
      { type: 'text', readOnly: true, renderer: naamRenderer,  width: 150 }, // 1: naam
      ...exam.questions.map(() => ({ type: 'text', renderer: scoreRenderer, width: 32 })),
      { type: 'text', readOnly: true, width: 20 },                           // spacer
      { type: 'text', readOnly: true, renderer: calcCentered,  width: 72  }, // totaal
      { type: 'text', readOnly: true, renderer: gradeRenderer, width: 52  }, // cijfer
      { type: 'text', readOnly: true, width: 20 },                           // spacer
      ...Array.from({ length: 4 }, () => ({ type: 'text', readOnly: true, renderer: rttiRenderer, width: 44 })),
    ],
    cells(row, col) {
      if (row === summaryIdx || row === stdIdx) return { readOnly: true };
      if (col < 2 || col >= 2 + N) return { readOnly: true };
      return {};
    },
    afterGetColHeader(col, TH) {
      // Bottom-align all headers
      TH.style.verticalAlign = 'bottom';
      // Left-align Naam header; all others centered (HOT default)
      if (col === 1) TH.style.textAlign = 'left';
    },
    afterBeginEditing() {
      // Handsontable bug: it sets aria-hidden on its own focused textarea.
      // Remove it so screen readers and Chromium don't log a warning.
      const ta = container.querySelector('textarea.handsontableInput');
      if (ta) ta.removeAttribute('aria-hidden');
    },
    afterChange: async (changes) => {
      if (!changes || guard.processing) return;
      guard.processing = true;
      try {
        for (const [row, col, , newVal] of changes) {
          if (row === summaryIdx || row === stdIdx) continue;
          if (col < 2 || col >= 2 + N) continue;
          const student = students[row];
          const q = exam.questions[col - 2];
          if (!student || !q) continue;

          const raw   = String(newVal ?? '').trim();
          const upper = raw.toUpperCase();

          if (raw === '') {
            gridData[row][col] = '';
            await Store.setScore(student.id, exam.id, q.id, undefined, year);
          } else if (upper === 'N') {
            gridData[row][col] = 'N';
            await Store.setScore(student.id, exam.id, q.id, null, year);
          } else {
            const num = Number(raw);
            if (isNaN(num) || num < 0 || num > q.max_points) {
              gridData[row][col] = raw;
              await Store.setScore(student.id, exam.id, q.id, raw, year);
              persistentError(
                `Ongeldige score "${raw}" voor vraag ${q.section}${q.number} (max ${q.max_points}). Controleer en herstel.`
              );
            } else {
              gridData[row][col] = String(num);
              await Store.setScore(student.id, exam.id, q.id, num, year);
            }
          }
          recomputeRow(gridData, exam, row);
          recomputeSummaryRow(gridData, summaryIdx, exam);
        }
      } finally {
        guard.processing = false;
        hot.render();
      }
    },
  });

  return hot;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN: Rapport genereren (Phase 4)
// ═══════════════════════════════════════════════════════════════════════════════
function renderRapport() {
  const cfg = Store.getConfigSync();
  const exams = Store.getExamsSync(cfg.activeYear);
  SEL.rapportExam.setOptions(exams.map(e => ({
    value: e.id,
    label: (e.volgnummer ? e.volgnummer + ' \u2013 ' : '') + e.title,
  })));
}

// ── Start ─────────────────────────────────────────────────────────────────────
init();
