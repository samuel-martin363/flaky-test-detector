const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { classify } = require("./stats");
const { fingerprint, categorize } = require("./fingerprint");
const { gitContext } = require("./git");
const { readJUnit } = require("./junit");

// Flaky Test Detector — local-first analysis engine.
//
// Everything here runs on the machine that owns the tests. No network calls, no
// telemetry, no upload. That is the product's whole reason to exist next to the
// cloud SaaS competitors: your stack traces never leave your infrastructure.
class FlakyTestDetector {
  constructor(testCommand, options = {}) {
    this.testCommand = testCommand;
    this.initialRuns = options.initialRuns || 3;
    this.maxRuns = options.maxRuns || 8;
    this.junitPath = options.junitPath || null; // accurate per-test results
    this.mode = this.junitPath ? "junit" : "stdout";
    this.runs = [];
    this.dataDir = path.join(process.cwd(), ".flaky-detector-data");
    this.ensureDataDir();
    this.git = gitContext();
  }

  ensureDataDir() {
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
  }

  // Run the suite once, capturing result, duration, and (on failure) output for
  // fingerprinting.
  runOnce() {
    const start = Date.now();
    try {
      const output = execSync(this.testCommand, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      return { success: true, output, duration: Date.now() - start };
    } catch (error) {
      const combined = (error.stdout || "") + "\n" + (error.stderr || "");
      return { success: false, output: combined, duration: Date.now() - start };
    }
  }

  // Per-test parsing for the frameworks people actually use. Falls back to a
  // suite-level signal when it can't see individual tests.
  parse(output, success) {
    const passed = new Set();
    const failed = new Set();

    // Jest / Vitest: "✓ name" pass, "✕ name" / "× name" fail
    for (const m of output.matchAll(/^\s*[✓√]\s+(.+?)\s*(?:\(\d+\s*ms\))?\s*$/gm)) passed.add(m[1].trim());
    for (const m of output.matchAll(/^\s*[✕×]\s+(.+?)\s*(?:\(\d+\s*ms\))?\s*$/gm)) failed.add(m[1].trim());

    // pytest: "path::name PASSED|FAILED"
    for (const m of output.matchAll(/([\w./]+::[\w\[\]-]+)\s+PASSED/g)) passed.add(m[1]);
    for (const m of output.matchAll(/([\w./]+::[\w\[\]-]+)\s+FAILED/g)) failed.add(m[1]);

    // go test: "--- FAIL: TestName" / "--- PASS: TestName"
    for (const m of output.matchAll(/---\s+PASS:\s+(\S+)/g)) passed.add(m[1]);
    for (const m of output.matchAll(/---\s+FAIL:\s+(\S+)/g)) failed.add(m[1]);

    if (passed.size === 0 && failed.size === 0) {
      // Couldn't see individual tests — track the suite as one unit.
      (success ? passed : failed).add("__suite__");
    }
    return { passed: [...passed], failed: [...failed], success };
  }

  // Turn one raw run into accurate per-test results. Prefers JUnit XML (exact,
  // with each test's own failure text); falls back to stdout scraping, where the
  // best we can do is attribute the whole run's output to each failed test.
  collect(r) {
    if (this.junitPath) {
      const cases = readJUnit(this.junitPath);
      const passed = [], failed = [], failuresByTest = {};
      for (const c of cases) {
        if (c.skipped) continue;
        if (c.failed) {
          failed.push(c.name);
          if (c.failureText) failuresByTest[c.name] = c.failureText;
        } else {
          passed.push(c.name);
        }
      }
      if (passed.length || failed.length) {
        return { passed, failed, failuresByTest };
      }
      // JUnit file missing/empty this run — fall through to stdout.
    }

    const p = this.parse(r.output, r.success);
    const failuresByTest = {};
    if (!r.success) for (const n of p.failed) failuresByTest[n] = r.output;
    return { passed: p.passed, failed: p.failed, failuresByTest };
  }

  // Stop early once every seen test has a confident verdict; keep going (up to
  // maxRuns) while anything is still statistically ambiguous.
  detect(onProgress = () => {}) {
    let run = 0;
    while (run < this.maxRuns) {
      run++;
      onProgress(run, this.maxRuns);
      const r = this.runOnce();
      const res = this.collect(r);
      this.runs.push({
        runNumber: run,
        duration: r.duration,
        success: r.success,
        passed: res.passed,
        failed: res.failed,
        // Per-test failure text (accurate in JUnit mode; whole-run in stdout mode).
        failuresByTest: res.failuresByTest,
      });

      if (run >= this.initialRuns && !this.stillAmbiguous()) break;
    }
    return this.report();
  }

  // Per-test pass/fail tallies across all runs so far.
  tally() {
    const t = new Map();
    for (const run of this.runs) {
      for (const name of run.passed) {
        if (!t.has(name)) t.set(name, { pass: 0, fail: 0, failOutputs: [] });
        t.get(name).pass++;
      }
      for (const name of run.failed) {
        if (!t.has(name)) t.set(name, { pass: 0, fail: 0, failOutputs: [] });
        t.get(name).fail++;
        const ft = run.failuresByTest && run.failuresByTest[name];
        if (ft) t.get(name).failOutputs.push(ft);
      }
    }
    return t;
  }

  // Any test that has flipped but whose verdict is still uncertain => keep running.
  stillAmbiguous() {
    for (const [, c] of this.tally()) {
      if (c.pass > 0 && c.fail > 0) {
        const v = classify(c.fail, c.pass + c.fail);
        if (v.needMoreRuns) return true;
      }
    }
    return false;
  }

  report() {
    const tally = this.tally();
    const flaky = [];

    for (const [name, c] of tally) {
      const total = c.pass + c.fail;
      const stats = classify(c.fail, total);
      if (c.pass > 0 && c.fail > 0) {
        // Fingerprint + categorize the failures.
        const prints = c.failOutputs.map(fingerprint).filter(Boolean);
        const uniquePrints = [...new Set(prints)];
        const category = categorize(c.failOutputs[0] || "");

        flaky.push({
          name,
          runs: total,
          passed: c.pass,
          failed: c.fail,
          ...stats,
          distinctFailureModes: uniquePrints.length || 1,
          fingerprints: uniquePrints,
          category: category.cause,
          suggestedFix: category.fix,
          sampleFailure: this.snippet(c.failOutputs[0]),
        });
      }
    }

    flaky.sort((a, b) => b.flakeConfidence - a.flakeConfidence);

    const totalTests = tally.size;
    const report = {
      schema: 2,
      metadata: {
        timestamp: new Date().toISOString(),
        command: this.testCommand,
        totalRuns: this.runs.length,
        totalDurationMs: this.runs.reduce((a, r) => a + r.duration, 0),
        platform: os.platform(),
        nodeVersion: process.version,
        mode: this.mode, // "junit" (exact) or "stdout" (best-effort)
        git: this.git,
        privacy: "local-only — no data left this machine",
      },
      summary: {
        totalTests,
        flakyTestsFound: flaky.length,
        flakyRatePct: totalTests ? +((flaky.length / totalTests) * 100).toFixed(1) : 0,
        health: this.health(flaky.length, totalTests),
      },
      flakyTests: flaky,
    };

    this.persist(report);
    return report;
  }

  // Industry banding: <2% healthy, 2-5% watch, >5% problem.
  health(flakyCount, totalTests) {
    if (!totalTests) return "unknown";
    const rate = (flakyCount / totalTests) * 100;
    if (rate < 2) return "healthy";
    if (rate < 5) return "watch";
    return "problem";
  }

  snippet(output, lines = 6) {
    if (!output) return null;
    return output
      .split("\n")
      .filter((l) => l.trim())
      .slice(-lines)
      .join("\n");
  }

  // Append to local history, keyed by commit so trends are per-SHA.
  persist(report) {
    const file = path.join(this.dataDir, "history.json");
    let history = [];
    if (fs.existsSync(file)) {
      try { history = JSON.parse(fs.readFileSync(file, "utf-8")); } catch { history = []; }
    }
    history.push(report);
    if (history.length > 200) history = history.slice(-200);
    fs.writeFileSync(file, JSON.stringify(history, null, 2));
  }

  // Generate / update a quarantine manifest: known-flaky tests with an owner and
  // a deadline, the way disciplined teams actually manage flakes. Tests here can
  // be excluded from build-blocking while still being tracked.
  writeQuarantine(report) {
    const file = path.join(this.dataDir, "quarantine.json");
    let manifest = { tests: {} };
    if (fs.existsSync(file)) {
      try { manifest = JSON.parse(fs.readFileSync(file, "utf-8")); } catch {}
    }
    const today = new Date();
    const deadline = new Date(today.getTime() + 14 * 86400000) // 2 weeks
      .toISOString()
      .slice(0, 10);

    for (const t of report.flakyTests) {
      if (t.severity === "high" || t.severity === "medium") {
        if (!manifest.tests[t.name]) {
          manifest.tests[t.name] = {
            firstSeen: today.toISOString().slice(0, 10),
            firstSeenCommit: this.git.shortSha || null,
            category: t.category,
            owner: report.metadata.git.author || "UNASSIGNED",
            deadline,
            status: "quarantined",
          };
        } else {
          manifest.tests[t.name].lastSeen = today.toISOString().slice(0, 10);
          manifest.tests[t.name].category = t.category;
        }
      }
    }
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
    return { file, count: Object.keys(manifest.tests).length };
  }

  // Compare flaky rate now vs earlier history -> trend + which tests are new.
  trends() {
    const file = path.join(this.dataDir, "history.json");
    if (!fs.existsSync(file)) return null;
    let history;
    try { history = JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return null; }
    if (history.length < 2) return null;

    const recent = history.slice(-5);
    const older = history.slice(-10, -5);
    if (older.length === 0) return null;

    const avg = (arr) => arr.reduce((a, r) => a + (r.summary?.flakyRatePct || 0), 0) / arr.length;
    const recentAvg = avg(recent);
    const olderAvg = avg(older);
    const delta = olderAvg === 0 ? 0 : ((olderAvg - recentAvg) / olderAvg) * 100;

    return {
      recentRatePct: +recentAvg.toFixed(1),
      previousRatePct: +olderAvg.toFixed(1),
      changePct: +delta.toFixed(1),
      direction: delta > 5 ? "improving" : delta < -5 ? "regressing" : "stable",
    };
  }
}

module.exports = FlakyTestDetector;
