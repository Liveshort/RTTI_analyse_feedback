# Maatwerk (RTTI App) — Claude Context

## Project Purpose

Dutch educational Electron desktop app for managing and analysing student exam scores using the RTTI framework (Reproductie / Toepassen 1 / Toepassen 2 / Inzicht). Used by multiple teachers at a CVO school, per subject (`nat`, `bio`, `schk`, `wi`), with data shared via OneDrive. Product name: **Maatwerk**.

## Commands

```bash
npm start        # Run in development (opens DevTools automatically)
npm run dist     # Build portable Windows x64 .exe
```

No test suite yet.

## Architecture

### Process Split

```
Renderer UI (screens/, modals/, app.js)
    ↓
Store.js (cache + async methods + RTTI logic)
    ↓
window.rtti IPC calls (preload.js)
    ↓
main.js IPC handlers (fs ops, Typst)  ←  sync.js (atomic writes, file watcher)
    ↓
Filesystem (data/ folder)
```

- **main.js** — Electron main process; handles ALL file I/O and Typst compilation via IPC. Do not add direct FS access in the renderer.
- **sync.js** (root) — `writeFileAtomic`, content hashing, and the watcher that reports files changed by other teachers (`fs.watch` + 20 s poll; own writes are ignored).
- **preload.js** — Exposes `window.rtti` via contextBridge. Only intentional API surfaces are exposed.
- **renderer/store.js** — Global `Store` (classic script). Data access layer with in-memory cache, all RTTI business logic, `applyExternalChange()` to patch the cache when other teachers change files.
- **renderer/app.js** — ES module entry: navigation, modal system, toasts, filter bar, shared helpers (`escHtml`, …).
- **renderer/screens/** — One module per tab: startup, leerlingen, groepen, toetsen, scores, observaties, opdrachten, gebruikers, school.
- **renderer/modals/** — toets-edit, toets-overzicht (exam charts), herkansing, rapport, opdrachten-genereren, profiel (student charts), groep-edit, groep-leerlingen, leerling-edit, editor.
- **renderer/sync.js** — `Sync.on(type, handler)` pub/sub for external changes. Screens/modals subscribe when built and unsubscribe when torn down.
- **renderer/presence.js** — Heartbeat to `data/users/<userId>.json`; shows colleagues online and where they are in the score grid.
- **renderer/editor.html + editor-init.js** — CodeMirror 6 Typst editor in an iframe (`#editor-frame`); proxies `window.rtti` calls via postMessage through `modals/editor.js`.
- **renderer/pdf-viewer.html + pdf-viewer.js** — In-app PDF viewer.
- **renderer/custom-select.js** — Accessible dropdown (avoids native OS flash in Electron modals).
- **renderer/utils/** — colors, csv, grades, icons (`ICONS`), spinners.

### Security Model

- `contextIsolation: true`, `nodeIntegration: false`
- Renderer accesses Node only via the `window.rtti` bridge
- CSP is a `<meta>` tag in `renderer/index.html` (jsdelivr allowed) and `renderer/editor.html` (esm.sh + jsdelivr) — update it when adding CDN resources

### Typst / PDF

- Typst binary in `bin/typst/<platform>/<arch>/`; only `win/x86_64` is packaged (to `resources/typst`).
- Fonts in `include/fonts/` (Source Serif 4 static OTFs + STIX Two Math, OFL), passed to every compile with `--font-path` (`typstCompileArgs()` in main.js) and packaged next to `include/templates`. Opdrachten (lib.typ `setup`) and the rapport use Source Serif 4 10.5 pt with STIX Two Math for equations; opdracht figure captions are 9.5 pt, table captions sit above the table. Source Serif 4 has no ExtraBold (800 would pick Black), so use `bold`.
- Templates in `include/templates/`: `rtti_export.typ` (exam rapport), `lib.typ` (opdracht styling, copied to `data/opdrachten/lib.typ` on every start), `base_assignment.typ` (new opdracht skeleton).
- Opdracht `.typ` files (`#import "lib.typ": *`) define `setup_extra()`, `render_uitleg()` and `render_opgaven()`. Exercises are free content in `#opgave(titel: …)[…]` (a numbered, page-breakable gray figure, labelable like the other blocks); only questions are marked with `#vraag(punten: …, antwoord: […])[…]`, which draws the indented question (letter a, b, … — none when it's the only vraag of its opgave — and italic points) and leaves a `<__rtti_vraag>` metadata marker. A vraag directly followed by another vraag gets no space below it (`_direct_gevolgd()`, comparing top/bottom marker positions). The answers are collected from those markers via `query`, so questions may sit anywhere (grids, figures): upside down and gray at the bottom of the last page for students (`antwoorden_omgekeerd()`, a bottom float), upright for the answer key (`antwoorden_lijst()`; the wrapper lays the content out invisibly with `place(hide[…])` so the markers exist). The editor's ➕ / ❓ buttons insert an opgave / vraag at the cursor; the table button inserts a `#figure(table(…), caption: […]) <tabel>`. The @ (Verwijzing) popup lists the document's labels (Typst label chars incl. `:` and `.`, e.g. `<eq:energie>`); note that Typst can only reference equations when equation numbering is on.
- Opdracht images: the editor's 🖼️ popup lists the opdracht's images (thumbnails come from main as data URLs — the editor CSP allows only `data:` images) and adds new ones from disk (`opdracht:pickImage` returns a token, the path stays in main) or the clipboard; Ctrl+V of an image in the editor does the same. A new image is named first (name clashes ask to overwrite), saved by main.js to `data/opdrachten/images/<id>/`, and a `#figure(image("images/<id>/…", width: 80%), caption: […]) <label>` is inserted at the cursor. Documents use `lang: "nl"` (captions/references say "Figuur").
- Pattern: main.js serialises JS data to Typst literals (`toTypst()` in `app:renderRapportPdf`), writes a wrapper `.typ` into `temp/`, compiles with `--root <appDir>`, then deletes the wrapper. Typst can only read files under the app dir, so templates are copied into `temp/` first.
- Opdrachten: `buildAssignmentWrapper()` adds the header (`opdracht_header` in lib.typ; the editor uses placeholder student data). Live preview compiles to SVG pages.
- Opdrachten genereren (`app:renderAssignmentBatch`): every (student, opdracht) is compiled as its own document — opdracht files share function names and may contain labels, so they can't be combined in one Typst document — and the PDFs are merged with **pdf-lib**, padding with blank pages so each student starts on an odd page (duplex).

## Data Structure

### File Layout

```
data/
├── config.json                      { activeYear }
├── gebruikers.json                  teacher accounts (isAdmin, vakken, kleur, foto)
├── school.json                      naam, logo, watermerk, schoolsoort[]
├── fotos/                           photos, school logo/watermark
├── users/<userId>.json              presence
├── observaties/<obsId>.json         { id, naam, icon, uitleg, leeradvies, jaarlagen[], subjects[], schoolsoort[] }
├── opdrachten/<id>.json + <id>.typ  { id, naam, beschrijving, vakken[], jaarlagen[], schoolsoort[], observaties[], typFile }
│   └── images/<id>/<naam>.<ext>      figures of one opdracht (removed with the opdracht)
├── templates/                       RTTI explanation/advice texts per subject + jaarlaag
└── YYYY-YYYY/
    ├── students-YYYY-YYYY.json
    ├── exams/<examId>.json            { …, obs_ids[], opdrachten: {obsId: [opdrachtId]} }
    ├── groups/<groupId>.json
    └── scores/<subject>/<studentId>.json   { student_id, scores: {examId: {qId: value}}, observations: {examId: …} }
```

- **data/** sits next to the .exe in production (`PORTABLE_EXECUTABLE_DIR`) and next to main.js in dev
- **Never bundled** — intentionally kept outside so OneDrive can sync it
- Academic year is implicit from the folder name; objects do NOT store an `academic_year` field
- The `subject` field inside each JSON is authoritative, not the path
- Legacy files (`students.json`, `exams.json`, `groups.json`, `*.bak`) are pre-migration leftovers; see `migrate()` in store.js

### IDs & Slugs

- Exam IDs: `makeExamId(title, year, subject)` → `"<subject>-<slug>-<year>"`, e.g. `"nat-pta-tna-1-2025-2026"` (older exams lack the subject prefix)
- Group IDs: `makeGroupId(name, year)` → `"<slug>-<year>"`
- Student IDs: numeric strings (e.g. `"101010"`)
- Observaties/opdrachten: `obs-<timestamp>` / `opdracht_<timestamp>`

### Concurrency (shared OneDrive folder)

- All writes are atomic (`writeFileAtomic` in sync.js).
- `Store.update(relPath, mutator)` — read-modify-write with compare-and-swap on a content hash; retries on conflict. Use this for shared files, never a blind `save()`.
- `Store.saveEntity()` — single-object files carry `_meta { rev, createdBy, updatedBy, … }`; saving from a stale `rev` throws a `conflict` error (handled globally in app.js).
- Non-score files also get `.lock` sentinel files (10 s TTL); lock logic lives entirely in main.js.
- Score files — no locking (one teacher per student assumed).
- New screens/modals that show shared data must subscribe via `Sync.on(...)` so other teachers' changes appear live.

### Score Model

- Each exam question has an `rtti` tag (`R`, `T1`, `T2`, `I`), `max_points`, optional `section`, and `kind` (`normal` | `bonus` | `diag`)
- Score values: numeric (0–max), `null` (not yet filled), or `'N'` (not evaluated)
- Grade on a 9-point scale + n-term with the standard CvTE bounds — see `calcGrade()` / `calcResults()` in store.js
- Resits (inhaal/herkansing) are separate exams linked to a parent; `computeBestGradeMap()` / `resolveBestAttempts()` pick the best attempt
- Opdrachten genereren: `exam.opdrachten` couples the exam's observaties to opdrachten (observaties without a saved coupling default to matching opdrachten that list them, see `getOpdrachtCoupling()`); `getOpdrachtAssignments()` gives each student who got an observatie the coupled opdrachten, once per opdracht

## Tech Stack

| Layer | Library | Version |
|---|---|---|
| Desktop | Electron | ^40 |
| Packaging | electron-builder | ^26 (portable target) |
| PDF | Typst (bundled binary) | — |
| PDF merging | pdf-lib (main process) | ^1.17 |
| Score grid | Handsontable | 14.3.0 (CDN) |
| Charts | Chart.js + annotation plugin | 4.4.2 / 3.0.1 (CDN) |
| Editor | CodeMirror 6 | esm.sh |
| Formatter | Prettier | single quotes, 2-space indent |
| Git hooks | Husky + lint-staged | pre-commit runs Prettier |

`docx` is still listed in dependencies but unused (Word export was replaced by Typst).

## UI Conventions

- All user-facing text is in **Dutch (nl)**
- Decimal separator is **comma** (`1,5` not `1.5`)
- Screens are rebuilt on each navigation (no cross-tab state persistence); filter state is saved per user in the local session
- Buttons use `data-action` attributes with event delegation, not inline handlers (CSP)
- Modals use `data-close-modal` to hook close buttons
- Exam card actions are built in `buildMenuItems()` in screens/toetsen.js (items can be `disabled: '<tooltip>'`)
- Toasts auto-dismiss after 3.5 s; error toasts persist
- **Never use native `alert` / `confirm` / `prompt`** — they look out of place and, in Electron, leave text inputs unable to receive typed characters afterwards (this broke score entry in the Handsontable). Use `confirmDialog(message, { title, okLabel, cancelLabel, danger })` from app.js (resolves `true`/`false`; `cancelLabel: null` gives a one-button notice). Dialog layout (`.app-dialog` in style.css, shared with `showReloadNotice`): centered white card (max 440 px) over a dimmed backdrop above any modal, optional bold title, message, buttons right-aligned with **Annuleren** (secondary) left of the action button — primary blue, or solid red with `danger: true` for destructive actions (label the action, e.g. "Verwijderen"). The action button has focus; Escape or a click next to the card cancels.
- Forms in modals register `guardModalClose(isDirty)` (often `formSnapshot(el)` compared to a snapshot taken on open); closing with ✕ or a click next to the modal then asks "Weet je zeker dat je dit scherm wilt sluiten? Er zijn onopgeslagen wijzigingen.". Used by the exam editor (both steps) and the observatie modal. A backdrop click only counts when the mouse press also started on the backdrop.
- Pass/fail: a grade is a fail when `isFail(g)` (utils/colors.js) — rounded to one decimal below 5.5, since a 5.47 is entered as 5.5. Use it for every "onvoldoende" count and fail color, never `g < 5.5`.
- Score modal: only the grids scroll (header bar stays put). Keys: numpad as in its Help tooltip; F1, F2, … toggle the 1st, 2nd, … observatie (column order) of the current student without moving the selection (`setObs()` in screens/scores.js handles all observation toggles).

## Roadmap

All original phases (scaffold, management screens, score grid, reports, profiles/charts, import, packaging) and the opdrachten workflow are done; Word export was replaced by Typst PDFs and the planned Excel import by CSV import. Next, in order:

### 1. Praktische opdrachten (PO)
- **Templates (rubrics)** — defined beforehand by the user, own editor modal. A template has categories (inleiding, theorie, resultaten, grafieken, taalgebruik, …); each category has score intervals with a description per interval. Templates are stored in `data/po-templates/`, subject-scoped like observaties.
- **PO aanmaken** — button on the Toetsen tab; modal like toets-edit but choosing a template instead of a question structure.
- **Werkgroepjes** — POs are usually done in groups, so students need to be grouped per PO. Groups will get a grade as a group. An individual bonus / malus can be applied to the individual student grades afterwards.
- **Beoordelen** — grading modal: pick a level per category, room for remarks. Grade calculated like exams (`calcGrade`).
- **Feedbackrapport** — pretty per-student PDF (Typst), like the exam rapport but with more written feedback.
- PO's appear in profile charts as diagonally striped versions of exams: blue striped for a regular PO, red-striped for a PTA PO.

### 2. Graphs to PDF
- Export profile (profiel.js) and exam overview (toets-overzicht.js) charts to PDF for colleagues/parents: render Chart.js canvases to PNG (`toBase64Image()`), pass them to main.js, lay them out with Typst.
