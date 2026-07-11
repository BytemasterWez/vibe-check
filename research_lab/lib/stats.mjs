// Rare-event statistics (Packet 4).
//
// "Zero failures in a small test" is not strong evidence of a low true rate. A
// safety rate like false_confident <= 0.001 must be backed by a confidence
// BOUND, not a point estimate: 1000 trials with zero failures only bounds the
// true rate at ~3/1000 = 0.003 (rule of three), not 0. We therefore report an
// exact Clopper-Pearson one-sided upper bound and gate on that.

// Binomial CDF P(X <= k) for X ~ Bin(n, p), computed iteratively in a numerically
// stable way (terms scaled from the k=0 term). k is small for rare events.
function binomCdf(k, n, p) {
  if (p <= 0) return 1;
  if (p >= 1) return k >= n ? 1 : 0;
  const logTerm0 = n * Math.log1p(-p); // (1-p)^n
  let term = Math.exp(logTerm0);
  let cdf = term;
  for (let i = 1; i <= k; i++) {
    term *= ((n - i + 1) / i) * (p / (1 - p));
    cdf += term;
  }
  return Math.min(1, cdf);
}

// Exact Clopper-Pearson one-sided upper bound: the largest p for which observing
// <= k successes in n has probability alpha. Found by bisection (binomCdf is
// monotone decreasing in p). For k = 0 this reduces to 1 - alpha^(1/n).
export function clopperPearsonUpper(k, n, alpha = 0.05) {
  if (n <= 0) return 1;
  if (k >= n) return 1;
  if (k === 0) return 1 - Math.pow(alpha, 1 / n);
  let lo = k / n;
  let hi = 1;
  for (let iter = 0; iter < 100; iter++) {
    const mid = (lo + hi) / 2;
    // We want P(X <= k) == alpha; CDF decreases as p increases.
    if (binomCdf(k, n, mid) > alpha) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// Convenience: report a rare-event safety metric with its bound.
export function rareEventReport(count, trials, alpha = 0.05) {
  const point = trials > 0 ? count / trials : null;
  return {
    observed_count: count,
    trial_count: trials,
    point_estimate: point === null ? null : round(point),
    upper_confidence_bound: trials > 0 ? round(clopperPearsonUpper(count, trials, alpha)) : null,
    confidence_method: `clopper_pearson_one_sided_${Math.round((1 - alpha) * 100)}pct`,
  };
}

function round(x, d = 6) {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}
