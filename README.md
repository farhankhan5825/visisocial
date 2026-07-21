# VisiSocial

**A multimodal, user-facing framework for making social-media profiling transparent.**

Platforms build rich behavioural profiles from your data and show you almost none of it. Most privacy tools focus on *restricting* collection or *deleting* stored data — they say little about what can already be inferred from information that is public or that you've authorised. VisiSocial takes the opposite angle: you connect your own account, and it shows you the profile an analyst *could* build, as a readable privacy report.

It combines natural-language processing, behavioural analytics, image analysis (Google Cloud Vision + Tesseract OCR), open-source intelligence (OSINT) signals, and LLM-generated explanations into a single application you run against your own data. Each technique is established on its own; the contribution is their integration into one tool an end user can actually run.

> **Research prototype — read this first.** VisiSocial is a proof of concept, not a production service or a population-scale study. It runs only against **Meta developer test users** in a Facebook app kept in **Development Mode**, consistent with Meta's Platform Terms; no real end-user data is touched. It does **not** evaluate report accuracy, quality, usability, or security — those require the consent-based studies the architecture is built to support. See the paper for the full framing and limitations.

Accompanies the paper *"VisiSocial: A Multimodal User-Facing Framework for Making Social Media Profiling Transparent"* (F. Khan and N. Micallef, Swansea University).

## What it does

A full run takes an authorised Facebook account through the pipeline:

- **Authentication** — Facebook OAuth 2.0, scoped to the connecting test user.
- **Authorised data acquisition** — pulls the user's own posts, likes, photos, and profile fields.
- **Multimodal analysis** — text (sentiment, readability, common words/topics), behaviour (posting rhythms and routines), images (Cloud Vision labels + OCR on embedded text), and personality estimation.
- **OSINT exposure signals** — checks how much of the same information is discoverable from public sources.
- **Explanation generation** — GPT-4o-mini narrates the aggregated evidence in plain language.
- **Dashboard + report export** — an interactive surveillance-style dashboard (profile depth, cross-modal links, exploitation-risk view, model comparison) plus an exportable report.

Analysis modules are designed to fail independently — if one modality is unavailable, the others still produce a coherent report.

## Architecture

Independent services over REST, so each can scale on its own:

- **Backend:** Node.js, Express, EJS views
- **Data:** MongoDB (Mongoose)
- **Auth:** Facebook OAuth 2.0 (Passport)
- **Vision/OCR:** Google Cloud Vision, Tesseract (`eng.traineddata`)
- **LLM:** OpenAI GPT-4o-mini
- **OSINT (optional):** Google Custom Search, Have I Been Pwned, Shodan

```
routes/       HTTP routes (auth, api, admin, surveillance, internet-search)
services/     surveillanceEngine, internetSearchEngine, ocrService, backgroundJobs
controllers/  request handling
models/       Mongoose schemas (User, Admin, tokens, search results)
views/        EJS templates (dashboard, surveillance/*, internetSearch/*)
utils/        logger, cache, rate limiter, metrics, task status
config/       app config + db connection
public/       static assets
index.js      app entry point
```

## Getting started

**Prerequisites:** Node.js 18+, a MongoDB instance, a Facebook developer app (Development Mode), a Google Cloud Vision service account, and an OpenAI API key.

```bash
git clone https://github.com/farhankhan5825/visisocial.git
cd visisocial
npm install
```

1. **Configure environment.** Copy the template and fill in your own credentials:
   ```bash
   cp .env.example .env
   ```
   Set `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET`, `OPENAI_API_KEY`, `MONGODB_URI`, a random `SESSION_SECRET`, and the callback URLs. OSINT keys (`GOOGLE_CSE_*`, `HIBP_API_KEY`, `SHODAN_API_KEY`) are optional — those features are skipped if absent.
2. **Google Cloud Vision.** Place your own service-account JSON in `cloudvision/` and point `GOOGLE_APPLICATION_CREDENTIALS` at it. (No credentials are shipped in this repo.)
3. **OCR data.** Download Tesseract's `eng.traineddata` from [tessdata](https://github.com/tesseract-ocr/tessdata) into the project root.
4. **Facebook app.** Keep the app in Development Mode and add the accounts you'll test with as **test users**. Add your dev callback URL (`http://localhost:3001/auth/facebook/callback`) to the app's OAuth settings.
5. **Bootstrap an admin (optional).** `createAdmin.js` reads `ADMIN_PASSWORD` (and optional `ADMIN_EMAIL`) from the environment:
   ```bash
   ADMIN_PASSWORD='...' node createAdmin.js
   ```

**Run:**

```bash
npm run dev     # development, auto-reload (default http://localhost:3001)
npm start       # nodemon
npm run prod    # production
npm run lint    # eslint
npm test        # jest
```

## Privacy & data handling

Data handling follows minimisation and user-controlled deletion: the system stores only what a run needs, and connected users can delete their data. Because an aggregated transparency profile is itself a high-value target, treat any deployment as sensitive and never run it against non-consenting accounts.

## Security status

A static-analysis pass (njsscan / Semgrep) was run over the codebase; three classes of findings remain open for remediation before any deployment — an SSRF surface in the OSINT engine, user-influenced file paths in export endpoints, and development-mode cookie hardening. Static analysis is **not** a substitute for a full penetration test, which is planned but not yet performed. Treat the current controls as **not fully audited**.

## License

[MIT](LICENSE) © 2026 Farhan Khan
