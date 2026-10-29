# Development Guide

English | [简体中文](./DEVELOPMENT.zh-CN.md)

This guide is for contributors to schema-editor and covers the tech stack, project structure, architecture, and quality tooling.

## Tech stack

- **Vue 3** + **TypeScript** + **Vite**
- **Pinia** for state management
- **vue-i18n** for internationalization (en / zh-CN / zh-TW)
- **File System Access API** — reads and writes the local folder chosen by the user; changes are persisted through the workspace session on demand
- **Git platform REST APIs** — the browser talks directly to GitHub / Gitee / Gitea to mount a branch subdirectory of a remote repository as the workspace
- Runs entirely in the browser with no backend; an Electron desktop shell (`app/desktop/`) reuses the same frontend build and connects folder access to the native picker and the Node.js file system

## Project structure

The repository is a pnpm workspace: `app/` contains runnable applications, `packages/` contains packages shared between applications, and dependencies are installed once at the repository root.

```
app/
├── web/                         # Frontend app (shared by the web and desktop renderers)
│   ├── index.html               # Entry HTML
│   ├── public/                  # Static assets (favicon / logo)
│   ├── vite.config.ts           # Relative base: the build works under any path and can be loaded by the desktop shell over file://
│   └── src/
│       ├── App.vue                      # Root component and overall layout (toolbar + sidebar + editor)
│       ├── main.ts                      # Entry point; mounts Vue, Pinia, and i18n
│       ├── assets/
│       │   └── style/                   # Feature-split .css files (base / layout / table / modal / form, etc.), imported by components via <style scoped src>
│       ├── components/
│       │   ├── EditorToolbar.vue        # Top toolbar: Project / Edit / Help menus, save button, auto-save toggle, undo/redo
│       │   ├── UpgradingOverlay.vue     # Upgrade overlay for projects using an old structure
│       │   ├── ui/                      # Business-agnostic base components
│       │   │   ├── PageTabs.vue         # Underlined page-level tabs
│       │   │   └── SegmentedSwitch.vue  # Segmented button switch (dialect / mode, etc.)
│       │   ├── common/                  # Business components shared across pages
│       │   │   └── PrePostSqlEditor.vue # Pre/post SQL editor (shared by table / schema / initial data / global)
│       │   ├── icon/                    # Icon components
│       │   ├── modal/                   # Modal components (AddFieldModal / ImportSqlModal / AboutModal / ConfirmModal / OpenGitRepoModal / CommitDialog)
│       │   ├── settings/                # Settings area: left rail + three pages
│       │   │   ├── SettingsPanel.vue        # Shell: SettingsRail + three page components
│       │   │   ├── SettingsRail.vue         # Page switch column (Project Settings / Structure Design / Version Management)
│       │   │   ├── ProjectConfigPage.vue    # Project settings page (common fields / unified types / dialect config / LLM)
│       │   │   ├── StructureDesignPage.vue  # Structure design page (sidebar tree + drag divider + edit panel)
│       │   │   ├── VersionManagementPage.vue# Version management page (Version / Migration sub-tabs)
│       │   │   ├── VersionTimeline.vue      # Version timeline (nodes + migration links)
│       │   │   ├── EnvironmentPanel.vue     # Environment management
│       │   │   ├── RenameAlignPanel.vue     # Rename-detection alignment configuration
│       │   │   └── sections/                # Configuration sections inside the project settings page
│       │   │       ├── CommonUsedFieldsPanel.vue / UnifiedTypesPanel.vue
│       │   │       ├── LogicalDeletePanel.vue   # Logical delete settings (deleted field / not-deleted predicate / MySQL strategy)
│       │   │       ├── DialectConfigPanel.vue / DdlOptionsPanel.vue / TypeCasePanel.vue
│       │   │       ├── GlobalPrePostSqlPanel.vue / AiGuidePanel.vue / ProjectInfoPanel.vue
│       │   │       └── database-defaults/   # Database defaults (combined card + one sub-panel per dialect)
│       │   └── structure/               # Structure design components
│       │       ├── EditorSidebar.vue        # Left tree navigation: Schema > Table, with collapse/expand/drag
│       │       ├── SchemaConfigPanel.vue    # Schema configuration panel
│       │       ├── TableEditor.vue          # Main table editor, composing the components below
│       │       ├── TableBasicInfo.vue       # Table basic information editor
│       │       ├── FieldTable.vue           # Field list table editor (FieldCommentInput is the comment cell)
│       │       ├── IndexTable.vue           # Index list table editor (IndexColumnsEditor edits index columns)
│       │       ├── SqlPreview.vue           # Real-time CREATE TABLE preview (dialect switch)
│       │       └── InitialDataEditor.vue    # Initial data editor (includes InitialDataSqlPreview)
│       ├── composables/
│       │   ├── useDropFolder.ts         # Composable for opening a folder by drag and drop
│       │   ├── useEscClose.ts           # Composable for closing modals with Esc
│       │   ├── useConfirm.ts            # Global dialog queue (confirmDialog / chooseDialog / alertDialog)
│       │   ├── useEnterConfirm.ts       # Confirm dialogs with Enter
│       │   ├── useDesktopUpdate.ts      # Desktop update state (hidden on web and for the portable exe)
│       │   └── useEnabledDialect.ts     # Currently enabled dialects
│       ├── i18n/
│       │   ├── index.ts                 # vue-i18n initialization
│       │   ├── detection.ts             # Browser language detection
│       │   └── locales/                 # en / zh-CN / zh-TW language packs
│       ├── platform/
│       │   └── desktop-fsa.ts           # Desktop File System Access shim (directory/file handles, FileSystemObserver, showDirectoryPicker)
│       ├── stores/                      # Pinia: main store + action factories split by responsibility
│       │   ├── editor.ts                # Main store: holds state, composes the action factories, exposes one API to components
│       │   ├── editor-action-utils.ts   # Shared action-factory helpers (snapshot capture, name validation, array add/remove/move)
│       │   ├── editor-crud.ts           # Combines the schema / table / field / index action modules
│       │   ├── editor-schema-actions.ts # Schema add/remove/rename and ordering
│       │   ├── editor-table-actions.ts  # Table add/remove/rename, basic info, and pre/post SQL
│       │   ├── editor-field-actions.ts  # Field add/remove/rename, unified type resolution, and dialect overrides
│       │   ├── editor-index-actions.ts  # Index add/remove/rename and index columns
│       │   ├── editor-common-config.ts  # Common configuration (unified types / common fields / dialect config, etc.)
│       │   ├── editor-initial-data.ts   # Initial data editing
│       │   ├── editor-import-sql.ts     # SQL import parsing and persistence
│       │   └── editor-version.ts        # Versions / migrations / environments
│       ├── types/
│       │   ├── settings.ts              # Settings page types (SettingsTab)
│       │   └── global.d.ts              # Global declarations (browser APIs and the injected desktop object)
│       └── utils/
│           ├── constants.ts             # Global constants
│           ├── build-info.ts            # Build info (version / build time)
│           └── column-drag-flag.ts      # Global flag for an in-progress column drag
├── desktop/                     # Desktop shell (Electron): loads the frontend build, bridges the local file system and updates
│   ├── src/
│   │   ├── main.ts              # Main process: creates the window, registers IPC, loads the Vite server in dev
│   │   ├── preload.ts           # Exposes window.schemaEditorDesktop via contextBridge
│   │   ├── fs-service.ts        # node:fs-based file system service restricted to the authorized root (testable without Electron)
│   │   ├── updater.ts           # Update orchestration: turns electron-updater events into state updates (testable without Electron)
│   │   ├── update-state.ts      # Update state machine: checking / up to date / downloading / ready / failed
│   │   ├── window-chrome.ts     # Title bar mode → window frame options and caption overlay colors
│   │   └── ui-preferences.ts    # Window chrome preferences read before the window is created
│   ├── vite.config.mts          # CJS build for main / preload (two single-entry builds; preload must be self-contained)
│   └── electron-builder.mjs     # Packaging config (Windows NSIS/portable, macOS dmg/zip, Linux AppImage/deb); injects the root version and includes OS/arch in artifact names
└── packages/
    ├── core/                    # schema-editor-core: domain core independent of UI and the Vue runtime, shared by web and desktop
    │   ├── package.json         # Ships source directly (exports point to src/*.ts); host build tools compile it, no separate build step
    │   └── src/
    │       ├── index.ts                 # Entry: re-exports domain types; capabilities are imported by subpath, e.g. schema-editor-core/utils/sql-generator
    │       ├── types/
    │       │   └── schema.ts            # Core type definitions (Schema, Table, Field, Index, etc.)
    │       ├── core/                    # Core domain layer
    │       │   ├── ids.ts               # Unique id generation (only for stored entities such as versions / migrations)
    │       │   ├── history/
    │       │   │   └── command.ts       # Command pattern + structured patches (undo/redo foundation)
    │       │   ├── workspace/           # Unified path layer and workspace reads/writes
    │       │   │   ├── layout.ts        # Path constants + CURRENT_STRUCT_VERSION + file-name normalization
    │       │   │   ├── handles.ts       # File System Access API primitives
    │       │   │   ├── paths.ts         # Business path resolution (old/new structure compatibility)
    │       │   │   ├── serialization.ts # In-memory state → on-disk documents (common / schema / table)
    │       │   │   ├── project-documents.ts # Project document planning: derive files to write and SQL outputs from a change scope
    │       │   │   ├── browser-workspace.ts # Batch writes, path allow-list validation, and external-change conflict detection
    │       │   │   ├── git/             # Git remote workspace (URL parsing / platform APIs / writer / tokens)
    │       │   │   │   ├── url.ts       # Repository URL → provider + owner/repo + branch + subdirectory
    │       │   │   │   ├── types.ts     # GitRepoInfo, GitRepoError, and error codes
    │       │   │   │   ├── providers.ts # GitHub / Gitee / Gitea snapshot reads and commit implementations
    │       │   │   │   ├── credentials.ts # Tokens live in session memory; stored locally per site when remembered
    │       │   │   │   └── workspace.ts # GitWorkspaceWriter: no auto-save; rejects a commit when the branch head moved
    │       │   │   ├── save-coordinator.ts  # Serial save queue: dirty-file tracking + debounce + manual full save
    │       │   │   └── workspace-session.ts # Workspace session: load project, declare changes, manual save
    │       │   └── version/             # Versions and migrations
    │       │       ├── types.ts         # Version / migration script types
    │       │       ├── storage.ts       # versions/<id>.json reads and writes
    │       │       ├── migration-storage.ts # migrations/<id>.json reads and writes
    │       │       ├── environment-storage.ts # Environment definition storage
    │       │       ├── diff.ts          # Structure diff engine
    │       │       ├── identity.ts      # Rename detection and inference
    │       │       ├── matcher.ts       # Structural object similarity matching
    │       │       ├── chain.ts         # Version chain: parent/child timeline + missing-migration markers
    │       │       ├── guards.ts        # Operation validity checks
    │       │       └── migration-ddl.ts # Migration script → change DDL (MySQL / PostgreSQL / SQLite)
    │       └── utils/
    │           ├── file-helpers.ts          # Old → new structure migration entry point, plus field length/default input parsing
    │           ├── initial-data-io.ts       # Initial data (inline structure) reads and writes
    │           ├── dialect-resolver.ts      # Dialect override resolution helpers
    │           ├── index-column-utils.ts    # Index column parsing and dialect override helpers
    │           ├── field-utils.ts           # Field property access helpers
    │           ├── table-comment-utils.ts   # Table comment helpers
    │           ├── logical-delete.ts        # Logical delete resolution (project config + index overrides → per-dialect form)
    │           ├── unified-types.ts         # Unified types shared across modules
    │           ├── ai-guide/                # AI structure guide Markdown generation
    │           ├── structure-migrations/    # Project structure migration chain (v0.0 → v1.0, registry-driven)
    │           ├── sql-generator/
    │           │   ├── shared.ts        # Shared SQL generation logic
    │           │   ├── mysql.ts         # MySQL SQL generation
    │           │   ├── postgresql.ts    # PostgreSQL SQL generation
    │           │   └── sqlite.ts        # SQLite SQL generation
    │           └── sql-parser/
    │               ├── index.ts         # SQL parser entry point
    │               ├── tokenizer.ts     # SQL tokenizer
    │               ├── create-table-parser.ts # CREATE TABLE statement parser
    │               ├── dialect-detector.ts  # Automatic dialect detection
    │               └── type-mapper.ts   # Field type mapping
    └── bridge/                  # Desktop bridge protocol: IPC channel names and request/response payloads (main / preload / renderer)
```

