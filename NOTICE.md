# Third-party notices

MarkStratum is MIT-licensed application code. It depends on open-source libraries, including:

## PDFium

MarkStratum renders PDFs with [PDFium](https://pdfium.googlesource.com/pdfium/), accessed through [pdfium-native](https://github.com/xonaman/nodejs-pdfium-native) (MIT).

PDFium is distributed under a BSD-style license by the PDFium Authors / Google. See the PDFium project for the full license text.

Prebuilt PDFium binaries used by pdfium-native come from [bblanchon/pdfium-binaries](https://github.com/bblanchon/pdfium-binaries).

## Other dependencies

Runtime and build dependencies are listed in `package.json`. Review each package license before redistributing binaries.

Layer (OCG) editing follows the PDF Optional Content model. [JPDFium](https://github.com/Stirling-Tools/JPDFium) (MIT) was used as a behavioral reference for list / visibility / create / delete; MarkStratum implements its own `pdf-lib`-based service rather than depending on that project.
