'use strict';
const { z } = require('zod');
const { finding } = require('../report/feature');
const breach = z.object({ Name: z.string(), BreachDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), DataClasses: z.array(z.string()) });
async function analyzeExposure(profile, consent, { verifiedEmail, checkBreaches } = {}) {
  // Never take an identifier from a request body. Proof comes from server-side OAuth identity.
  if (!consent.hibp || !verifiedEmail || verifiedEmail !== profile.email || !checkBreaches) return { status: 'unavailable', features: {}, diagnostics: { reason: 'verified_email_or_consent_unavailable' } };
  const raw = z.array(breach).parse(await checkBreaches(verifiedEmail));
  const results = raw.map(b => ({ name: b.Name, date: b.BreachDate, dataClasses: b.DataClasses }));
  return { status: 'ok', features: { breaches: finding(results, 'hibp_v3_authenticated_owned_email_lookup', ['oauth:email'], ['Source: Have I Been Pwned (https://haveibeenpwned.com/), CC BY 4.0. Absence of records is not proof of safety. A breach record does not confirm a currently active account. No username, phone, name, image or domain search is offered.']) }, diagnostics: {} };
}
module.exports = { analyzeExposure };