The repository root holds shared tooling and configuration: TypeScript project references, ESLint / oxlint / oxfmt configs, scripts under `scripts/`, and supplementary docs under `docs/`.

## Architecture overview

Domain logic (types, SQL generation and parsing, workspace reads/writes, structure upgrades, version comparison) lives in `packages/core/src/` and is imported as `schema-editor-core/<subpath>`; the UI, Pinia stores, i18n, and the desktop File System Access shim live in `app/web/src/`. Packages do not depend on Vue; host-specific differences are injected at runtime. Below, bare module names refer to files: `stores/`, `platform/`, and `composables/` are under `app/web/src/`, while `core/`, `utils/`, and `types/` are under `packages/core/src/`.

### Data flow

```
Local working directory (common.json + current/ + versions/ + migrations/)
        │ File System Access API (core/workspace in schema-editor-core; on desktop, platform/desktop-fsa maps it to IPC calls)
        ▼
  workspace-session.ts  ←→  Pinia store (editor.ts + 5 action factories)
   (load + change scope + manual save)   │
        │                                ▼
        │                      Vue components (reactive rendering)
        │                                │
        ▼                                ▼
  save-coordinator.ts              SQL generators (sql-generator/)
   (dirty-file tracking + debounce + batch writes)  │
        │  project-documents.ts                     ▼
        ▼  (derive files to write from the change scope)  SQL preview panel
  browser-workspace.ts (per-file writes + conflict detection)
```

