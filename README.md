# VisiSocial

VisiSocial is a research prototype that shows people what can be concluded from their own Facebook data, and on what evidence. Every finding is labelled as something you did (observed), something computed from it, or something a language model guessed, and each one links back to the posts, likes or photos it came from. There is no Big Five scoring, no search of other people and no composite risk score.

A hosted instance runs at [visisocial.citmta.com](https://visisocial.citmta.com); sign-in there is limited to allowlisted accounts.

## Quick start (local)

You need Node.js 22 or newer, a local MongoDB and a Facebook app in Development Mode.

1. Copy `.env.example` to `.env`. The file explains every setting.
2. Generate `SESSION_SECRET` and `TOKEN_ENCRYPTION_KEY` with the command given in the file.
3. Add your Facebook app ID and secret, and put your own Facebook user ID in `FACEBOOK_TEST_USER_IDS`.
4. In the Facebook app, register `http://localhost:3001/auth/facebook/callback` as a valid OAuth redirect URI.
5. Install and start:

```sh
npm ci
npm start
```

Open http://localhost:3001 (use `localhost`, so it matches the redirect URI), continue with Facebook, choose what to share and run the analysis. If startup fails, the terminal names the missing or invalid setting.

The OpenAI, Google Vision, HIBP and local OCR providers are optional. Leave a key empty to switch that provider off. A configured key never enables processing on its own: the user still has to opt in on the consent screen.

The app has these pages: **Dashboard** (profile summary, charts and findings), **Evidence trail** (every finding next to its source items, filterable into observed, computed and AI-guessed), **Profile layers**, **What they see** (what platforms, advertisers and brokers can do, tied to your computed findings) and **My data** (export, re-run and delete).

## Deploying

With `NODE_ENV=production` the server refuses to start unless `PUBLIC_ORIGIN` is an HTTPS origin and `MONGODB_URI` is a `mongodb+srv://` (TLS) connection. Put the app behind an HTTPS reverse proxy with exactly one trusted proxy hop, do not expose the app port directly, and register `<PUBLIC_ORIGIN>/auth/facebook/callback` in the Facebook app. Use a fresh database and independent random secrets. Check the current Graph API version in [Meta's changelog](https://developers.facebook.com/docs/graph-api/changelog/) before setting `API_VERSION`.

Only the Facebook user IDs listed in `FACEBOOK_TEST_USER_IDS` can sign in. Any other account is refused after the identity check, before its posts, likes or photos are requested. Meta's platform terms, app permissions and any ethics requirements need to be checked for your own deployment; this repository does not certify compliance.

On live startup the server refuses to run against data left by older versions of VisiSocial (the `users`, `usertokens`, `internetsearchresults` and `sessions` collections, or files under `uploads`, `temp` or `evidence`). Use a fresh database and directory, or migrate the old data explicitly.

## Tests and evaluation

None of these need credentials.

```sh
npm test
npm run eval
npm run lint
npm run format:check
```

They use synthetic fixtures and test doubles for the external services. `npm run lint` checks JavaScript syntax only. The test suite has 71 tests in 15 suites, with 76.5% line and 81.7% branch coverage. GitHub Actions runs the same checks on Node 22, plus Semgrep and njsscan in a separate Linux job.

`npm run fixtures` regenerates the ten evaluation profiles from [eval/fixtures-source.js](eval/fixtures-source.js): ten fictional personas in nine timezones, with 200 hand-written posts (139 English, 30 Spanish and 31 Urdu, some of it Roman Urdu) and 80 page likes, each labelled for language, sentiment and topics. `npm run eval` runs the real local pipeline, scores the rule-based modules against those labels with 95% Wilson intervals, and writes results, reports, timings, a failure-injection report and source hashes to a new `eval/results/<UTC run>/` folder. The Vision, OpenAI, HIBP and explanation paths use test doubles, so their results are reported as contract checks and not as accuracy. See the [evaluation protocol](eval/README.md).

Results from run 2026-10-06T10-24-06-563Z (protocol 2.0.0):

| Module | Result |
|---|---|
| Language detection, all 200 posts | 95.0% accuracy, 95% CI [91.0, 97.3] |
| Sentiment, scored English posts | 44.4% accuracy, CI [36.2, 52.8], macro-F1 0.44 |
| Post topics, English | precision 0.67, recall 0.40 |
| Page-like categories | precision 1.00, recall 0.76 |
| Peak posting hour | 13 of 13 peaks recovered |

Spanish and Urdu posts are left unscored and fall outside the English topic rules. All labels come from one annotator who also maintains the taxonomy, so read these numbers as a reproducible check, not a validated benchmark. Runs before protocol 2.0.0 (for example 2026-10-06T09-30-14-475Z) used fixtures written in the vocabulary of an older word list and do not measure accuracy.

The separate local OCR run (ocr-2026-10-06T09-12-38-727Z) gave a character error rate of 0.661 and a word error rate of 0.813 on the generated images. To repeat it, download `eng.traineddata` from [tessdata](https://github.com/tesseract-ocr/tessdata) into a local folder and run:

```powershell
$env:TESSERACT_LANG_PATH = 'C:\path\to\local-language-data'
npm run eval:ocr
```

## Modules

| Module | What it does |
|---|---|
| Text | Per-post language detection (tinyld; short posts inherit the profile's dominant language, and the report says so), VADER sentiment for English posts (other languages are unscored, not neutral), Flesch Reading Ease, TF-IDF keywords and a 15-topic English keyword taxonomy matched on whole words |
| Temporal | Graph API timestamps converted to the user's chosen IANA timezone; circular hour statistics, hourly histogram and peaks, corrected entropy, intervals and weekday/weekend counts, from at least ten timestamps |
| Images | Google Vision labels, objects, logos, landmarks and document text, with an optional consented local Tesseract fallback. No face analysis |
| Likes | Facebook page category first and page name second, mapped to the same 15 topics; unmapped likes are reported |
| AI guesses | Location, occupation and interests, each backed by an exact quote from a post. Age range and relationship status need a separate opt-in, and qualitative personality observations need another. No numerical trait scores |
| Profile summary | A short "AI profile summary" built only from topics, likes and accepted guesses, checked against its sources; a deterministic snapshot is shown when no summary is accepted |
| Exposure | Have I Been Pwned breach names, dates and data classes for the email address from the signed-in Facebook identity only |
| Explanations | Plain-language sentences over each section's findings; sentences with unknown feature keys, wrong numbers or a failed second-model check are dropped and counted |

OpenAI requests default to `gpt-4o-mini` at temperature zero with strict JSON schemas; `OPENAI_MODEL` can override the model, and every report records which one was used. Breach data is attributed to [Have I Been Pwned](https://haveibeenpwned.com/) under CC BY 4.0.

## Privacy

Repeated sign-ins by the same account share one stored record. OAuth tokens are encrypted with AES-256-GCM and bound to their owner. Records are kept for 24 hours after the last update, and sessions and caches for at most one hour; a MongoDB TTL index and a sweep every minute remove expired data, and expired records are never served. Deleting your data drains your pending jobs and removes your record, token, report, feedback, cache entries and sessions. Copies you downloaded, data held by the providers you consented to, backups and Meta's own data are outside that deletion. OpenAI requests set `store: false`, which does not by itself guarantee that the provider keeps nothing.

The job queue runs in one process and is not durable across restarts or replicas.

## Security checks

`npm audit` reports no dependency advisories. Semgrep 1.172.0 (36 Node.js rules over 25 targets) raised four cookie-setting warnings, which were reviewed and are recorded with their dispositions. Njsscan 1.0.1 reported no findings on Windows; the Linux CI job gives it a supported platform. To run the scanners yourself, use a disposable Python environment with the [pinned requirements](scripts/security-requirements.txt) and the commands in the [CI workflow](.github/workflows/checks.yml). These checks are not a penetration test.

## Code map

`index.js` loads `.env` and starts `src/server.js`. `src/app.js` sets up Express and `src/routes` handles requests. The pipeline lives in `src/ingest`, `src/analysis`, `src/report`, `src/privacy`, `src/jobs`, `src/prompts` and `src/schemas`; `src/analysis/taxonomy.js` holds the topic and page-category lists, and `src/report/present.js` turns a report into plain-language sections. The views are EJS with project CSS, server-rendered SVG charts and one same-origin script for filtering and source tracing. `npm run format` applies Prettier; saved results, fixtures, golden files and prompts are excluded so their hashes do not change.

## Licence

[MIT](LICENSE). The fixture text and artwork were written and drawn for this project and are released under the same licence. No myPersonality data is included or used.
