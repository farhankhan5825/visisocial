# Saved runs

Each `npm run eval` creates a new directory named by its UTC start time. `LATEST` names the newest pipeline run and `LATEST_OCR` the newest real-OCR run. The paper cites run IDs explicitly, so later runs never change its numbers.

| Run | Status |
|---|---|
| Newest directory (see `LATEST`) | Current pipeline run on a clean checkout of a public commit; the paper cites this run |
| `2026-10-07T06-12-32-283Z` | Earlier clean run on commit 8ebee94; identical results apart from timings |
| `2026-10-06T10-24-06-563Z` | Same results as above, but made on uncommitted code on top of commit 1d80a03 |
| `2026-10-06T10-17-47-180Z` | Run before the keyword "book" was removed from the taxonomy (see `../README.md`) |
| `2026-10-06T09-30-14-475Z` and earlier | Protocol 1.0.0 runs on the earlier fixtures, which were written in the vocabulary of an old word list. Superseded; kept for the record. This directory also holds the clean-install, dependency-audit and scanner records captured at that time |
| `ocr-2026-10-06T09-12-38-727Z` | Real local Tesseract 7 OCR run cited in the paper |
| `ocr-2026-10-06T09-07-31-641Z` | Earlier OCR run with Tesseract 4; superseded |

A pipeline directory contains `summary.json`, `per-profile.json` (every per-post language and sentiment prediction beside its label), `timings.csv`, ten report files, `failure-injection.report.json`, and, after `npm run eval:analyze`, `analysis.json` with baselines and persona-level intervals.

`summary.json` records the commit, a `gitDirty` flag (from protocol runs made after 7 October 2026), Node version, platform, CPU and a hash of every source file. The source hashes are SHA-256 digests of `JSON.stringify(text)`, where `text` is the file with CRLF line endings converted to LF (see `hash()` in `src/pipeline.js`), so they will not match `sha256sum` of the files directly.

Static-scan reports for the current code are attached to each GitHub Actions run of `.github/workflows/checks.yml`. Authored mocks are test doubles, never live API measurements. Live-model runs are under `../live/`.
