# Dopplium FMCW `.bin` format — specification (EXT-RR-BELT-001)

Status: **KNOWN parameters recorded; byte layout UNVERIFIED.** The adapter
(`lib/external/adapters/dopplium_4tu_v1.mjs`, to be written on the execution
machine) MUST refuse to decode until the UNVERIFIED fields below are established
from the **authors' own MATLAB code + byte-level invariants**, not guessed and
**not** assumed compatible with the TI DCA1000 raw format.

## Source of truth (in priority order)

1. The dataset's supplied MATLAB code (inside the participant zips / the authors'
   `Dataset-Nov-2025` examples and the Dopplium parser referenced in the README).
2. Parameters embedded in each `.bin` (the README states exact parameters are
   saved in the file and extracted by the parser).
3. Byte-level observations on ≥1 invariant recording.
4. Deterministic payload-size invariants.

## KNOWN parameters (dataset README, Table)

| Parameter | Value |
| --- | --- |
| Radar | 3× Dopplium unit = TI IWR6843ISK + DCA1000EVM |
| Mode | FDMA; start freqs 60 / 61.25 / 62.5 GHz |
| Bandwidth | 1 GHz | 
| Frequency slope | 25 MHz/µs |
| ADC samples / chirp | 80 |
| Chirps / frame | 120 |
| Frame periodicity | 100 ms → **10 Hz slow-time** |
| Active TX / RX | 3 / 4 (→ up to 12 virtual channels) |
| Range resolution | 0.15 m; max range 11.99 m |
| Note | Participant 1 used slightly different parameters; **read per-file embedded params, do not hardcode** |

## UNVERIFIED — must be derived before the adapter may decode

- Header presence, size, and structure; where embedded parameters live.
- Endianness and numeric representation (int16 vs other).
- I/Q construction and lane interleave (do **not** assume DCA1000's
  4-int16→2-complex rule; verify against the authors' code).
- Frame / chirp / sample / channel ordering.
- Timestamp representation (if any).
- Trailing / optional sections.
- The exact **payload-size formula** as a function of the embedded params.

## Adapter contract (enforced)

1. Parse embedded parameters from the file per the authors' code.
2. Compute expected payload size from those params; **refuse** (`ADAPTER_INVALID`)
   if the file size does not match to the byte.
3. Reconstruct complex samples exactly as the authors' code does.
4. Emit a normalized observation (per-radar range-bin phase/displacement) with
   every transform declared and the normalized bytes hashed.
5. Cross-check against the authors' MATLAB intermediate structures (frame/chirp/
   sample/channel counts, radar config, duration, representative complex samples,
   range-FFT dimensions) within recorded numerical tolerances **before** the
   adapter is declared valid. A plausible-looking respiratory waveform is **not**
   sufficient evidence of correctness.

Until steps 1–5 pass on the execution machine, the adapter must return
`ADAPTER_INVALID` / `UNSUPPORTED_ENCODING` and no external maturity may be
claimed.
