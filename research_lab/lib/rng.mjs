// Deterministic seeded RNG.
//
// The autonomous lab must produce byte-identical results from the same seed so
// that (a) preregistered protocols pin exactly which data an experiment sees
// and (b) the reproducer can rerun from a clean state and get an EXACT_MATCH.
// Math.random() is forbidden anywhere in the experiment path for this reason.

// mulberry32: tiny, fast, well-distributed 32-bit PRNG.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A small stateful helper with uniform + gaussian draws, seeded once.
export function createRng(seed) {
  const next = mulberry32(seed >>> 0);
  let spare = null;
  return {
    // Uniform in [0, 1).
    uniform: next,
    // Uniform in [min, max).
    range(min, max) {
      return min + (max - min) * next();
    },
    // Standard normal via Box-Muller (cached spare for the second value).
    gaussian(mean = 0, sd = 1) {
      if (spare !== null) {
        const v = spare;
        spare = null;
        return mean + sd * v;
      }
      let u = 0;
      let v = 0;
      let s = 0;
      do {
        u = next() * 2 - 1;
        v = next() * 2 - 1;
        s = u * u + v * v;
      } while (s >= 1 || s === 0);
      const mul = Math.sqrt((-2 * Math.log(s)) / s);
      spare = v * mul;
      return mean + sd * (u * mul);
    },
  };
}
