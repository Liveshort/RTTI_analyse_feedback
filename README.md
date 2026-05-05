# RTTI App

Grade analysis tool for RTTI (Reproductie / Training / Transfer / Inzicht).

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
The app opens in a window with DevTools attached.

### Build Windows installer
```bash
npm run dist
```
Output appears in `dist/`. The installer sets up the app and creates a Start Menu shortcut.

---

## Project structure

```
rtti-app/
├── main.js          — Electron main process: window creation, file I/O, IPC
├── preload.js       — Secure IPC bridge (exposes window.rtti to renderer)
├── package.json     — Dependencies and electron-builder config
├── renderer/
│   ├── index.html   — App shell and navigation
│   ├── app.js       — All screen logic and UI
│   ├── store.js     — Data access layer (reads/writes JSON files)
│   └── style.css    — Styling
└── data/            — Created automatically, lives next to the .exe
    ├── config.json  — Active school year
    ├── students.json
    ├── groups.json
    ├── exams.json
    └── scores/
        └── <studentnr>.json
```

---

## Data folder location

- **Development**: `./data/` (next to `main.js`)
- **Production**: `data/` folder next to the `.exe` in the installation/OneDrive folder

The `data/` folder is never bundled into the app — it always lives alongside it so it can be shared via OneDrive.

---

## Development phases

- [x] **Phase 1** — Electron scaffold, JSON file I/O, all screens stubbed
- [ ] **Phase 2** — (included in Phase 1) Student, group, and exam management screens
- [ ] **Phase 3** — Score entry grid (Handsontable) — stubbed, needs testing
- [ ] **Phase 4** — Word generation (`docx` npm package)
- [ ] **Phase 5** — Student profile and Chart.js progress graphs — stubbed
- [ ] **Phase 6** — Excel import from `klas6.xlsx`
- [ ] **Phase 7** — electron-builder packaging and installer

---

## Concurrency (OneDrive)

- `students.json`, `groups.json`, `exams.json` use `.lock` files during writes (auto-released, 10s TTL for crash safety)
- `scores/<id>.json` files need no locking — one teacher writes per student
