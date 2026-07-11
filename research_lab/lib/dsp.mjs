// Shared signal helpers used by the estimator registry. Kept separate so that
// structurally different estimators (spectral, autocorrelation, template) can
// share only primitive DSP and NOT share modelling assumptions — the point of
// the estimator registry is independence, so anything opinionated lives in the
// estimator, not here.

export function mean(a) {
  let s = 0;
  for (const x of a) s += x;
  return s / a.length;
}

export function detrend(x) {
  const m = mean(x);
  return x.map((v) => v - m);
}

export function median(a) {
  if (!a.length) return 0;
  const s = a.slice().sort((p, q) => p - q);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function zeroFraction(x) {
  let z = 0;
  for (const v of x) if (v === 0) z++;
  return z / x.length;
}

// Band-limited periodogram on a fixed frequency grid (Goertzel-style DFT).
export function bandPeriodogram(x, fs, band = [0.1, 0.7], bins = 120) {
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

// Dominant-peak strength (SQI) and competing-peak ambiguity from a spectrum.
export function analyzeSpectrum(freqs, power, minSepHz = 0.03) {
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

// High-pass by subtracting a centered moving average (O(n) via prefix sums).
// Removes slow baseline wander below ~fs/window Hz so time-domain periodicity
// methods see the respiratory oscillation rather than a slow ramp.
export function highpass(x, window) {
  const n = x.length;
  const w = Math.max(3, Math.min(window | 0, n));
  const half = Math.floor(w / 2);
  const prefix = new Array(n + 1);
  prefix[0] = 0;
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + x[i];
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n, i + half + 1);
    const ma = (prefix[hi] - prefix[lo]) / (hi - lo);
    out[i] = x[i] - ma;
  }
  return out;
}

// Biased autocorrelation at integer lags, normalized so lag 0 == 1.
export function autocorr(x, maxLag) {
  const n = x.length;
  const r = new Array(maxLag + 1).fill(0);
  let r0 = 0;
  for (let i = 0; i < n; i++) r0 += x[i] * x[i];
  r0 = r0 || 1e-12;
  for (let lag = 0; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += x[i] * x[i + lag];
    r[lag] = s / r0;
  }
  return r;
}
