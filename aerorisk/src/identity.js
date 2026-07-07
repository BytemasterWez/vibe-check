// Module 1 — Aircraft identity graph.
// Establish the aircraft identity before scoring anything. Bad entity
// resolution ruins the whole product, so every downstream module receives the
// resolved registry record plus an explicit identity-confidence rating.

// US registration marks: "N" + 1-5 digits, or digits followed by one or two
// suffix letters. Letters I and O are never assigned (they read as 1 and 0).
const N_NUMBER_RE = /^N(?:[1-9]\d{0,4}|[1-9]\d{0,3}[A-HJ-NP-Z]|[1-9]\d{0,2}[A-HJ-NP-Z]{2})$/;

export function normalizeNNumber(raw) {
  let n = (raw ?? '').toUpperCase().replace(/[\s-]/g, '');
  if (n && !n.startsWith('N')) n = `N${n}`;
  return n;
}

export function isValidNNumber(raw) {
  return N_NUMBER_RE.test(normalizeNNumber(raw));
}

export function resolveIdentity(store, rawNNumber) {
  const nNumber = normalizeNNumber(rawNNumber);
  const valid = isValidNNumber(nNumber);
  const registry = valid ? store.registryByNNumber(nNumber) : null;

  const issues = [];
  if (!valid) issues.push(`"${rawNNumber}" is not a valid US registration mark.`);
  if (valid && !registry) {
    issues.push(`No registry record for ${nNumber} in the loaded dataset.`);
  }
  if (registry) {
    if (!registry.SERIAL_NUMBER) issues.push('Registry record is missing a serial number.');
    if ((registry.STATUS ?? '').toUpperCase() !== 'VALID') {
      issues.push(`Registration status is "${registry.STATUS}", not Valid.`);
    }
    if (registry.EXPIRATION_DATE && registry.EXPIRATION_DATE < todayIso()) {
      issues.push(`Registration expired ${registry.EXPIRATION_DATE}.`);
    }
    if (!registry.MODE_S_HEX) issues.push('No Mode S (ICAO hex) code on file.');
  }

  let confidence = 'high';
  if (!registry) confidence = 'none';
  else if (issues.length >= 2) confidence = 'low';
  else if (issues.length === 1) confidence = 'medium';

  return { nNumber, valid, registry, issues, confidence };
}

export function todayIso(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function daysBetween(isoA, isoB) {
  const a = Date.parse(isoA);
  const b = Date.parse(isoB);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

export function daysAgo(iso, now = new Date()) {
  return daysBetween(iso, todayIso(now));
}
