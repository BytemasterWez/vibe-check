// Concrete external adapter — Mendeley Data 10.17632/684v4r8wfr.1 (v1).
//
// "FMCW radar-based multi-person vital sign monitoring data" (Lei, Cheng, Yin,
// Wu; CC BY 4.0). Decodes the raw TI IWR6843/DCA1000 ADC .bin exactly as the
// authors' readDCA1000.m specifies, and parses the paired reference CSVs. Every
// transformation is declared; the reference is parsed ONLY into scorer-owned
// truth, never into estimator input.
//
// Frozen radar parameters (dataset DataSetDescription&ParametersSetting.pdf,
// Table 2, and read_log.m / Main.m in RadarDataProcessing.zip):
//   ADC samples/chirp = 200, ADC rate = 4 Msps, RX = 4, TX = 3 (TDM),
//   chirp/frame = 1, frame period = 50 ms (=> 20 Hz slow-time), 1200 frames,
//   int16 complex IQ, 2 lanes, pairing per readDCA1000 (groups of 4 -> 2 complex).
//
// IMPORTANT — reference modality: the validation CSVs contain ECG and PCG
// (cardiac) channels, NOT a respiratory belt/capnography trace. Respiratory
// truth is therefore NOT directly present; deriving it (ECG-derived respiration)
// is an undocumented, tunable transform this crossing must not improvise. The
// adapter records the reference as cardiac and leaves respiratory rate null, so
// the evaluator returns REFERENCE_UNUSABLE for respiratory-rate claims.

import fs from 'fs';
import { sha256 } from '../../hash.mjs';
import { detrend, bandPeriodogram, analyzeSpectrum } from '../../dsp.mjs';

export const ADAPTER_NAME = 'mendeley_684v4r8wfr_v1';
export const ADAPTER_VERSION = '1.0.0';

export const RADAR = {
  adc_samples: 200,
  adc_rate_hz: 4e6,
  num_rx: 4,
  num_tx: 3,
  frame_period_s: 0.05,
  frame_rate_hz: 20,
  num_frames: 1200,
  range_fft: 256,
};

// Declared transform pipeline (recorded verbatim in the manifest).
export const TRANSFORMS = [
  { op: 'read_int16', params: { dtype: 'int16', endian: 'little' } },
  { op: 'deinterleave_iq', params: { rule: 'readDCA1000: groups of 4 -> 2 complex (I0+jQ2, I1+jQ3)' } },
  { op: 'reshape_frames', params: { per_chirp: 'adc_samples*num_rx', chirp_stride: 'num_tx (TDM, 1 chirp/frame used)' } },
  { op: 'range_fft', params: { n: 256, window: 'hann', keep: 'first_half' } },
  { op: 'mti_slowtime_mean_cancel', params: {} },
  { op: 'select_dominant_range_bin', params: { search: 'bins 3..59 by summed magnitude' } },
  { op: 'phase_slowtime', params: { channels: ['antenna0->displacement', 'antenna_maxspacing->displacement_b'] } },
];

function fft(re, im) {
  // Iterative radix-2 FFT; inputs zero-padded to a power of two by the caller.
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

// Decode raw ADC .bin -> per-antenna range-bin phase slow-time (2 channels),
// following readDCA1000.m. Deterministic and pure.
export function decodeBin(buffer, opts = {}) {
  const N = RADAR.adc_samples;
  const numRX = RADAR.num_rx;
  const int16 = new Int16Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.byteLength / 2));
  const total = int16.length;
  // Complex stream per readDCA1000: c0=a[k]+j*a[k+2], c1=a[k+1]+j*a[k+3].
  const nComplex = Math.floor(total / 2);
  const cr = new Float64Array(nComplex);
  const ci = new Float64Array(nComplex);
  for (let k = 0, c = 0; k + 3 < total; k += 4, c += 2) {
    cr[c] = int16[k];
    ci[c] = int16[k + 2];
    cr[c + 1] = int16[k + 1];
    ci[c + 1] = int16[k + 3];
  }
  const perChirp = N * numRX;
  const numChirps = Math.floor(nComplex / perChirp);
  // Range profile per frame for two antennas; one chirp per num_tx frames.
  const fftN = RADAR.range_fft;
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));

  function antennaSeries(ant) {
    const frames = [];
    for (let ch = 0; ch < numChirps; ch += RADAR.num_tx) {
      const base = ch * perChirp + ant * N;
      const re = new Float64Array(fftN);
      const im = new Float64Array(fftN);
      for (let i = 0; i < N; i++) {
        re[i] = cr[base + i] * win[i];
        im[i] = ci[base + i] * win[i];
      }
      fft(re, im);
      const half = fftN / 2;
      const mag = new Float64Array(half);
      const ph = new Float64Array(half);
      for (let b = 0; b < half; b++) {
        mag[b] = Math.hypot(re[b], im[b]);
        ph[b] = Math.atan2(im[b], re[b]);
      }
      frames.push({ mag, ph });
    }
    return frames;
  }

  // Antenna 0 and the max-spacing antenna (RX index numRX-1) as two spatial views.
  const a0 = antennaSeries(0);
  const a1 = antennaSeries(numRX - 1);
  const nf = a0.length;
  const half = fftN / 2;
  // Slow-time mean-cancel per range bin, pick dominant bin from antenna 0.
  const power = new Float64Array(half);
  for (let f = 0; f < nf; f++) for (let b = 3; b < 60; b++) power[b] += a0[f].mag[b];
  let tb = 3;
  for (let b = 4; b < 60; b++) if (power[b] > power[tb]) tb = b;

  const displacement = new Array(nf);
  const displacement_b = new Array(nf);
  let m0 = 0;
  let m1 = 0;
  for (let f = 0; f < nf; f++) {
    displacement[f] = a0[f].ph[tb];
    displacement_b[f] = a1[f].ph[tb];
    m0 += displacement[f];
    m1 += displacement_b[f];
  }
  m0 /= nf;
  m1 /= nf;
  for (let f = 0; f < nf; f++) {
    displacement[f] -= m0;
    displacement_b[f] -= m1;
  }
  return { displacement, displacement_b, frames: nf, range_bin: tb, fs_hz: RADAR.frame_rate_hz };
}

