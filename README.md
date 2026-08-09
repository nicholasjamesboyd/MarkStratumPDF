# RedColumn

Free, open-source PDF viewer (and future markup) desktop app. MIT licensed.

RedColumn aims at document and drawing workflows: efficient multi-page viewing, pan/zoom for large sheets, and later markups, measure, stamps, and PDF editing. Compatibility with other PDF programs is a design goal.

## Current status (MVP)

This first release is a **PDF viewer only**:

- Open local PDFs (dialog, drag-and-drop, or OS open)
- Document mode: continuous vertical scroll
- Drawing mode: pan/drag and wheel zoom toward the cursor
- Visible-page rendering via PDFium (not PDF.js)
- Zoom controls: fit width, fit page, percent
- Password-protected PDFs

Not in this MVP yet: tabs, markups, measure, stamps, page editing, flatten, forms, OCR, or layers.

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

## Architecture

- **Electron main:** owns PDFium (`pdfium-native`), document session, LRU page cache, menus, file dialogs
- **Preload:** exposes a narrow `window.redColumn` API
- **Renderer (React):** viewport, toolbar, status bar

PDF access goes through a `PdfEngine` interface so the renderer never loads native code, and the engine can later grow tiled rendering without rewriting the UI.

## License

MIT. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
