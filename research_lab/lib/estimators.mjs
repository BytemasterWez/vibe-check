// Estimators — candidate and baseline respiratory-rate algorithms.
//
// An estimator receives only the readable channels (displacement, imu), the
// sample rate, and the respiratory search band. It NEVER receives ground truth
// or the applied-perturbation list. It must return an estimate AND decide
// whether to abstain: abstention is a first-class output, not a failure.
//
//   estimate(input) -> { abstained, rr_bpm|null, sqi, band_peak_hz }
//
// SQI (signal-quality index) is the ratio of the dominant band peak's power to
// the median band power; a flat/ambiguous spectrum yields a low SQI. Estimators
// abstain when SQI falls below sqi_min.

const RESP_BAND_HZ = [0.1, 0.7]; // ~6-42 breaths/min

function mean(a) {
  let s = 0;
  for (const x of a) s += x;
  return s / a.length;
}

function detrend(x) {
  const m = mean(x);
  return x.map((v) => v - m);
}

// Band-limited periodogram evaluated on a fixed frequency grid. Returns the
// power at each candidate frequency (a Goertzel-style DFT, O(bins * n)) — cheap
// and fully deterministic, no FFT padding games.
function bandPeriodogram(x, fs, band = RESP_BAND_HZ, bins = 120) {
  const n = x.length;
  const [lo, hi] = band;
  const freqs = new Array(bins);
  const power = new Array(bins);
  for (let b = 0; b < bins; b++) {
    const f = lo + ((hi - lo) * b) / (bins - 1);
    freqs[b] = f;
    const w = (2 * Math.PI * f) / fs;
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      re += x[i] * Math.cos(w * i);
      im -= x[i] * Math.sin(w * i);
    }
    power[b] = (re * re + im * im) / (n * n);
  }
  return { freqs, power };
}

function median(a) {
  const s = a.slice().sort((p, q) => p - q);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Analyze the band spectrum: dominant peak strength (SQI, peak vs median) and
// ambiguity (a competing peak at a distinct frequency vs the dominant one).
// Ambiguity is what lets an estimator notice a second breather or uncancelled
// device motion and abstain instead of confidently picking one of two rhythms.
function analyzeSpectrum(freqs, power, minSepHz = 0.03) {
  let top = 0;
  for (let i = 1; i < power.length; i++) if (power[i] > power[top]) top = i;
  let second = -1;
  for (let i = 0; i < power.length; i++) {
    if (Math.abs(freqs[i] - freqs[top]) <= minSepHz) continue;
    if (second < 0 || power[i] > power[second]) second = i;
  }
  const med = median(power) || 1e-12;
  const topPower = power[top] || 1e-12;
  return {
    f: freqs[top],
    power: topPower,
    sqi: topPower / med,
    ambiguity: second >= 0 ? power[second] / topPower : 0,
  };
}

// Fraction of samples that are exactly zero — a proxy for dropout coverage that
// an estimator is allowed to see (it is in the signal, not the hidden truth).
function zeroFraction(x) {
  let z = 0;
  for (const v of x) if (v === 0) z++;
  return z / x.length;
}

// Baseline: detrend, take the band periodogram peak, convert to bpm, abstain on
// low SQI or heavy dropout. No motion handling.
export function bandpass_peak_v1(input, params = {}) {
  const sqiMin = params.sqi_min ?? 6;
  const ambMax = params.ambiguity_max ?? 0.5;
  const x = detrend(input.channels.displacement);
  const { freqs, power } = bandPeriodogram(x, input.fs_hz);
  const peak = analyzeSpectrum(freqs, power);
  const dropout = zeroFraction(input.channels.displacement);
  const abstained = peak.sqi < sqiMin || peak.ambiguity > ambMax || dropout > 0.35;
  return {
    estimator: 'bandpass_peak_v1',
    abstained,
    rr_bpm: abstained ? null : peak.f * 60,
    sqi: peak.sqi,
    ambiguity: peak.ambiguity,
    band_peak_hz: peak.f,
    dropout,
  };
}

// Candidate: project the IMU out of the displacement channel first (adaptive
// least-squares motion cancellation), then run the same spectral peak. This
// removes IMU-observable device/gross motion so the true respiratory peak wins;
// motion that is NOT on the IMU (a second person) still corrupts the spectrum,
// which correctly shows up as a lower SQI and, when ambiguous, abstention.
export function adaptive_motion_cancellation_v2(input, params = {}) {
  const sqiMin = params.sqi_min ?? 6;
  const d = detrend(input.channels.displacement);
  const m = detrend(input.channels.imu);

  // Least-squares gain g minimizing ||d - g*m||; subtract the motion estimate.
  let mm = 0;
  let dm = 0;
  for (let i = 0; i < d.length; i++) {
    mm += m[i] * m[i];
    dm += d[i] * m[i];
  }
  const g = mm > 1e-9 ? dm / mm : 0;
  const cleaned = d.map((v, i) => v - g * m[i]);

  const ambMax = params.ambiguity_max ?? 0.5;
  const { freqs, power } = bandPeriodogram(cleaned, input.fs_hz);
  const peak = analyzeSpectrum(freqs, power);
  const dropout = zeroFraction(input.channels.displacement);
  const abstained = peak.sqi < sqiMin || peak.ambiguity > ambMax || dropout > 0.35;
  return {
    estimator: 'adaptive_motion_cancellation_v2',
    abstained,
    rr_bpm: abstained ? null : peak.f * 60,
    sqi: peak.sqi,
    ambiguity: peak.ambiguity,
    band_peak_hz: peak.f,
    motion_gain: g,
    dropout,
  };
}

export const ESTIMATORS = {
  bandpass_peak_v1,
  adaptive_motion_cancellation_v2,
};

export function runEstimator(name, input, params) {
  const fn = ESTIMATORS[name];
  if (!fn) throw new Error(`unknown estimator: ${name}`);
  // Hand the estimator ONLY readable channels — strip ground truth defensively.
  const safeInput = {
    channels: input.channels,
    fs_hz: input.fs_hz,
    duration_s: input.duration_s,
  };
  return fn(safeInput, params);
}
