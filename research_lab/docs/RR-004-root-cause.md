# RR-004 root-cause analysis — second-person misattribution

`CLM-RR-004` ("a second independently moving subject causes abstention rather
than misattribution in ≥95% of trials") was **falsified** at the v0.3.0
milestone: the `robust_ensemble_v1` candidate misattributed on the biomechanical
intruder world (false-confident rate ≈ 0.10 > 0.05) despite passing the
sinusoidal and nonstationary intruder worlds. This document classifies why, and
what the correct fix is.

## Evidence (instrumented failing cases)

On the failing trials the two ensemble members agreed confidently on a rate that
was 8–17 breaths/min from the subject's true rate. Measured on those trials:

- cross-channel dominant-frequency delta: **0** (both spatial channels reported
  the same dominant rhythm);
- single-channel secondary-peak ratio: **0.30–0.49** (below a naive
  "two components" threshold);
- the intruder was a near-pure tone while the biomechanical subject spreads its
  energy across harmonics — so the intruder's single peak could **exceed the
  subject's fundamental**, and both members locked onto it.

## Classification (answering the review's questions)

| Question | Finding |
| --- | --- |
| Did both estimators lock onto the same wrong subject? | **Yes** — the spectrally-dominant intruder. |
| Did one fail while the other dominated? | **No** — both consume the *same mixed channel*; the ensemble's agreement rule then confirms the shared error. |
| Did agreement occur at a harmonic? | **Sometimes**, on the biomechanical world: harmonic-rich subject energy lets the intruder's pure tone win the peak. |
| Was confidence miscalibrated? | **Yes** — "two independent methods agree" was read as confidence on a signal that is not attributable to one target. |
| Was the signal-quality score blind to multi-target ambiguity? | **Yes** — single-channel SQI cannot distinguish a harmonic from a second source. |
| Did the biomechanical world expose information missing from the estimator? | **Yes** — it showed that single-channel component counting is unreliable, so spatial information is required. |

## The core lesson

**Mathematical independence is not informational independence.** FFT-peak and
autocorrelation are algorithmically different, but on the *same mixed input* they
observe the same dominant component and can agree confidently on the wrong
source. Agreement between methods that share their input is not corroboration.

## The fix — observational independence, not a better rate estimator

Per the review, the correct response is a separate upstream check, not more
respiration-estimation cleverness. `robust_ensemble_v2` adds:

```
IMU-cancel both channels
  -> multi-target ambiguity gate (observational independence)
     -> algorithmically-independent members must commit AND agree
        -> abstain otherwise
```

The ambiguity gate uses a **second spatial channel** (a different range
bin/antenna). A single source is a scaled copy across channels (spectral
correlation ≈ 0.9997); two sources that mix into the channels with different
weights change the spectral *shape* (correlation drops well below 0.97). Measured
outcome of v2 vs v1:

| Case | v1 false-confident | v2 false-confident |
| --- | --- | --- |
| clean (all worlds) | 0 | 0 (coverage unchanged) |
| apparatus motion | 0 | 0 (motion removed by IMU-cancel; not mistaken for a target) |
| **distinct-range intruder (all worlds incl. biomechanical)** | up to **0.20** | **0** (abstains) |
| co-located intruder (similar range) | ~0.10 | ~0.09 (still leaks) |

`CLM-RR-004B` captures the resolved regime (distinct-range intruder) and passes
with v2; it fails with v1 — a concrete demonstration that the improvement is
observational, not algorithmic.

## Documented residual — the honest limit

A second person at a **similar range** mixes into both channels almost
identically (cross-channel correlation stays > 0.97), so two channels cannot
separate them. This is not a software-fixable defect: it requires richer
observational independence — more antennas, range-Doppler, or explicit
source separation. The laboratory should therefore raise **`NEEDS_NEW_SIMULATOR`**
for a spatial-array / range-Doppler world before any claim about co-located
intruders can be advanced, and ultimately **`NEEDS_HARDWARE`** to confirm the
spatial separability that real apparatus provides. Two agreeing methods on one
mixed signal will never resolve it.
