// ── CSV utilities ─────────────────────────────────────────────────────────────

export function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };
  const semiCount = (lines[0].match(/;/g) || []).length;
  const commaCount = (lines[0].match(/,/g) || []).length;
  const delim = semiCount >= commaCount ? ';' : ',';

  function parseLine(line) {
    const result = [];
    let cur = '',
      inQ = false;
    for (const c of line) {
      if (c === '"') {
        inQ = !inQ;
      } else if (c === delim && !inQ) {
        result.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    result.push(cur.trim());
    return result;
  }

  const headers = parseLine(lines[0]).map((h) => h.replace(/^"|"$/g, '').trim());
  const rows = lines
    .slice(1)
    .filter((l) => l.trim())
    .map((line) => {
      const vals = parseLine(line).map((v) => v.replace(/^"|"$/g, '').trim());
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = vals[i] ?? '';
      });
      return obj;
    });
  return { headers, rows };
}

/**
 * Show a year-selection modal before running a CSV import.
 * Returns a promise that resolves to the chosen year or null.
 *
 * @param {string}   activeYear
 * @param {string[]} existingYears
 * @param {{ showModal: Function, closeModal: Function, toast: Function, overlay: Element }} ui
 */
export function askSchoolYear(activeYear, existingYears, ui) {
  const { showModal, closeModal, toast, overlay } = ui;
  return new Promise((resolve) => {
    const allYears = [...new Set([activeYear, ...existingYears])].sort((a, b) =>
      b.localeCompare(a)
    );
    showModal(
      `
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
    `,
      (el) => {
        const yearSel = new CustomSelect(el.querySelector('#f-import-year-host'), {
          placeholder: '— kies schooljaar —',
        });
        yearSel.setOptions(allYears.map((y) => ({ value: y, label: y })));
        yearSel.setValue(activeYear);

        el.querySelector('#f-year-ok').addEventListener('click', () => {
          const custom = el.querySelector('#f-import-year-custom').value.trim();
          const chosen = custom || yearSel.getValue();
          if (!chosen) {
            toast('Kies een schooljaar.', 'error');
            return;
          }
          closeModal();
          resolve(chosen);
        });
      }
    );
    overlay.addEventListener(
      'click',
      function handler(e) {
        if (e.target === overlay) {
          overlay.removeEventListener('click', handler);
          resolve(null);
        }
      },
      { once: true }
    );
    document
      .getElementById('modal-close')
      .addEventListener('click', () => resolve(null), { once: true });
  });
}
