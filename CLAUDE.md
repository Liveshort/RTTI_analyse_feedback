# RTTI Analyse App — Claude Context

## Project Purpose

Dutch educational Electron desktop app for managing and analysing student exam scores using the RTTI framework (Reproductie / Toepassen 1 / Toepassen 2 / Inzicht). Designed for use by teachers at a CVO school, with data shared via OneDrive across multiple teachers.

## Commands

```bash
npm start        # Run in development (opens DevTools automatically)
npm run dist     # Build Windows installer (NSIS, x64)
```

No test suite yet.

## Architecture

### Process Split

```
Renderer UI (app.js)
    ↓
Store.js (cache + async methods)
    ↓
window.rtti IPC calls (preload.js)
    ↓
main.js IPC handlers (fs ops)
    ↓
Filesystem (data/ folder)
```

- **main.js** — Electron main process; handles ALL file I/O via IPC. Do not add direct FS access in the renderer.
- **preload.js** — Exposes `window.rtti` API to renderer via contextBridge. Only intentional API surfaces are exposed.
- **renderer/store.js** — Data access layer with in-memory cache. All RTTI business logic lives here.
- **renderer/app.js** — UI/UX layer. Screen-based navigation, modal system, toast notifications.
- **renderer/custom-select.js** — Custom accessible dropdown (avoids native OS flash in Electron modals).

### Security Model

- `contextIsolation: true`, `nodeIntegration: false`
- Renderer accesses Node only via the `window.rtti` bridge
- CSP header in main.js — do not break it when adding CDN resources

## Data Structure

### File Layout

```
data/
├── config.json
├── observaties.json          (global, not year-scoped)
└── YYYY-YYYY/                (e.g. 2025-2026)
    ├── students.json
    ├── groups.json
    ├── exams.json
    └── scores/
        └── <studentId>.json
```

- **data/** sits next to the .exe in production and next to main.js in dev
- **Never bundled** into the installer — intentionally kept outside so OneDrive can sync it
- Academic year is implicit from folder name; objects do NOT store an `academic_year` field

### IDs & Slugs

- Exam IDs: `makeExamId(title, year)` → kebab-case + year suffix, e.g. `"testtoets-101-2025-2026"`
- Group IDs: same pattern via `makeGroupId(name, year)`
- Student IDs: numeric strings (e.g. `"101010"`)

### Concurrency / File Locking

- Score files (`scores/*.json`) — **no locking** (one teacher per student assumed)
- All other files — **file locking with 10 s TTL** via `<filename>.lock` sentinel files
- Lock logic lives entirely in main.js — do not replicate it in the renderer

### Score Model

- Each exam question has an `rtti` category tag and `max_points`
- Score values: numeric (0–max), `null` (not yet filled), or `'N'` (not evaluated)
- Grade calculated on a 9-point scale with n_term adjustment — see `calcGrade()` in store.js

## Tech Stack

| Layer | Library | Version |
|---|---|---|
| Desktop | Electron | ^40 |
| Installer | electron-builder | ^26 |
| Word export | docx | ^8.5 (Phase 4, not yet implemented) |
| Score grid | Handsontable | 14.3.0 (CDN) |
| Charts | Chart.js | 4.4.2 (CDN) |
| Formatter | Prettier | single quotes, 2-space indent |
| Git hooks | Husky + lint-staged | pre-commit runs Prettier |

## UI Conventions

- All user-facing text is in **Dutch (nl)**
- Decimal separator is **comma** (`1,5` not `1.5`)
- Screens are rebuilt on each navigation (no cross-tab state persistence)
- Buttons use `data-action` attributes with event delegation, not inline handlers
- Modals use `data-close-modal` to hook close buttons
- Toasts auto-dismiss after 3.5 s; error toasts persist

## Development Phases

- **Phase 1** ✓ — Electron scaffold, JSON I/O, all screens stubbed
- **Phase 2** ✓ — Student, group, exam management screens
- **Phase 3** — Score entry grid (Handsontable) — included, needs testing
- **Phase 4** — Word export via `docx` — UI stubbed, logic TBD
- **Phase 5** — Student profile & Chart.js progress graphs — stubbed
- **Phase 6** — Excel import from `klas6.xlsx`
- **Phase 7** — electron-builder packaging & installer polish