The working directory can be replaced by a branch subdirectory: `workspace/git/` provides another writer that plugs into the same position in `save-coordinator.ts`, reading snapshots through platform APIs and turning writes into commits.

### Core design

1. **Composable store**: `stores/editor.ts` holds state and composes 5 action factories (CRUD / common config / initial data / SQL import / versions; CRUD is further split into schema / table / field / index modules), so components only use a single `useEditorStore()`
2. **Command-pattern undo/redo + on-demand persistence**: every change produces a command (apply / revert / affectedFiles). After execution, the set of affected files is passed to the workspace session; `project-documents.ts` expands it into the documents that actually need writing (including derived SQL), and `save-coordinator.ts` debounces and writes only files whose content really changed. Writes are split into two groups, "project documents" and "derived files" (SQL under `output/`, AI guide), and derived writes depend on project-document writes (enabling Sync SQL also enables project-file saving) so `output/` never runs ahead of the JSON. Groups with automatic writes disabled remain pending and are written in one batch by the "Save" button, with unsaved-change indicators and a leave guard
3. **Dialect override resolution**: field types, indexes, and other properties are read through `resolveDialectOverride` (dialect value → top-level property → default), producing MySQL / PostgreSQL / SQLite DDL
4. **Replaceable writer**: local folders and Git branches share the same coordinator interface. The Git writer declares that it does not support auto-save; the coordinator therefore turns off both toggles and keeps changes in memory, and "Save" becomes "Commit": pending files are computed with the manual-save rules for preview in a dialog, then committed once after confirmation, without re-committing unchanged files. Before committing, the branch head is compared with the snapshot taken at load time and the commit is rejected on mismatch, so other people's pushes are never overwritten

