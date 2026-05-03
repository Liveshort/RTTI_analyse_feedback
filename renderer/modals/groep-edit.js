// ── Group add/edit & CSV import modals ────────────────────────────────────────
import { showModal, closeModal, toast, escHtml, SEL, overlayElement } from '../app.js';
import { parseCSV, askSchoolYear } from '../utils/csv.js';
import { renderGroepen } from '../screens/groepen.js';

export async function openGroupModal(id) {
  const year = SEL.groupsYear.getValue() || Store.getConfigSync().activeYear;
  const [students, users] = await Promise.all([Store.getStudents(year), Store.loadUsers()]);
  students.sort((a, b) => {
    const scmp = (a.stamklas ?? '').localeCompare(b.stamklas ?? '');
    if (scmp !== 0) return scmp;
    return (a.achternaam ?? '').localeCompare(b.achternaam ?? '');
  });

  let group = { id: '', name: '', jaarlaag: '', schoolsoort: [], docenten: [], student_ids: [] };
  let groupsInJaarlaag = [];

  if (id) {
    const all = await Store.getGroups(year);
    group = JSON.parse(JSON.stringify(all.find((g) => g.id === id) ?? group));
    groupsInJaarlaag = Store.getGroupsSync(year)
      .filter((g) => String(g.jaarlaag) === String(group.jaarlaag) && g.subject === group.subject)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const hasStudents = group.student_ids.length > 0;
  const isEdit = !!id;

  const JAARLAGEN = ['1', '2', '3', '4', '5', '6'];
  const SCHOOLSOORTEN = ['Vmbo-bb', 'Vmbo-kb', 'Vmbo-gl', 'Vmbo-tl', 'Havo', 'Vwo', 'Gymnasium'];
  const VAKKEN = [
    { code: 'bio', label: 'Biologie' },
    { code: 'nat', label: 'Natuurkunde' },
    { code: 'schk', label: 'Scheikunde' },
    { code: 'wi', label: 'Wiskunde' },
  ];
  const jlDisabled = isEdit && hasStudents;
  const ssDisabled = isEdit && hasStudents;
  const vakDisabled = isEdit && hasStudents;

  const jaarlaagHtml = JAARLAGEN.map((jl) => {
    const sel = String(group.jaarlaag) === jl;
    const cls = `tog-btn jl-btn jl-toggle${sel ? ' selected' : ''}${jlDisabled ? ' tog-btn-disabled' : ''}`;
    return `<button type="button" class="${cls}" data-jl="${jl}"${jlDisabled ? ' disabled' : ''}>${jl}</button>`;
  }).join('');

  const schoolSS = Store.getSchoolSync().schoolsoort ?? [];
  const schoolSSFilter = schoolSS.length > 0;
  const schoolsoortHtml = SCHOOLSOORTEN.map((ss) => {
    const sel = (group.schoolsoort ?? []).includes(ss);
    const disabled = ssDisabled || (schoolSSFilter && !schoolSS.includes(ss));
    const cls = `tog-btn ss-toggle${sel ? ' selected' : ''}${disabled ? ' tog-btn-disabled' : ''}`;
    return `<button type="button" class="${cls}" data-ss="${ss}"${disabled ? ' disabled' : ''}>${ss}</button>`;
  }).join('');

  const vakHtml = VAKKEN.map(({ code, label }) => {
    const sel = group.subject === code;
    const cls = `tog-btn vak-g-btn${sel ? ' selected' : ''}${vakDisabled ? ' tog-btn-disabled' : ''}`;
    return `<button type="button" class="${cls}" data-vak="${code}"${vakDisabled ? ' disabled' : ''}>${label}</button>`;
  }).join('');

  const nonAdminUsers = users.filter((u) => !u.isAdmin && u.actief);

  function buildDocentHtml(selectedSS, selectedDocentIds, selectedSubject) {
    const subjectFilter = selectedSubject || Store.getActiveSubject() || null;
    const filtered = nonAdminUsers.filter((u) => {
      const teachesSubject = !subjectFilter || (u.vakken ?? []).includes(subjectFilter);
      const hasSSOverlap =
        selectedSS.length === 0 || (u.schoolsoort ?? []).some((ss) => selectedSS.includes(ss));
      return teachesSubject && hasSSOverlap;
    });
    if (filtered.length === 0) {
      return `<span class="form-hint muted">Geen docenten beschikbaar voor dit vak en deze schoolsoort.</span>`;
    }
    return filtered
      .map((u) => {
        const uName = [u.voornaam, u.tussenvoegsel, u.achternaam].filter(Boolean).join(' ');
        const sel = (selectedDocentIds ?? []).includes(u.id);
        return `<button type="button" class="tog-btn docent-toggle${sel ? ' selected' : ''}" data-docent-id="${escHtml(u.id)}">${escHtml(uName)}</button>`;
      })
      .join('');
  }

  let studentsSection;
  if (isEdit) {
    const headerCols = groupsInJaarlaag
      .map((g) => `<th class="gst-group-th">${escHtml(g.name)}</th>`)
      .join('');
    const rows = students
      .map((s) => {
        const jl = Store.jaarlaagFromStamklas(s.stamklas);
        const cols = groupsInJaarlaag
          .map((g) => {
            const checked = g.student_ids.includes(s.id) ? 'checked' : '';
            return `<td class="gst-check-td"><input type="checkbox"
              data-student-id="${s.id}"
              data-group-id="${escHtml(g.id)}"
              data-subcategory="${escHtml(g.subcategory ?? '')}"
              ${checked} /></td>`;
          })
          .join('');
        return `<tr data-student-id="${s.id}" data-stamklas-jl="${escHtml(jl)}">
          <td>${escHtml(Store.fullName(s))}</td>
          <td class="gst-stamklas">${escHtml(s.stamklas ?? '')}</td>
          ${cols}
        </tr>`;
      })
      .join('');

    studentsSection = `
      <div class="gst-label-row">
        <label>Leerlingen</label>
        ${group.jaarlaag ? `<button type="button" id="f-g-jl-filter" class="btn-sm btn-primary" data-active="1">Alleen leerlingen van jaarlaag ${escHtml(String(group.jaarlaag))} tonen</button>` : ''}
      </div>
      <div class="gst-scroll">
        <table class="gst-table">
          <thead>
            <tr>
              <th>Naam</th>
              <th>Stamklas</th>
              ${headerCols}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  const initialSS = group.schoolsoort ?? [];
  const initialDocenten = group.docenten ?? [];
  const initialDocentHtml = buildDocentHtml(initialSS, initialDocenten, group.subject);

  const fieldsHtml = isEdit
    ? `
    <div class="form-row" style="gap:20px;align-items:flex-start">
      <div class="form-group" style="flex:1;min-width:0">
        <label>Naam (bijv. 6nat4 of 2anat)</label>
        <input id="f-gname" type="text" value="${escHtml(group.name)}" ${hasStudents ? 'disabled' : ''} />
      </div>
      <div class="form-group" style="flex:1;min-width:0">
        <label>Schoolsoort</label>
        <div class="vak-toggle-group">${schoolsoortHtml}</div>
      </div>
    </div>
    <div class="form-row" style="gap:20px;align-items:flex-start;margin-top:4px">
      <div class="form-group" style="flex:0 0 auto;margin-bottom:0">
        <label>Vak</label>
        <div class="btn-toggle-group">${vakHtml}</div>
      </div>
      <div class="form-group" style="flex:0 0 auto;margin-bottom:0">
        <label>Leerjaar</label>
        <div class="btn-toggle-group">${jaarlaagHtml}</div>
      </div>
      <div class="form-group" style="flex:1;min-width:0;margin-bottom:0">
        <label>Docent(en)</label>
        <div class="vak-toggle-group" id="f-g-docenten">${initialDocentHtml}</div>
      </div>
    </div>
  `
    : `
    <div class="form-group">
      <label>Naam (bijv. 6nat4 of 2anat)</label>
      <input id="f-gname" type="text" value="${escHtml(group.name)}" ${hasStudents ? 'disabled' : ''} />
    </div>
    <div class="form-group">
      <label>Schoolsoort</label>
      <div class="vak-toggle-group">${schoolsoortHtml}</div>
    </div>
    <div class="form-group">
      <label>Vak</label>
      <div class="btn-toggle-group">${vakHtml}</div>
    </div>
    <div class="form-group">
      <label>Leerjaar</label>
      <div class="btn-toggle-group">${jaarlaagHtml}</div>
    </div>
  `;

  showModal(
    `
    <h3>${id ? 'Groep bewerken' : 'Groep toevoegen'}</h3>
    ${fieldsHtml}
    ${
      !isEdit
        ? `
    <div class="form-group" style="margin-bottom:0">
      <label>Docent(en)</label>
      <div class="vak-toggle-group" id="f-g-docenten">${initialDocentHtml}</div>
    </div>`
        : ''
    }
    ${hasStudents ? '<span class="form-hint muted" style="display:block;margin-top:8px">Naam, leerjaar, schoolsoort en vak kunnen niet worden gewijzigd zolang er leerlingen in de groep zitten.</span>' : ''}
    ${isEdit ? `<div class="form-group" style="margin-top:16px">${studentsSection}</div>` : ''}
    <div class="form-actions" style="margin-top:16px">
      <button class="btn-primary" id="f-g-save">Opslaan</button>
      <button class="btn-secondary" data-close-modal="1">Annuleren</button>
    </div>
  `,
    (el) => {
      // Helper to refresh docent section
      const updateDocentSection = () => {
        const selectedSS = [...el.querySelectorAll('.ss-toggle.selected')].map((b) => b.dataset.ss);
        const selectedDocenten = [...el.querySelectorAll('.docent-toggle.selected')].map(
          (b) => b.dataset.docentId
        );
        const selectedVak = el.querySelector('.vak-g-btn.selected')?.dataset.vak ?? null;
        const docentContainer = el.querySelector('#f-g-docenten');
        docentContainer.innerHTML = buildDocentHtml(selectedSS, selectedDocenten, selectedVak);
        docentContainer.querySelectorAll('.docent-toggle').forEach((btn) => {
          btn.addEventListener('click', () => btn.classList.toggle('selected'));
        });
      };

      // Vak single-select + update docents
      el.querySelectorAll('.vak-g-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          el.querySelectorAll('.vak-g-btn').forEach((b) => b.classList.remove('selected'));
          btn.classList.add('selected');
          updateDocentSection();
        });
      });

      // Jaarlaag single-select
      el.querySelectorAll('.jl-toggle').forEach((btn) => {
        btn.addEventListener('click', () => {
          el.querySelectorAll('.jl-toggle').forEach((b) => b.classList.remove('selected'));
          btn.classList.add('selected');
        });
      });

      // Schoolsoort multi-select + update docents
      el.querySelectorAll('.ss-toggle').forEach((btn) => {
        btn.addEventListener('click', () => {
          btn.classList.toggle('selected');
          updateDocentSection();
        });
      });

      // Initial docent toggle listeners
      el.querySelectorAll('.docent-toggle').forEach((btn) => {
        btn.addEventListener('click', () => btn.classList.toggle('selected'));
      });

      // Filter button: toggle showing only students from this group's jaarlaag
      const filterBtn = el.querySelector('#f-g-jl-filter');
      const applyFilter = (active) => {
        el.querySelectorAll('tbody tr').forEach((row) => {
          row.style.display =
            !active || row.dataset.stamklasJl === String(group.jaarlaag) ? '' : 'none';
        });
      };
      if (filterBtn) {
        applyFilter(true);
        filterBtn.addEventListener('click', () => {
          const isActive = filterBtn.dataset.active === '1';
          filterBtn.dataset.active = isActive ? '0' : '1';
          filterBtn.classList.toggle('btn-primary', !isActive);
          filterBtn.classList.toggle('btn-secondary', isActive);
          applyFilter(!isActive);
        });
      }

      // Conflict resolution: checking a box may uncheck others for the same student
      if (isEdit) {
        el.querySelector('tbody')?.addEventListener('change', (e) => {
          if (e.target.type !== 'checkbox' || !e.target.checked) return;
          const sid = e.target.dataset.studentId;
          const sub = e.target.dataset.subcategory;
          el.querySelectorAll(`tbody input[type="checkbox"][data-student-id="${sid}"]`).forEach(
            (cb) => {
              if (cb === e.target) return;
              if (group.subject === 'wi') {
                if (sub && cb.dataset.subcategory === sub) cb.checked = false;
              } else {
                cb.checked = false;
              }
            }
          );
        });
      }

      el.querySelector('#f-g-save').addEventListener('click', async () => {
        const name = hasStudents ? group.name : el.querySelector('#f-gname').value.trim();
        if (!name) {
          toast('Vul een naam in.', 'error');
          return;
        }

        const jlSelected = el.querySelector('.jl-toggle.selected');
        if (!jlSelected) {
          toast('Selecteer een jaarlaag.', 'error');
          return;
        }
        const jaarlaag = jlSelected.dataset.jl;

        const schoolsoort = [...el.querySelectorAll('.ss-toggle.selected')].map(
          (b) => b.dataset.ss
        );
        if (schoolsoort.length === 0) {
          toast('Selecteer minimaal één schoolsoort.', 'error');
          return;
        }

        const docenten = [...el.querySelectorAll('.docent-toggle.selected')].map(
          (b) => b.dataset.docentId
        );

        const vakSelected = el.querySelector('.vak-g-btn.selected');
        if (!vakSelected) {
          toast('Selecteer een vak.', 'error');
          return;
        }
        const resolvedSubject = vakSelected.dataset.vak;
        const parsed = Store.parseGroupName(name, resolvedSubject);
        if (resolvedSubject === 'wi' && !parsed.subcategory) {
          toast(
            'Kan de subcategorie niet afleiden uit de naam. Gebruik bijv. 4wisa1, 5wisb2 of 3wi1 voor onderbouw.',
            'error'
          );
          return;
        }

        if (isEdit) {
          const byGroup = {};
          groupsInJaarlaag.forEach((g) => (byGroup[g.id] = []));
          el.querySelectorAll('tbody input[type="checkbox"]:checked').forEach((cb) => {
            if (byGroup[cb.dataset.groupId])
              byGroup[cb.dataset.groupId].push(Number(cb.dataset.studentId));
          });

          const allGroups = await Store.getGroups(year);
          for (const g of groupsInJaarlaag) {
            const existing = allGroups.find((ag) => ag.id === g.id);
            if (!existing) continue;
            const newIds = byGroup[g.id] ?? [];
            const isTarget = g.id === id;
            const nameChanged = isTarget && !hasStudents && name !== existing.name;
            const idsChanged =
              [...existing.student_ids].sort((a, b) => a - b).join(',') !==
              [...newIds].sort((a, b) => a - b).join(',');
            const fieldsChanged =
              isTarget &&
              (JSON.stringify(existing.schoolsoort ?? []) !== JSON.stringify(schoolsoort) ||
                JSON.stringify(existing.docenten ?? []) !== JSON.stringify(docenten) ||
                (!hasStudents && String(existing.jaarlaag) !== jaarlaag));
            if (!idsChanged && !nameChanged && !fieldsChanged) continue;

            let updated = { ...existing, student_ids: newIds };
            if (isTarget) {
              updated = { ...updated, schoolsoort, docenten };
              if (!hasStudents) {
                updated = {
                  ...updated,
                  name,
                  jaarlaag,
                  subject: resolvedSubject,
                  subcategory: parsed.subcategory ?? undefined,
                };
              }
            }
            await Store.upsertGroup(updated, year);
          }
        } else {
          const gid = Store.makeGroupId(name, year);
          await Store.upsertGroup(
            {
              id: gid,
              name,
              jaarlaag,
              subject: resolvedSubject,
              schoolsoort,
              docenten,
              subcategory: parsed.subcategory ?? undefined,
              student_ids: [],
            },
            year
          );
        }

        closeModal();
        toast('Groep opgeslagen.', 'success');
        renderGroepen();
      });
    },
    'modal-xl'
  );
}

export async function deleteGroup(id) {
  if (!confirm('Groep verwijderen?')) return;
  const year = SEL.groupsYear.getValue() || Store.getConfigSync().activeYear;
  await Store.deleteGroup(id, year);
  toast('Groep verwijderd.', 'info');
  renderGroepen();
}

export async function openGroupCSVImport() {
  const cfg = await Store.getConfig();
  const existingYears = Store.listYearsSync();
  const ui = { showModal, closeModal, toast, overlay: overlayElement };
  const year = await askSchoolYear(cfg.activeYear, existingYears, ui);
  if (!year) return;

  showModal(
    `
    <h3>Groepen importeren — ${escHtml(year)}</h3>
    <p class="muted" style="margin-bottom:12px">
      Verwachte kolommen: <code>Jaarlaag, Groep, Leerlingnummer, Schoolsoort</code>
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
  `,
    (el) => {
      let groupMap = null;
      el.querySelector('#f-csv-groups').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const { rows } = parseCSV(await file.text());
        groupMap = {};
        for (const r of rows) {
          const jaarlaag = String(r['Jaarlaag'] ?? r['jaarlaag'] ?? '').trim();
          const naam = (r['Groep'] ?? r['groep'] ?? '').trim();
          const llnr = Number(r['Leerlingnummer'] ?? r['leerlingnummer']);
          const ssRaw = (r['Schoolsoort'] ?? r['schoolsoort'] ?? '').trim();
          const schoolsoort = ssRaw
            ? ssRaw
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : [];
          if (!naam || !llnr) continue;
          if (!groupMap[naam])
            groupMap[naam] = { jaarlaag, schoolsoort, name: naam, student_ids: [] };
          if (!groupMap[naam].student_ids.includes(llnr)) groupMap[naam].student_ids.push(llnr);
        }
        const entries = Object.values(groupMap);
        el.querySelector('#csv-grp-preview').innerHTML =
          entries.length === 0
            ? '<p class="hint">Geen groepen gevonden.</p>'
            : `<p style="margin:8px 0 4px"><strong>${entries.length}</strong> groepen:</p>
           <table class="preview-table">
             <thead><tr><th>Groep</th><th>Jaarlaag</th><th>Leerlingen</th></tr></thead>
             <tbody>${entries
               .map(
                 (g) =>
                   `<tr><td>${escHtml(g.name)}</td><td>${escHtml(g.jaarlaag)}</td><td>${g.student_ids.length}</td></tr>`
               )
               .join('')}</tbody></table>`;
        el.querySelector('#f-csv-grp-import').disabled = entries.length === 0;
      });
      el.querySelector('#f-csv-grp-import').addEventListener('click', async () => {
        if (!groupMap) return;
        const subject = Store.getActiveSubject();
        const toSave = Object.values(groupMap).map((g) => {
          const parsed = Store.parseGroupName(g.name, subject);
          return {
            id: Store.makeGroupId(g.name, year),
            name: g.name,
            jaarlaag: parsed.jaarlaag ?? g.jaarlaag,
            schoolsoort: g.schoolsoort,
            subcategory: parsed.subcategory ?? undefined,
            student_ids: g.student_ids,
          };
        });
        await Store.upsertGroups(toSave, year);
        closeModal();
        toast(`${toSave.length} groepen geïmporteerd voor ${year}.`, 'success');
        renderGroepen();
      });
    }
  );
}
