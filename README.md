# VisiSocial

Proof-of-concept transparency platform that shows social-media users what an
analyst could infer from their own authorised data: multimodal analysis
(text, images via Google Cloud Vision + OCR), personality estimation,
OSINT exposure signals, and an AI-generated plain-language report.

**Research prototype.** Runs only against Meta developer test users in a
development-mode Facebook app, consistent with Meta's Platform Terms. It does
not evaluate report accuracy, quality, usability, or security — see the paper.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in your own credentials
   (Facebook dev app, OpenAI, MongoDB, optional OSINT keys).
3. Place your own Google Cloud Vision service-account JSON in `cloudvision/`
   and point `GOOGLE_APPLICATION_CREDENTIALS` at it.
4. For OCR, download Tesseract's `eng.traineddata`
   (https://github.com/tesseract-ocr/tessdata) into the project root.
5. `npm start` (see `package.json` scripts; default port 3001).

## License

MIT — see [LICENSE](LICENSE).
