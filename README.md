# MarkStratum

Free, open-source PDF viewer (and future markup) desktop app. MIT licensed.

Repository: https://github.com/nicholasjamesboyd/MarkStratumPDF

MarkStratum targets document and drawing workflows: multi-page viewing, pan/zoom for large sheets, fillable forms, and later markups, measure, stamps, and PDF editing. Compatibility with other PDF programs is a design goal.

## Current status

Beyond the original viewer MVP, the app now includes a multi-document shell, fillable forms, and OCG layer controls:

- Open local PDFs (dialog, drag-and-drop, or OS open-with / default app)
- Multi-tab workspace, recent files, bookmarks panel, Pages panel, and horizontal split view
- Pages preview shelf: resizable multi-column thumbnail grid, page tools (insert, extract, delete, split, rotate, replace, crop), drag to reorder, drop PDFs/tabs to insert or replace
- Document mode: continuous vertical scroll
- Drawing mode: pan/drag and wheel zoom toward the cursor
- Visible-page rendering via PDFium (not PDF.js)
- Zoom controls: fit width, fit page, percent
- Password-protected PDFs
- Fillable AcroForm fields: text, checkbox, radio, dropdown, and list
- Save and Save As write filled values while keeping the form editable
- Optional Content Groups (layers): list, toggle visibility, create, rename, and delete; changes re-render via PDFium and persist on Save

Not built yet: markups, measure, stamps, flatten, signature fields, or OCR.

## Requirements

- Node.js 20+ (22 recommended)
- Windows, macOS, or Linux

## Develop

```bash
npm install
npm run dev
```

`npm install` downloads a PDFium prebuild via `pdfium-native` (no C++ toolchain required on supported platforms). If the native binary is missing, run `node ./scripts/ensure-pdfium.mjs`.

Useful scripts:

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start Electron in development |
| `npm run typecheck` | TypeScript checks |
| `npm test` | Unit tests |
| `npm run build` | Production build + installer |
| `npm run build:dir` | Unpackaged build for local testing |
| `npm run icons` | Regenerate favicon and app icons from `public/logo-source.png` |

## Architecture

- **Electron main:** owns PDFium (`pdfium-native`), document session, LRU page cache, menus, file dialogs, and form save via `pdf-lib`
- **Preload:** exposes a narrow `window.markStratum` API
- **Renderer (React):** tabs, tool shelf, viewport with form overlays, toolbar, status bar

PDF access goes through a `PdfEngine` interface so the renderer never loads native code. Field values are read with PDFium and written with `pdf-lib` so filled forms stay interactive in other viewers. Layer (OCG) visibility is edited in `OCProperties` with `pdf-lib`, then the working PDF is reloaded into PDFium so renders match.

For the overall product plan and later phases, see [docs/ROADMAP.md](docs/ROADMAP.md).

## License

MIT. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
