// Outbound alerts (Slack / generic webhook) — zero dependencies, built-in https.
//
// PRIVACY CONTRACT: this is the ONE place the tool can talk to the network, and
// it only ever sends the bare minimum — test names, counts, verdicts, category.
// It NEVER sends stack traces, source, or failure output; those stay on the
// machine. `dryRun` prints the exact payload instead of sending, so a security
// team can verify that promise before turning alerts on.

const https = require("https");

function postJSON(webhookUrl, payload) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(webhookUrl);
    } catch {
      return reject(new Error("invalid webhook URL"));
    }
    const data = JSON.stringify(payload);
    const opts = {
      method: "POST",
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    };
    const req = https.request(opts, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// Build a minimal, stack-trace-free Slack message from a report.
function buildPayload(report) {
  const s = report.summary;
  const sha = (report.metadata.git && report.metadata.git.shortSha) || "—";

  if (s.flakyTestsFound === 0) {
    return {
      text: `✅ Flaky Test Detector — no flaky tests (${s.totalTests} tests, ${report.metadata.totalRuns} runs, commit ${sha}).`,
    };
  }

  const lines = report.flakyTests
    .map(
      (t) =>
        `• *${t.name}* — ${t.verdict} · ${t.failed}/${t.runs} failed · ${t.flakeConfidence}% confident · _${t.category}_`
    )
    .join("\n");

  return {
    text: `⚠️ Flaky Test Detector found ${s.flakyTestsFound} flaky test(s) — health: ${s.health.toUpperCase()}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*⚠️ ${s.flakyTestsFound} flaky test(s) detected* — suite health: *${s.health.toUpperCase()}*\ncommit \`${sha}\` · ${report.metadata.totalRuns} runs · mode \`${report.metadata.mode}\``,
        },
      },
      { type: "section", text: { type: "mrkdwn", text: lines } },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "🔒 Only test names + counts were sent. Stack traces and source stayed local.",
          },
        ],
      },
    ],
  };
}

async function notify(report, webhookUrl, { dryRun = false } = {}) {
  const payload = buildPayload(report);
  if (dryRun) {
    return { dryRun: true, payload };
  }
  if (!webhookUrl) return { skipped: true };
  const res = await postJSON(webhookUrl, payload);
  return { sent: true, status: res.status };
}

module.exports = { notify, buildPayload };
