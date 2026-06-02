// Statistical engine for flaky test analysis.
//
// The naive approach ("failed 2 of 5 runs = 40% flaky") is wrong in a way that
// matters: failing 2/5 and failing 200/500 are wildly different levels of
// certainty, but the naive number is identical. Serious tooling reasons about
// confidence, not raw ratios. This module does that.

const Z_95 = 1.959963984540054; // z-score for a 95% confidence interval

// Wilson score interval for a binomial proportion. Far more accurate than the
// "normal approximation" at small sample sizes (which is exactly where we live:
// 3-10 runs). Returns the lower/upper bounds on the TRUE failure rate.
function wilsonInterval(failures, total, z = Z_95) {
  if (total === 0) return { low: 0, high: 0, center: 0 };

  const p = failures / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denom;
  const margin =
    (z / denom) *
    Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));

  return {
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
    center,
  };
}

// Bayesian flake probability using a Beta(failures+1, successes+1) posterior.
// We ask: given what we observed, how likely is the TRUE failure rate to sit in
// the "genuinely flaky" band (between a floor and ceiling)? A test that always
// passes or always fails scores ~0 here; one that flips scores high.
//
// We approximate the Beta CDF by sampling — no external deps, deterministic
// enough for a CLI, and honest about being an estimate.
function bayesianFlakeProbability(failures, successes, floor = 0.05, ceiling = 0.95) {
  const a = failures + 1;
  const b = successes + 1;
  const samples = 20000;
  let inBand = 0;

  for (let i = 0; i < samples; i++) {
    const x = sampleBeta(a, b);
    if (x >= floor && x <= ceiling) inBand++;
  }
  return inBand / samples;
}

// Gamma sampler (Marsaglia & Tsang) -> Beta via X/(X+Y). Seedless; fine for our
// purposes since we report a band, not a single fragile digit.
function sampleGamma(k) {
  if (k < 1) {
    return sampleGamma(k + 1) * Math.pow(Math.random(), 1 / k);
  }
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x, v;
    do {
      x = gaussian();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function sampleBeta(a, b) {
  const x = sampleGamma(a);
  const y = sampleGamma(b);
  return x / (x + y);
}

function gaussian() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Turn the raw counts into a verdict a human can act on. Industry rule of thumb:
// healthy suites sit under ~1-2% flake rate, >5% is a real problem.
function classify(failures, total) {
  const successes = total - failures;
  const wilson = wilsonInterval(failures, total);
  const observed = total > 0 ? failures / total : 0;

  // Did we even see both outcomes? If not, it's not flaky (yet).
  const sawBoth = failures > 0 && successes > 0;

  // Flake probability is only meaningful once we've seen the test BOTH pass and
  // fail. A test that always passed (or always failed) has 0 flake confidence by
  // definition, regardless of what the Beta posterior says about the rate.
  const flakeProb = sawBoth ? bayesianFlakeProbability(failures, successes) : 0;

  // The Wilson interval width tells us if we've run enough times. A wide
  // interval = we genuinely don't know yet and should run more.
  const intervalWidth = wilson.high - wilson.low;
  const needMoreRuns = sawBoth && intervalWidth > 0.4;

  let verdict, severity;
  if (!sawBoth) {
    verdict = failures === total ? "consistently failing" : "stable";
    severity = failures === total ? "broken" : "none";
  } else if (flakeProb > 0.8) {
    verdict = "flaky (high confidence)";
    severity = wilson.center > 0.2 ? "high" : "medium";
  } else if (flakeProb > 0.5) {
    verdict = "likely flaky";
    severity = "medium";
  } else {
    verdict = "possibly flaky";
    severity = "low";
  }

  return {
    observedRate: +(observed * 100).toFixed(1),
    trueRateRange: [
      +(wilson.low * 100).toFixed(1),
      +(wilson.high * 100).toFixed(1),
    ],
    flakeConfidence: +(flakeProb * 100).toFixed(1),
    verdict,
    severity,
    needMoreRuns,
  };
}

module.exports = { wilsonInterval, bayesianFlakeProbability, classify };
