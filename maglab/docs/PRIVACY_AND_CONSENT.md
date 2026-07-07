# MagLab Privacy and Consent

Privacy is built in from day one, not bolted on. The defaults below are
product requirements enforced in code, not aspirations.

## The defaults

- **Every survey is private and local-only by default.** `private_local_only`
  is the initial share setting on every new survey.
- **No hidden uploads.** Data leaves the device only when the user picks a
  sharing mode on the survey AND enables upload in Settings (Phase 7/8).
  Private local-only surveys are never uploaded under any circumstances —
  the sync client refuses them and the backend rejects them.
- **No accounts.** Contributors are pseudonymous: a contributor ID, an
  optional display pseudonym, and an API token. No email/password in v1.

## What data is collected

While a survey is recording (and only then): GPS position and accuracy,
magnetometer readings, accelerometer/gyroscope/attitude, barometric
pressure and relative altitude, timestamps, plus the operator's own notes
and markers. Derived per-sample scores (baseline, residual, anomaly score,
confidence, quality flags) are computed on device.

## Why it is collected

To map repeatable local magnetic anomalies and build a labelled,
quality-scored field dataset. Location is essential: an anomaly without a
position and a repeat visit is noise.

## How location is used

- Captured only during an active recording, with iOS "when in use"
  permission.
- Stored locally with the survey.
- Shared only under an explicit share setting:
  - **Share anonymised survey** — reduced-precision GPS, pseudonymous ID.
  - **Share full survey with precise GPS** — full precision; the app states
    explicitly that research-grade surveys need precise GPS and that this
    reveals exactly where you walked.
  - **Research contributor mode** — full precision plus contributor
    metadata for repeat-run coordination.

## How uploads work (Phase 7/8)

Uploads are batched, token-authenticated, retried on failure, and
deduplicated by UUID. Each upload carries contributor_id, app_version,
device_model, consent_version and share_precision so consent is auditable
per survey. Upload modes: never / manual only / Wi-Fi only / after every
completed survey. "Never upload" is the initial mode.

## How users opt out and delete data

- Opt out by doing nothing: local-only is the default.
- Any local survey can be deleted on device at any time (swipe to delete);
  deletion removes runs, samples, markers and anomaly events.
- Contributors can request deletion of uploaded data; the admin API
  supports deleting all data for a contributor ID.

## What MagLab will never do

- No covert tracking of any kind.
- No Wi-Fi probe-request logging in the iPhone app (iOS does not permit
  raw probe sniffing, and MagLab would not do it anyway). Any future
  external footfall sensor must be consent-only, site-authorised,
  anonymised and legally reviewed before prototyping.
- No smart-speaker acoustic echo logging. Not part of this product.
- No sale of individual location traces.

## Limitations and safety warnings

MagLab is an experimental citizen-science tool. Results are not
professional geophysical surveys and must not be used for excavation,
safety decisions, utility detection, navigation or mineral claims.
Magnetic readings are easily distorted by everyday metal and
infrastructure; a single spike is not proof; repeatability matters; test
known controls first.

## Consent versioning

The active consent text carries a version (starting `consent-v1`). Every
uploaded survey records the consent version the contributor accepted.
Material changes to this document bump the version and require re-consent
before further uploads.
