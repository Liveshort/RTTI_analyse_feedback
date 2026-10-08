# Maatwerk (RTTI App)

Desktop app (Electron) for teachers to manage and analyse exam results using the RTTI framework
(Reproductie / Toepassen 1 / Toepassen 2 / Inzicht). Built for the science and maths sections
(`nat`, `bio`, `schk`, `wi`) of a school, with all data shared between teachers through a OneDrive
folder. The interface is in Dutch.

Current version: **0.1.2**

## Features

- **Leerlingen** — student list per school year, CSV import, student profile with grade history
  (Cijferverloop) and RTTI analysis charts.
- **Groepen** — groups per subject and year, CSV import of groups and group assignments.
- **Toetsen** — exams with sections, questions, RTTI tags and max points; bonus and diagnostic
  questions; n-term; inhaal/herkansing attempts grouped under a summary card (best attempt counts).
- **Scores invoeren** — Handsontable score grid with numpad navigation, `N` for not evaluated, and
  per-question observations.
- **Toetsoverzicht** — grade distribution, boxplots, question analysis, RTTI analysis and
  observations per exam.
- **Rapport** — per-student PDF reports (Typst) with score table, RTTI breakdown, explanation and
  study advice.
- **Observaties** — reusable observations (icon, explanation, leeradvies) per subject, jaarlaag and
  schoolsoort.
- **Opdrachten** — remedial assignments written in Typst in a built-in editor with live preview,
  linked to observations.
- **Gebruikers / School** (admin) — teacher accounts, subjects, colours and photos; school name,
  logo and watermark used in reports.
- **Multi-teacher sync** — changes from colleagues are detected and hot-reloaded into open screens
  and modals, writes never overwrite someone else's change, and colleagues working in the same score
  grid are shown live.

## Development setup

### Prerequisites

- Node.js 18+ (https://nodejs.org)
- npm (included with Node)

### First-time setup

```bash
npm install
```

### Run in development

```bash
npm start
```

The app opens with DevTools attached.

### Build

```bash
npm run dist
```

Produces a portable Windows x64 `.exe` in `dist/`. The bundled Typst binary and the report
templates are copied alongside it as extra resources.

---

## Project structure

```
rtti-app/
├── main.js               — Main process: window, all file I/O, Typst compilation, IPC
├── sync.js               — Atomic writes + file watcher for changes by other teachers
├── preload.js            — Secure IPC bridge (window.rtti)
├── bin/typst/            — Typst binaries per platform (only win/x86_64 is packaged)
├── include/templates/    — Typst templates: rtti_export.typ (rapport), lib.typ, base_assignment.typ
└── renderer/
    ├── index.html        — App shell and navigation
    ├── app.js            — Entry point: navigation, modals, toasts, filters
    ├── store.js          — Data access layer, cache, RTTI/grade calculations
    ├── sync.js           — Routes external changes to screens and modals
    ├── presence.js       — Which colleagues are online, and where
    ├── custom-select.js  — Accessible dropdown
    ├── screens/          — One module per tab (leerlingen, groepen, toetsen, scores, …)
    ├── modals/           — Modals (toets-edit, toets-overzicht, rapport, profiel, editor, …)
    ├── utils/            — Colours, CSV, grades, icons, spinners
    ├── editor.html / editor-init.js   — CodeMirror Typst editor (iframe)
    └── pdf-viewer.html / pdf-viewer.js — In-app PDF viewer
```

## Data folder

The `data/` folder lives next to the `.exe` (next to `main.js` in development) and is never bundled
into the app, so it can be shared via OneDrive.

```
data/
├── config.json                 — Active school year
├── gebruikers.json             — Teacher accounts
├── school.json                 — School name, logo, watermark, schoolsoorten
├── fotos/                      — User photos, school logo/watermark
├── users/<userId>.json         — Presence (who is online, where)
├── observaties/<obsId>.json
├── opdrachten/                 — <id>.json + <id>.typ per assignment, lib.typ (app-managed)
├── templates/                  — RTTI explanation/advice texts per subject and jaarlaag
└── YYYY-YYYY/
    ├── students-YYYY-YYYY.json
    ├── exams/<examId>.json
    ├── groups/<groupId>.json
    └── scores/<subject>/<studentId>.json
```

## Concurrency (OneDrive)

- Every write is atomic (temp file + rename).
- Shared files are written with compare-and-swap on a content hash; single-object files (exams,
  groups, observaties, opdrachten) also carry a `_meta.rev` so an edit based on a stale version is
  rejected instead of overwriting a colleague.
- Non-score files additionally use `.lock` files (10 s TTL).
- Score files are not locked; one teacher writes per student.

---

## Roadmap

### Done

- [x] Electron scaffold, JSON I/O, per-year and per-subject data layout
- [x] Student, group and exam management, CSV import
- [x] Score entry grid, observations per question
- [x] Inhaal / herkansing attempts
- [x] Student profile and exam overview charts (Chart.js)
- [x] PDF reports via Typst (replaces the planned Word export)
- [x] Users, school settings, filters
- [x] Opdrachten with Typst editor and live preview
- [x] Multi-teacher sync, conflict-safe saves and presence
- [x] Portable Windows build

### 1. Opdrachten workflow

- [ ] Enable the **Opdrachten genereren** action on exam cards (Toetsen tab).
- [ ] New modal: link opdrachten to the observaties used on that exam.
- [ ] Assign each linked opdracht to every student who received that observatie on the exam.
- [ ] Generate one PDF with all assigned opdrachten, ordered by student name, with each student's
      name, group and exam in the header.

### 2. Praktische opdrachten (PO)

- [ ] **Templates** — new modal to define grading templates (rubrics): a list of categories
      (e.g. inleiding, theorie, resultaten, grafieken, taalgebruik), each with points and a
      description per score interval.
- [ ] **PO aanmaken** — button on the Toetsen tab; modal like adding an exam, but choosing a
      template instead of a question structure.
- [ ] **Werkgroepjes** — form groups of students per PO, since reports are usually made in
      groups.
- [ ] **Beoordelen** — grading modal: pick a level per category, write remarks per category and in
      general. Grade calculated like exams (points → grade with n-term).
- [ ] **Feedbackrapport** — PDF per student (Typst), like the exam reports but centred on the
      written feedback and the rubric descriptions.

### 3. Graphs to PDF

- [ ] Export student profile and exam overview graphs to PDF to share with colleagues or parents:
      render the Chart.js charts to images and lay them out in a Typst document.
