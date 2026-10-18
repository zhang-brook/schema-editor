<p align="center">
  <img src="./app/web/public/logo.png" width="128" alt="schema-editor logo">
</p>

<h1 align="center">schema-editor</h1>

<p align="center"><em>A visual editor for database schema JSON definitions.</em></p>

<p align="center">
  English | <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/zhang-brook/schema-editor">GitHub</a> · <a href="https://zhang-brook.github.io/schema-editor/">Live Preview</a>
</p>

Edit JSON schema definitions through a graphical interface, preview MySQL / PostgreSQL CREATE TABLE statements in real time, and export the result as JSON or SQL files.

## Features

- **Visual editing**: Tree navigation (Schema > Table) for managing table structures across multiple schemas
- **Dialect support**: Field types and index configurations with per-dialect overrides for MySQL / PostgreSQL / SQLite
- **Field management**: Edit field properties in a table, with add/remove, comment toggles, and drag-and-drop sorting
- **Index management**: Define primary keys, unique indexes, and regular indexes, with dialect overrides
- **Real-time SQL preview**: Preview the CREATE TABLE statement and initial-data INSERT statements while editing
- **Initial data editing**: Edit initial data in table or JSON mode, stored per table at `current/schemas/<schema>/<table>/initial-data.json`
- **Common configuration**: Edit common field references (`common_used_fields`) and default settings in `common.json`
- **On-demand saving**: Read and write local folders directly, touching only affected files; "Sync SQL" depends on "Auto save", so project files can be saved automatically while SQL under `output/` is left for manual saving
- **Git repository data source**: Mount a subdirectory of a GitHub / Gitee / self-hosted Gitea repository as a project without cloning it locally. This mode does not auto-save; changes are pushed to the remote branch after confirmation in the "Commit" dialog
- **Unsaved-changes guard**: When there are unsaved changes, closing the project, switching folders, or reloading asks "Save / Don't save / Cancel"

## Quick start

```sh
# Install dependencies
pnpm install

# Start the dev server
pnpm dev

# Build for production
pnpm build
```

## Desktop (Windows / macOS / Linux)

The app also runs as a local desktop application. It shares the same UI and features as the web version and uses the native folder picker to open project folders. Desktop dependencies (including the Electron binary) are installed by `pnpm install` above. CI attaches platform installers to [Releases](https://github.com/zhang-brook/schema-editor/releases): Windows `schema-editor-vX.Y.Z-windows-x64-setup.exe` / `-portable.exe`, macOS `schema-editor-vX.Y.Z-macos-universal.dmg`, and Linux `schema-editor-vX.Y.Z-linux-x86_64.AppImage` / `-linux-amd64.deb`. Installed builds and the AppImage can check for and install updates from the "About" dialog. The macOS build is currently unsigned, so it must be allowed in System Settings on first launch.

```sh
# Development mode: dev server + desktop window
pnpm desktop:dev

# Package the installer for the current platform (output: app/desktop/release)
pnpm desktop:dist
```

## Usage

1. **Open a folder**: Choose "File → Open Folder" (Ctrl+O / ⌘O) and select an empty folder or an existing project folder (containing `common.json` + `current/`). You can also drop a folder into the window
2. **Open a Git repository**: Choose "File → Open Git Repository" and paste the repository URL (optionally with branch and subdirectory, e.g. `https://github.com/owner/repo/tree/main/projects/demo`) plus an access token. With "Remember token" checked, the token is stored in the browser per site and filled in next time. In this mode the toolbar's "Save" becomes "Commit": a dialog lists pending files and lets you edit the commit message before pushing to the branch. If the remote has new commits, the commit is rejected — reload from the repository and commit again
3. **Navigation**: Expand a schema in the left tree to see its tables; click a table name to switch the editing target
4. **Editing**: The right panel edits table properties, fields, and indexes; switch dialect tabs to preview SQL for each database
5. **Initial data**: Expand the "Initial Data" panel to edit a table's initial data
6. **Saving**: "Auto save" (top right) controls project files, and "Sync SQL" controls derived SQL under `output/` (enabling Sync SQL also enables Auto save; disabling Auto save also disables Sync SQL). When disabled, changes stay in memory until you press "Save" (Ctrl+S / ⌘S), and the title and toolbar show the unsaved state. "Save" is always available: even with no changes it rewrites all project files and rebuilds SQL under `output/` (for example, after that directory was deleted externally)
7. **Reloading**: If you edited local files manually, choose "File → Reload from Disk" (Alt+R) to discard in-memory changes and re-read them

> A self-hosted Gitea server must enable CORS (`[cors] ENABLED = true` in `app.ini`) so the browser can access its API directly.

## Directory layout

> You can start with an empty folder and edit everything through the UI — the files below are created automatically

The edited folder follows this structure:

```
your-schema-folder/
├── common.json          # Common field references and default settings (version-independent)
├── current/             # Version being edited (fixed name)
│   ├── database.json    # Schema ordering and other version-related settings
│   └── schemas/
│       └── <schema>/    # File-name-friendly schema name (special characters handled)
│           ├── schema.json  # Original schema name + table ordering
│           └── <table>/     # File-name-friendly table name
│               ├── table.json        # Table settings (field definitions, indexes, etc.)
│               └── initial-data.json # Inline initial data (optional)
└── output/<dialect>/    # Generated CREATE TABLE / initial-data SQL (derived, rewritten only when content changes)
```

> Folders using the old layout (`schemas/<schema>.json` plus a parallel `initial-data/` directory) are still recognized and offered an upgrade to the layout above on first open.

---

See [DEVELOPMENT.md](./DEVELOPMENT.md) for the project architecture and development guide.

## Contributing

Issues and pull requests are welcome. Please write commit messages and code comments in English. Documentation is maintained in English (default) and Chinese (`.zh-CN.md`).
