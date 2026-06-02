#!/usr/bin/env node

const FlakyTestDetector = require("./detector");
const { notify } = require("./notify");

// --- arg parsing -----------------------------------------------------------
const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (const a of args) {
  if (a.startsWith("--")) {
    const [k, v] = a.slice(2).split("=");
    flags[k] = v === undefined ? true : v;
  } else positional.push(a);
}
// `flaky-detector report` — build the offline HTML dashboard from local history.
if (positional[0] === "report") {
  require("./report"); // self-executing: reads .flaky-detector-data, writes report.html
  return;
}

const testCommand = positional.join(" ") || "npm test";
const quarantine = !!flags.quarantine;
const ciMode = !!flags.ci; // exit non-zero only on high-severity flakes
const junitPath = typeof flags.junit === "string" ? flags.junit : null;
// Alerts: --webhook=<url>, or the SLACK_WEBHOOK_URL env var. --dry-run-notify
// prints exactly what WOULD be sent without sending it.
const webhook = (typeof flags.webhook === "string" && flags.webhook) || process.env.SLACK_WEBHOOK_URL || null;
const dryRunNotify = !!flags["dry-run-notify"];

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

const sev = {
  high: C.red("● HIGH"),
  medium: C.yellow("● MEDIUM"),
  low: C.dim("● LOW"),
};

console.log(C.bold("\n🔍 Flaky Test Detector") + C.dim("  · local-first, no data leaves this machine"));
console.log(C.dim(`   $ ${testCommand}`));
console.log(
  C.dim(`   mode: ${junitPath ? `JUnit XML (${junitPath}) — exact per-test results` : "stdout scraping — best-effort (pass --junit=<file> for exact)"}\n`));

const detector = new FlakyTestDetector(testCommand, { initialRuns: 3, maxRuns: 8, junitPath });

if (detector.git.available) {
  console.log(
    C.dim(`   commit ${detector.git.shortSha} on ${detector.git.branch}` +
      (detector.git.dirty ? " (uncommitted changes)" : "")));
}

const report = detector.detect((run, max) => {
  process.stdout.write(C.dim(`   run ${run}/${max} …\r`));
});
console.log(" ".repeat(40) + "\r"); // clear progress line

// --- summary ---------------------------------------------------------------
const s = report.summary;
const healthColor = { healthy: C.green, watch: C.yellow, problem: C.red }[s.health] || C.dim;
console.log(C.bold("📊 Summary"));
console.log(`   Runs executed : ${report.metadata.totalRuns}`);
console.log(`   Tests seen    : ${s.totalTests}`);
console.log(`   Flaky tests   : ${s.flakyTestsFound}  (${s.flakyRatePct}% of suite)`);
console.log(`   Suite health  : ${healthColor(s.health.toUpperCase())}`);
console.log(C.dim(`   ${report.metadata.totalDurationMs}ms total\n`));

// --- flaky detail ----------------------------------------------------------
if (s.flakyTestsFound === 0) {
  console.log(C.green("✅ No flaky tests detected in this window.\n"));
} else {
  for (const t of report.flakyTests) {
    console.log(`${sev[t.severity] || ""}  ${C.bold(t.name)}`);
    console.log(`   verdict     : ${t.verdict}`);
    console.log(
      `   failed      : ${t.failed}/${t.runs} runs ` +
        C.dim(`(observed ${t.observedRate}%, true rate likely ${t.trueRateRange[0]}–${t.trueRateRange[1]}%)`));
    console.log(`   confidence  : ${t.flakeConfidence}% this is genuinely flaky` +
      (t.needMoreRuns ? C.yellow("  ⚠ run more to narrow") : ""));
    console.log(`   root cause  : ${C.cyan(t.category)}` +
      (t.distinctFailureModes > 1 ? C.yellow(`  (⚠ ${t.distinctFailureModes} distinct failure modes — not one bug)`) : ""));
    console.log(`   ${C.dim("→ " + t.suggestedFix)}`);
    if (t.sampleFailure) {
      console.log(C.dim("   ┌ sample failure"));
      for (const line of t.sampleFailure.split("\n")) console.log(C.dim("   │ " + line));
      console.log(C.dim("   └"));
    }
    console.log();
  }
}

// --- trends ----------------------------------------------------------------
const trend = detector.trends();
if (trend) {
  const arrow = { improving: C.green("↑ improving"), regressing: C.red("↓ regressing"), stable: C.dim("→ stable") }[trend.direction];
  console.log(C.bold("📈 Trend ") + `(vs your recent history): ${arrow}`);
  console.log(C.dim(`   ${trend.previousRatePct}% → ${trend.recentRatePct}% flaky rate\n`));
}

// --- quarantine ------------------------------------------------------------
if (quarantine && s.flakyTestsFound > 0) {
  const q = detector.writeQuarantine(report);
  console.log(C.bold("🚧 Quarantine updated: ") + C.dim(q.file));
  console.log(C.dim(`   ${q.count} test(s) tracked with owner + 14-day deadline\n`));
}

console.log(C.dim(`Full machine-readable report: .flaky-detector-data/history.json`));
console.log(C.dim(`Visual dashboard:             npm run report\n`));

// --- alerts + exit ---------------------------------------------------------
(async () => {
  if (dryRunNotify || webhook) {
    try {
      const res = await notify(report, webhook, { dryRun: dryRunNotify });
      if (res.dryRun) {
        console.log(C.bold("🔕 --dry-run-notify — this is exactly what WOULD be sent:"));
        console.log(C.dim(JSON.stringify(res.payload, null, 2)) + "\n");
      } else if (res.sent) {
        console.log(C.green(`🔔 Alert sent to webhook (HTTP ${res.status}).`) +
          C.dim("  Only names + counts left the machine.\n"));
      }
    } catch (e) {
      console.log(C.yellow(`⚠ Alert failed to send: ${e.message} (detection still succeeded)\n`));
    }
  }

  // In CI mode, only HIGH-severity flakes break the build (so a single noisy LOW
  // doesn't block everyone). Otherwise, any flake => non-zero.
  const highs = report.flakyTests.filter((t) => t.severity === "high").length;
  if (ciMode) process.exit(highs > 0 ? 1 : 0);
  process.exit(s.flakyTestsFound > 0 ? 1 : 0);
})();