## Scripts

```sh
pnpm dev           # Start the Vite dev server
pnpm build         # app/web: parallel type check + production build
pnpm preview       # Preview the production build
pnpm test:unit     # Vitest unit tests (packages/core, app/web, app/desktop)
pnpm type-check    # Whole-repo type check (root config + packages/core + app/web + app/desktop)
pnpm lint          # Serial: oxlint → eslint (whole repo)
pnpm format        # oxfmt formatting for app/web/src
pnpm changelog     # Generate CHANGELOG (version from the root package.json)
```

Desktop:

```sh
pnpm desktop:dev          # Dev mode: Vite dev server + Electron window
pnpm desktop:start        # Start the Electron window only
pnpm desktop:build        # Build the renderer (app/desktop/renderer) and main / preload
pnpm desktop:dist         # Build and package an installer for the current platform (app/desktop/release)
```

## Deployment

- Pushing a `v*` tag triggers [release.yml](./.github/workflows/release.yml): `build` builds the frontend and deploys GitHub Pages (output `app/web/dist`); `desktop` packages in parallel on Windows / macOS / Linux runners (macOS builds universal); `publish` attaches the web bundle and all platform installers to the same Release. Pushes to `main` and pull requests run [ci.yml](./.github/workflows/ci.yml) for type checking, unit tests, and the build
- `base` is the relative path `./`, so the build works under any subpath and can be loaded by the desktop shell over `file://`
- Pure frontend, no backend; the build output is static files
- The version is maintained only in the root `package.json`; the web build, desktop runtime, and installer metadata all read it at build time
- No code signing is configured: Windows may show a SmartScreen prompt, and macOS is blocked by Gatekeeper with no in-app update entry for now; signing and notarization will enable it later
- Installed builds and the AppImage check for updates from the "About" dialog: they read the platform's `latest*.yml` from GitHub Releases and let the user click "Restart and install" after download; the portable Windows exe cannot overwrite itself in place and does not expose this entry

## Contributing

Write commit messages and code comments in English. Documentation is maintained in English (default) and Chinese (`.zh-CN.md`).
