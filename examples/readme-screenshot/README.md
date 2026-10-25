# README screenshot

Regenerates [`docs/images/schema-editor-structure.png`](../../docs/images/schema-editor-structure.png), the hero image at the top of the README.

## Usage

```bash
pnpm install
pnpm screenshot:readme
```

1. `create-project.mjs` writes a demo project (two schemas, nine tables, initial data) to `.fixtures/readme-screenshot/project`.
2. `capture.mjs` starts the Vite dev server on port 6842 if nothing is listening there.
3. The Electron desktop shell opens with an isolated profile, loads the demo project through the real file-system bridge, and selects the `orders` table.
4. The page is rendered and saved to `docs/images/schema-editor-structure.png`. The window controls are drawn into the menu bar's reserved 150×40 corner, because the real ones are OS-drawn and not part of the page.
5. `compress-png.mjs` downscales the capture by the factor set in `capture.mjs`, then re-encodes it with an indexed 256-color palette.

The demo sticks to `String` and `DateTime` unified types: the field type column is 100 px wide in the app, so longer names would truncate in the screenshot.

Requirements: port 6842 free and Electron installed (dev dependency of `app/desktop`). `.fixtures/` is gitignored.
