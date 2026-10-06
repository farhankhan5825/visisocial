'use strict';
// All source content is authored here. Ground truth is planted independently of analysis output.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const root = path.join(__dirname, 'profiles');
const names = ['Alex Morgan', 'Aisha Khan', 'Luca Rossi', 'Mei Chen', 'María García', 'Diego López', 'عائشہ خان', 'علی احمد', 'Sam Taylor', 'Fatima Noor'];
const languages = ['en', 'en', 'en', 'en', 'es', 'es', 'ur', 'ur', 'en', 'en'];
const texts = { en: ['I love technology and software.', 'This music concert is not good.', 'This art painting is on display.'], es: ['Me encanta la tecnología y los programas.', 'Este concierto de música no es bueno.', 'Esta pintura está en exposición.'], ur: ['مجھے ٹیکنالوجی اور سافٹ ویئر پسند ہیں۔', 'یہ موسیقی کا پروگرام اچھا نہیں ہے۔', 'یہ پینٹنگ نمائش میں ہے۔'] };
const cityTexts = { en: 'I live in London.', es: 'Vivo en Londres.', ur: 'میں لندن میں رہتا ہوں۔' };
const shape = { Book: '<rect x="30" y="30" width="100" height="100" fill="#276795"/><path d="M80 30v100" stroke="white" stroke-width="4"/>', Tree: '<path d="M70 125V65" stroke="#7b5137" stroke-width="12"/><circle cx="70" cy="50" r="35" fill="#3d8a50"/>', House: '<rect x="35" y="65" width="90" height="65" fill="#cca874"/><path d="M20 65L80 10l60 55z" fill="#bb5a53"/>', Car: '<rect x="20" y="70" width="120" height="40" rx="8" fill="#326f98"/><circle cx="45" cy="115" r="12" fill="#222"/><circle cx="115" cy="115" r="12" fill="#222"/>' };
async function build() {
  fs.mkdirSync(root, { recursive: true });
  for (let index = 0; index < 10; index++) {
    const id = `p${String(index + 1).padStart(2, '0')}`, language = languages[index], peak = index === 8 ? 23 : index === 9 ? 0 : 18;
    const posts = Array.from({ length: 20 }, (_, i) => ({ id: `${id}-post-${i + 1}`, message: `${texts[language][i < 10 ? 0 : i < 15 ? 1 : 2]}${i < 3 ? ` ${cityTexts[language]}` : ''}`, created_time: `2026-07-${String(1 + i).padStart(2, '0')}T${String(i < 12 ? peak : (peak + 3) % 24).padStart(2, '0')}:00:00+01:00` }));
    const subjects = index % 2 ? ['Tree', 'Book', 'Car', 'House'] : ['Book', 'Tree', 'House', 'Car'];
    const photoTruth = subjects.map((subject, i) => ({ photoId: `${id}-photo-${i + 1}`, text: `BOOKS ${i + 1}`, labels: [subject], subject }));
    const photos = photoTruth.map(p => ({ id: p.photoId, images: [{ source: `fixture://${p.photoId}.png` }] }));
    const profile = { id, name: names[index], email: `${id}@example.test`, timezone: 'Europe/London', posts: { data: posts }, likes: { data: [{ id: `${id}-like-1`, name: 'Technology and education', category: 'Education' }] }, photos: { data: photos } };
    const truth = { id, language, nameVariant: names[index], topics: ['technology', 'arts'], peakHours: [peak], sentiment: language === 'en' ? { positive: 10, negative: 5, neutral: 5, unscored: 0 } : { positive: 10, negative: 5, neutral: 5, unscored: 0 }, city: 'London', cityPostIds: posts.slice(0, 3).map(p => p.id), inference: ['location:London'], photoTruth, breaches: index % 2 ? [] : [{ Name: 'SyntheticExample', BreachDate: '2020-01-01', DataClasses: ['Email addresses', 'Passwords'] }], interests: ['technology', 'education'] };
    // Authored response doubles are not recorded live-service results.
    const mocks = { provenance: 'authored_synthetic_provider_double_v1', vision: Object.fromEntries(photoTruth.map((p, i) => [p.photoId, { fullTextAnnotation: { text: i === 3 ? `B00KS ${i + 1}` : p.text }, labelAnnotations: [{ description: i === 3 ? 'IncorrectLabel' : p.subject, score: .8 }], localizedObjectAnnotations: [], logoAnnotations: [], landmarkAnnotations: [] }])), inference: { items: [{ attribute: 'location', guess: 'London', evidence: [{ postId: posts[0].id, quote: cityTexts[language] }], certainty: 'low' }, { attribute: 'occupation', guess: 'engineer', evidence: [{ postId: posts[0].id, quote: 'unsupported quote' }], certainty: 'high' }] }, breaches: truth.breaches };
    for (const [suffix, data] of [['', profile], ['.truth', truth], ['.mocks', mocks]]) fs.writeFileSync(path.join(root, `${id}${suffix}.json`), JSON.stringify(data, null, 2) + '\n');
    for (const photo of photoTruth) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="260"><rect width="600" height="260" fill="white"/>${shape[photo.subject]}<text x="170" y="105" font-family="sans-serif" font-size="54" fill="black">${photo.text}</text></svg>`;
      fs.writeFileSync(path.join(root, `${photo.photoId}.svg`), svg);
      await sharp(Buffer.from(svg)).png().toFile(path.join(root, `${photo.photoId}.png`));
    }
  }
}
if (require.main === module) build().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
module.exports = { build };
