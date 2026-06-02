# Flaky Test Detector 🔍

**Local-first flaky-test analysis. Your test data never leaves your machine.**

Finds the tests that pass sometimes and fail others, tells you *how confident* it
is, *why* they're failing, and *when* they started — without uploading a single
stack trace to anyone's cloud.

---

## Why this exists

Every other flaky-test tool (BuildPulse, Trunk, Datadog, CircleCI Insights) is
cloud SaaS: you ship your test logs to their servers. For teams under SOC2,
air-gapped, or data-residency rules, that's a non-starter. This runs entirely on
your own machine/CI — **no network calls, no telemetry, no upload.**

It also does the analysis a "rerun it 5 times" script can't:

| | This tool | A weekend script |
|---|---|---|
| Detect flaky tests | ✅ | ✅ |
| Statistical confidence (Wilson + Bayesian) | ✅ | ❌ |
| Knows when it hasn't run enough to be sure | ✅ | ❌ |
| Failure fingerprinting (1 bug vs. 3) | ✅ | ❌ |
| Root-cause category + suggested fix | ✅ | ❌ |
| Per-commit history ("when did it start?") | ✅ | ❌ |
| Quarantine manifest (owner + deadline) | ✅ | ❌ |
| Data stays local | ✅ | n/a |

## Install

No install needed — run it directly with npx:

```bash
npx flaky-test-detector "npm test"
```

Or install it globally to get the `flaky-detector` command:

```bash
npm install -g flaky-test-detector
flaky-detector "npm test"
```

## Use

```bash
# point it at however you run tests
flaky-detector "npm test"
flaky-detector "pytest tests/"
flaky-detector "go test ./..."
flaky-detector "jest --watch=false"

# also update the quarantine manifest for medium/high-severity flakes
flaky-detector --quarantine "npm test"

# CI mode: only HIGH-severity flakes fail the build
flaky-detector --ci "npm test"

# Slack/webhook alert when flakes appear (names + counts only, never traces)
SLACK_WEBHOOK_URL=https://hooks.slack.com/... flaky-detector "npm test"
# preview EXACTLY what would be sent, without sending it:
flaky-detector --dry-run-notify "npm test"

# visual dashboard from your local history
npm run report

# EXACT per-test results — point it at your framework's JUnit XML report
# (pytest --junitxml=results.xml, jest-junit, go-junit-report, etc.)
node index.js --junit=results.xml "pytest --junitxml=results.xml"
```

### Two reading modes

- **stdout (default):** scrapes console output. Zero setup, works anywhere, but
  per-test attribution is best-effort.
- **`--junit=<file>` (recommended):** reads the standard JUnit XML your test
  runner can emit. Exact per-test pass/fail and each test's *own* failure text,
  so root-cause categories are accurate. Works with every major framework.

## What you get

```
● HIGH  Test 4: syncs with payment provider
   verdict     : flaky (high confidence)
   failed      : 6/8 runs (observed 75%, true rate likely 40.9–92.9%)
   confidence  : 99.2% this is genuinely flaky
   root cause  : Network / external dependency
   → Mock the external call or add bounded retries. A test that hits a real
     network is flaky by construction.
```

Plus a per-commit history (`.flaky-detector-data/history.json`), a quarantine
manifest, and an offline HTML dashboard.

## How it decides ("flaky" isn't a coin flip)

- **Wilson score interval** — proper confidence bounds on the true failure rate,
  accurate at the tiny sample sizes we live in (3–8 runs).
- **Bayesian flake probability** — Beta-posterior estimate of how likely the test
  is *genuinely* flaky vs. just unlucky, so 2/5 and 200/500 aren't treated alike.
- **Adaptive runs** — keeps running (up to 8) only while a verdict is still
  statistically ambiguous, then stops.
- **Fingerprinting** — normalizes failure output and hashes it, so it can warn
  when a "flaky" test is actually failing several *different* ways.

## Honest limitations

- Per-test attribution is scraped from stdout; rock-solid attribution needs
  JUnit-XML/JSON reporter ingestion (the #1 roadmap item).
- Root-cause categories are heuristics, not ML — good signposts, not proof.
- History is per-checkout today; a self-hosted team aggregator is planned.

## Files

| File | Role |
|---|---|
| `index.js` | CLI |
| `detector.js` | orchestration: run, parse, tally, persist, quarantine, trends |
| `stats.js` | Wilson interval + Bayesian flake probability |
| `fingerprint.js` | failure normalization, hashing, root-cause categories |
| `junit.js` | JUnit-XML reader for exact per-test results |
| `notify.js` | Slack/webhook alerts (names + counts only) |
| `git.js` | per-commit tagging |
| `ci/` | copy-paste GitHub Actions / GitLab / Jenkins recipes |
| `report.js` | offline HTML dashboard |

## License

MIT — free to use, modify, and distribute. See [LICENSE](LICENSE).
