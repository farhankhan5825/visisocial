# VisiSocial

A research prototype that shows observations and cited AI guesses about an authenticated user's own data. Each finding includes its method, source IDs, sample size and limitations. The rebuilt app has no Big Five scoring, arbitrary-person search, fabricated dashboard statistics or composite risk score.

The default is an **offline synthetic demonstration**. Google Vision, OpenAI and HIBP responses in that demonstration are explicitly authored mocks; they do not measure those services' accuracy. Read the revised, unpublished [paper](paper/revised.md), [change record](paper/CHANGES.md) and [audit](AUDIT.md).

## Run from a clean checkout

Use Node.js 22 or newer and npm. No database, credentials, private CSV, language-training data or .env file is needed:

```sh
npm ci
npm run lint
npm test
npm run eval
npm start
```

Open [the demo](http://127.0.0.1:3001), choose the synthetic profile, review consent and generate the report. It binds to loopback and keeps records in memory; restarting clears that state. It never loads an old .env file. `npm run dev` runs the demo with Node's file watcher. `npm run lint` checks JavaScript syntax, not ESLint or security.

Tests cover consent/report/export/feedback/delete, ownership, CSRF, deletion across two mocked OAuth sessions, metric edge cases and a full report golden file. GitHub Actions runs coverage and the offline evaluator on Node 22; a separate Linux job runs scanners. Hosted CI has been configured but has not run during this overhaul.

## Implemented modules

| Module | Output and boundary |
|---|---|
| Text | Exploratory English per-post sentiment, raw-text Flesch Reading Ease, TF-IDF keywords, six project topics and a script/English-anchor heuristic. No NER or validated multilingual classifier. |
| Temporal | Explicit IANA timezone, circular hour statistics, histogram/modes, corrected entropy, intervals and weekday/weekend counts. At least ten valid timestamps; no inferred routines. |
| Images | Vision labels, objects, logos, landmarks and document text; optional consented local Tesseract fallback. No face analysis. Images complete before synthesis. |
| Likes | Names/categories mapped to the six topics; a like does not establish identity or belief. |
| AI guesses | Fixed attributes, exact cited quotes and abstention. Sensitive age/relationship guesses require another opt-in. Quote verification does not prove truth. |
| Exposure | HIBP breach names, dates and data classes for the email from the server-fetched OAuth identity. No free-form email, name, phone, username, image or domain lookup. |
| Explanations | Section feature JSON, supported keys, numeric checks and a second LLM judge; unsupported sentences are dropped and counted. |

Reports show module failures and provenance, support “This is wrong” feedback, stream a fixed-name JSON export and offer deletion. Provider credentials without consent do not enable processing.

## Reproduce measurements

`npm run fixtures` regenerates ten profiles, planted truth and project-authored SVG/PNG images. `npm run eval` runs the actual local pipeline with external-provider doubles: thirty empty-cache and thirty prefilled-cache executions. It saves reports, per-profile metrics, stage timing CSV, failure injection and environment/source hashes to a new `eval/results/<UTC run>/`. It updates LATEST; the paper cites fixed run IDs so later runs cannot silently change its evidence. See [evaluation protocol](eval/README.md).

The paper uses **2026-10-06T09-30-14-475Z**. This is software-contract evaluation, not a live API benchmark or user study. The language pilot exposes the English topic rules' coverage gap.

The separate **real local OCR** run is **ocr-2026-10-06T09-12-38-727Z**. Its character error rate was 0.6607 and word error rate 0.8125; quality was poor on these generated images. To repeat it, obtain public eng.traineddata from [Tesseract tessdata](https://github.com/tesseract-ocr/tessdata), put it in a local directory and run:

```powershell
$env:TESSERACT_LANG_PATH = 'C:\path\to\local-language-data'
npm run eval:ocr
```

Language data is never downloaded implicitly. The saved OCR summary records its exact hash and Tesseract version. Per-image timing excludes worker startup; this is not a natural-photo or non-English benchmark.

## Optional live developer testing

Live Meta/OAuth, MongoDB operations and external services remain unverified. Configure a Meta app in Development Mode, appropriate permissions, allowlisted developer test accounts and a **fresh** TLS MongoDB database. Verify a currently supported Graph version in [Meta's documentation](https://developers.facebook.com/docs/graph-api/changelog/) and set API_VERSION=vN.0. The offline adapter's v24-shaped URLs are not a current-live-version claim. This task could not verify the current version from Meta's site.

Copy .env.example to .env and supply its required values. Configure an HTTPS reverse proxy with exactly one trusted proxy hop and no direct public access to the app port. Set PUBLIC_ORIGIN to the HTTPS origin and register its /auth/facebook/callback in Meta. Use mongodb+srv:// and NODE_ENV=production. Generate independent random session and encryption secrets; the encryption key must contain 64 hex characters. Keep credentials outside Git. Explicitly enable live mode:

```powershell
$env:APP_MODE = 'live'
npm start
```

Missing configuration fails closed. Optional keys enable providers only with consent. OpenAI uses gpt-4o-mini-2024-07-18, temperature zero and strict JSON schemas. Vision needs your service-account path. HIBP needs a suitable API subscription/key; breach data is attributed to [Have I Been Pwned](https://haveibeenpwned.com/), CC BY 4.0. Local OCR uses the explicit language directory.

The app checks the server-fetched me.id against the allowlist, uses one paginated Graph client and records acquisition failures. Platform/provider terms, permissions, proxy/TLS operation and ethics requirements must be verified for the actual deployment. The repository does not certify compliance or approval.

## Privacy and migration

Live sessions for one account share one retained record, enforced by a unique account index. OAuth tokens use AES-256-GCM with owner binding. Reports may retain quoted evidence; consent discloses exactly what goes to OpenAI, Vision and HIBP. Record retention is 24 hours from the last replacement; feedback does not extend it. Sessions and module caches last at most one hour. Mongo TTL plus a minute sweep removes expired records; reads deny expired records immediately. Local contract tests do not verify production TTL scheduling.

Deletion drains owned jobs and removes the record, token, report, feedback, cache and associated sessions. This version creates no server upload/export files. Downloaded copies, provider retention, backups and upstream Meta data are outside local deletion. OpenAI store:false does not guarantee zero provider retention. The in-process queue is not durable or suitable for distributed replicas.

Live startup refuses populated legacy users/usertokens/internetsearchresults/sessions collections and old files under uploads/temp/evidence. Some old searches have no recoverable owner. Use a fresh deployment directory/database or arrange an explicit owner-approved migration/purge. The overhaul preserves old private files and databases. The ignored original DOCX and private datasets are unchanged and are not runtime dependencies.

## Security evidence

Saved verification contains **48 passing tests**, **94.23% line coverage**, a clean source-install check and **zero npm dependency advisories** at the recorded date. Semgrep 1.172.0 ran 36 Node.js rules over 25 targets and raised four reviewed cookie-setting audit warnings, retained with dispositions. Njsscan 1.0.1 returned no findings on Windows; supported-platform coverage remains to be checked by Linux CI.

Scans exclude private files and disable metrics. Reproduce them in a disposable Python environment using [pinned scanner requirements](scripts/security-requirements.txt) and commands in [CI](.github/workflows/checks.yml). Tests and scans do not establish resistance to server compromise, live SSRF exploits, valid LLM entailment judgments or deletion from third parties. Remaining boundaries are recorded in the audit and paper.

## Code map and license

index.js starts src/server.js; src/app.js sets up Express and src/routes handles requests. src/ingest, analysis, report, privacy, jobs, prompts and schemas hold the corresponding pipeline pieces. EJS and project CSS provide the UI. No Bull, JWT, Redis, Tailwind or Socket.io claim applies to this version.

[MIT](LICENSE). Released fixture text and artwork are project-authored under that license. No myPersonality data is included or used.