// Parse a reference CSV (Column1,Column2 / ECG,PCG). Returns channel arrays and
// a classification. This output is TRUTH — it must never reach estimator input.
export function parseReferenceCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  const header = lines.slice(0, 2).join(' | ');
  const labels = (lines[1] || '').split(',').map((s) => s.trim().toUpperCase());
  const ecg = [];
  const pcg = [];
  for (let i = 2; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 2) continue;
    const a = Number(p[0]);
    const b = Number(p[1]);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      ecg.push(a);
      pcg.push(b);
    }
  }
  const fs = ecg.length / 60; // recordings are 60 s
  // Respiratory-band energy fraction: is a direct respiration trace present?
  const respFraction = (x) => {
    const dx = detrend(x);
    // reuse the respiratory-band periodogram; compare band energy to total.
    const { power } = bandPeriodogram(dx, fs, [0.1, 0.7], 60);
    const bandE = power.reduce((s, v) => s + v, 0);
    const { power: full } = bandPeriodogram(dx, fs, [0.05, 3.0], 200);
    const fullE = full.reduce((s, v) => s + v, 0) || 1e-12;
    return bandE / fullE;
  };
  return {
    header,
    labels,
    fs_hz: fs,
    n: ecg.length,
    channels_present: labels,
    respiratory_channel_present: labels.some((l) => /RESP|BELT|CAPN|RIP/.test(l)),
    ecg_resp_band_fraction: round(respFraction(ecg)),
    pcg_resp_band_fraction: round(respFraction(pcg)),
  };
}

// Ingest one recording (radar .bin + two reference CSVs) into a hash-bound
// evidence object with declared transforms. Reference goes to truth only.
export function ingestRecording({ binPath, csvTarget1Path, csvTarget2Path, meta = {} }) {
  const raw = fs.readFileSync(binPath);
  const decoded = decodeBin(raw);
  const ref1 = parseReferenceCsv(fs.readFileSync(csvTarget1Path, 'utf-8'));
  const ref2 = parseReferenceCsv(fs.readFileSync(csvTarget2Path, 'utf-8'));

  const input = {
    channels: { displacement: decoded.displacement, displacement_b: decoded.displacement_b },
    fs_hz: decoded.fs_hz,
  };
  const manifest = {
    evidence_id: meta.evidence_id || 'EXT-RR-MULTI-001',
    source: 'FMCW radar-based multi-person vital sign monitoring data',
    dataset_version: '1',
    source_reference: 'doi:10.17632/684v4r8wfr.1',
    doi: '10.17632/684v4r8wfr.1',
    license: 'CC BY 4.0',
    acquisition_device: 'TI IWR6843ISK + DCA1000EVM (60 GHz FMCW)',
    sampling_rate_hz: RADAR.frame_rate_hz,
    signal_type: 'mmwave_displacement',
    // The reference is cardiac (ECG/PCG), NOT respiratory — recorded honestly.
    reference_method: 'ecg_pcg_cardiac_ads1292r',
    reference_channels: ref1.channels_present,
    reference_has_respiratory_trace: ref1.respiratory_channel_present,
    subject_count: 2,
    recording_duration_s: 60,
    label_origin: 'ads1292r_biopotential_frontend',
    units: 'radians (unwrapped range-bin phase)',
    provenance_class: 'external_public',
    transformations: TRANSFORMS,
    missing_values: 0,
    recording_id: meta.recording_id || null,
    position: meta.position || null,
    bandwidth: meta.bandwidth || null,
    raw_hash: sha256(Array.from(new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2)))),
    range_bin: decoded.range_bin,
  };
  manifest.normalized_hash = sha256(input);

  return {
    manifest,
    input,
    // TRUTH: cardiac reference only. No respiratory rate is available, so
    // true_rr_bpm is null -> the evaluator returns REFERENCE_UNUSABLE.
    truth: {
      true_rr_bpm: null,
      reference_method: 'ecg_pcg_cardiac_ads1292r',
      target1: ref1,
      target2: ref2,
    },
    subjects: meta.subjects || [],
    raw,
  };
}

function round(x, d = 4) {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}
