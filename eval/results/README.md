# Saved runs

The paper uses `2026-10-06T09-30-14-475Z` for the full offline pipeline and `ocr-2026-10-06T09-12-38-727Z` for genuine local Tesseract 7 OCR. `LATEST` and `LATEST_OCR` point to these runs at this revision; later evaluations create new directories and update these pointers, without changing the paper's explicit run IDs.

All other directories are preliminary development runs. One has an explicit INVALIDATED note. The earlier OCR run used Tesseract 4 and is not the current result. Retaining these outputs documents changes rather than selecting a flattering result.

The final pipeline directory also contains tests, coverage, a clean source-install verification, dependency audit and scanner findings with review dispositions. They were captured after the timed run; they do not change its timings or provider mode. Authored mocks are test doubles, never live API measurements. Scanner results are restricted to public app source; no private logs, credentials or uploads were scanned or released.
