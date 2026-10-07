# Evaluation protocol (2.0.0)

`npm run eval` runs the real local pipeline on ten Graph-shaped fixture profiles and writes a new `results/<UTC run>/` directory. `results/LATEST` names the run the paper cites. No paper number may come from an unsaved console result.

## Fixtures

[fixtures-source.js](fixtures-source.js) is the single source. `npm run fixtures` turns it into `profiles/pNN.json` (Graph-shaped input), `pNN.truth.json` (labels) and `pNN.mocks.json` (authored provider doubles).

- Ten distinct personas with their own occupations, interests and posting rhythms, in nine IANA timezones (London ×2, Chicago, Sydney, Kolkata, Madrid, Mexico City, Karachi, Los Angeles, Lagos).
- 200 posts in total: 139 English, 30 Spanish, 31 Urdu. Two profiles code-switch (Spanish/English, Urdu/English), and four Urdu posts are Roman Urdu in Latin script.
- 80 page likes with realistic names and Facebook page categories.
- Timestamps are written as local wall-clock times and converted to the Graph API's own `+0000` format. This is what exposed the temporal module's rejection of colon-less offsets, which is now fixed.
- Posts were written as ordinary social-media text, not from the keyword lists. They include known hard cases: sarcasm ("Love that for us."), slang ("Gutted.", "hits different"), achievements with no emotional words, British spellings, Roman Urdu, and words that collide with topic keywords ("Running on caffeine").

**Labels.** Each post carries a language, a sentiment (positive/neutral/negative) and zero or more of the 15 topics. Each like carries topics. All were assigned by a **single annotator, the implementer, while writing the posts**. That person also maintains the taxonomy, and the same set was used during development, so treat it as a development and regression set rather than a held-out benchmark. Sentiment labels record the overall feeling the writer expresses or clearly implies about what they describe; VADER scores the wording, which is a different construct. Blind relabelling by a second annotator is set up in [annotation/](annotation/README.md).

**Post-hoc change.** One taxonomy change was made after seeing results on this set. Light stemming mapped "booked" to the keyword "book", so travel posts were tagged as arts and culture. "book" was removed. The earlier run `2026-10-06T10-17-47-180Z` is kept so the effect is visible: post-topic precision went from 0.638 to 0.667. Both runs were made on uncommitted working trees on top of commit 1d80a03, which is not in the public history. Their recorded hashes show eight changed files (`eval/run.js`, `src/analysis/image.js`, `src/analysis/taxonomy.js`, `src/analysis/text.js`, `src/pipeline.js`, `src/routes/index.js`, `src/server.js`, `src/report/present.js`). Besides the topic figures, the only result that differs is the count of English posts inside topic coverage (139 before, 133 after), because that count was redefined; every other accuracy, contract, OCR, inference, explanation and failure-isolation result is identical. Runs now record `gitDirty`, so a run made on uncommitted code is flagged.

## What is measured

`summary.json` has two clearly separated blocks.

`accuracy`: rule-based modules against the labels.
- **Language**: per-post accuracy over all 200 posts, with a confusion matrix.
- **Sentiment (English posts)**: coverage (share scored), then accuracy and macro-F1 on scored posts, with a confusion matrix. A separate end-to-end figure counts unscored posts as errors. Non-English posts must be *unscored*; any scored non-English post is counted.
- **Topics**: micro precision, recall and F1 over (post, topic) pairs for English posts, again over all posts (showing the coverage gap), and at profile level (topics with at least two posts).
- **Page-like topics**: micro precision, recall and F1 over (like, topic) pairs.
- **Peak hour**: against the mode of the planted local hours. This checks the timezone and timestamp handling; it is not an estimate of anything uncertain.
- Every proportion carries a 95% Wilson interval.

`contracts`: provider-backed paths run on **authored doubles**, not recorded API output.
- Vision labels and OCR text include one planted wrong label and one planted OCR substitution per profile.
- Inference doubles contain one verbatim-supported location guess and one fabricated quote that must be rejected.
- Explanation doubles inject a false number and an unsupported claim per section. The mock judge accepts only the planted true sentence.
- HIBP doubles return a synthetic breach for even-numbered profiles.

These rows show that verification and rejection paths work. Their rates (for example 2 of 3 sentences flagged, 1 of 2 guesses rejected) are **fixed by how the doubles were written** and say nothing about OpenAI, Google Vision or HIBP accuracy.

## Secondary analysis

`npm run eval:analyze` reads a saved run and writes `analysis.json` beside it: majority-class and stratified-random baselines, confusion matrices, results per persona, language accuracy split by monolingual and bilingual personas, majority-topic baselines, and persona-level bootstrap intervals (10,000 resamples of whole personas, fixed seed). Posts are nested in personas, so these intervals are the ones to quote; the Wilson intervals in `summary.json` treat posts as independent.

## Live-model evaluation

`npm run eval:live` runs the configured OpenAI model (temperature 0) on the ten personas with location, occupation, interests, the sensitive attributes and the personality option all enabled, and Vision and HIBP switched off. Only the synthetic fixture text is sent. Every request and response is saved to `live/<run>/calls.json` with the model snapshot that answered. `items.json` records each attribute guess with the verifier's decision, and each generated sentence with the outcome of every check on its own: feature keys, numbers, and the second-model judge (which is called for every sentence with valid keys, so that the checks can be compared). `node eval/run-live.js --replay eval/live/<run>` repeats the analysis from the saved responses without a key or network access.

The live run measures what the verifiers accept and reject. Whether accepted output is supported or true is rated by people; see [annotation/](annotation/README.md).

## Timing and failure isolation

Thirty runs start from an empty module cache and thirty from a prefilled cache; each profile repeats three times per condition. These are process-warm runs that time local ingestion (mocked), analysis, synthesis and explanation (mocked). They exclude OAuth, network and provider latency, rendering and process start-up. Stage times can overlap because modules run concurrently. A failure-injection run makes the image module throw and checks that all other modules complete and a report is produced.

## OCR

`npm run eval:ocr` runs real local Tesseract on the 40 fixture PNGs (see the root README for the language-data path). The images are simple project-drawn shapes beside a two-word label. Tesseract often reads the shapes as characters, so the high error rate in run `ocr-2026-10-06T09-12-38-727Z` reflects this layout and is not a natural-photo benchmark.

## Not covered

Human usability or comprehension, Vision and HIBP accuracy, prompt injection, demographic bias of commercial models, production TTL scheduling and penetration testing. Human ratings of the live model's output are collected separately through the annotation package.
