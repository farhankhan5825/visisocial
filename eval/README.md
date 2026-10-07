# Evaluation protocol (2.0.0)

`npm run eval` runs the real local pipeline on ten Graph-shaped fixture profiles and writes a new `results/<UTC run>/` directory. `results/LATEST` names the run the paper cites. No paper number may come from an unsaved console result.

## Fixtures

[fixtures-source.js](fixtures-source.js) is the single source. `npm run fixtures` turns it into `profiles/pNN.json` (Graph-shaped input), `pNN.truth.json` (labels) and `pNN.mocks.json` (authored provider doubles).

- Ten distinct personas with their own occupations, interests and posting rhythms, in nine IANA timezones (London ×2, Chicago, Sydney, Kolkata, Madrid, Mexico City, Karachi, Los Angeles, Lagos).
- 200 posts in total: 139 English, 30 Spanish, 31 Urdu. Two profiles code-switch (Spanish/English, Urdu/English), and four Urdu posts are Roman Urdu in Latin script.
- 80 page likes with realistic names and Facebook page categories.
- Timestamps are written as local wall-clock times and converted to the Graph API's own `+0000` format. This is what exposed the temporal module's rejection of colon-less offsets, which is now fixed.
- Posts were written as ordinary social-media text, not from the keyword lists. They include known hard cases: sarcasm ("Love that for us."), slang ("Gutted.", "hits different"), achievements with no emotional words, British spellings, Roman Urdu, and words that collide with topic keywords ("Running on caffeine").

**Labels.** Each post carries a language, a sentiment (positive/neutral/negative) and zero or more of the 15 topics. Each like carries topics. All were assigned by a **single annotator, the implementer, while writing the posts**. That person also maintains the taxonomy. There is no inter-annotator agreement, and some labels (especially neutral vs. mildly positive) are judgement calls. Treat the results as a transparent, reproducible check that anyone can re-label, not as a validated benchmark. Independent multi-annotator labelling with Krippendorff's alpha is the obvious next step.

**Post-hoc change.** One taxonomy change was made after seeing results on this set. Light stemming mapped "booked" to the keyword "book", so travel posts were tagged as arts and culture. "book" was removed. The superseded run `2026-10-06T10-17-47-180Z` is kept, with a note, so the effect is visible: post-topic precision went from 0.638 to 0.667, and nothing else changed.

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

## Timing and failure isolation

Thirty runs start from an empty module cache and thirty from a prefilled cache; each profile repeats three times per condition. These are process-warm runs that time local ingestion (mocked), analysis, synthesis and explanation (mocked). They exclude OAuth, network and provider latency, rendering and process start-up. Stage times can overlap because modules run concurrently. A failure-injection run makes the image module throw and checks that all other modules complete and a report is produced.

## OCR

`npm run eval:ocr` runs real local Tesseract on the 40 fixture PNGs (see the root README for the language-data path). The images are simple project-drawn shapes beside a two-word label. Tesseract often reads the shapes as characters, so the high error rate in run `ocr-2026-10-06T09-12-38-727Z` reflects this layout and is not a natural-photo benchmark.

## Not covered

Human usability or comprehension, live provider accuracy, LLM entailment quality, prompt injection, demographic bias of commercial models, production TTL scheduling and penetration testing.
