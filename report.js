#!/usr/bin/env node

// Builds a self-contained HTML dashboard from local history. Opens in any
// browser; reads only .flaky-detector-data/ — nothing is fetched or sent.

const fs = require("fs");
const path = require("path");

const dataDir = path.join(process.cwd(), ".flaky-detector-data");
const historyFile = path.join(dataDir, "history.json");

if (!fs.existsSync(historyFile)) {
  console.log("❌ No history yet. Run the detector first.");
  process.exit(1);
}

const history = JSON.parse(fs.readFileSync(historyFile, "utf-8"));

const timeline = history.map((r) => ({
  t: new Date(r.metadata.timestamp).toLocaleString(),
  rate: r.summary?.flakyRatePct || 0,
  count: r.summary?.flakyTestsFound || 0,
  commit: r.metadata?.git?.shortSha || "—",
}));

const latest = history[history.length - 1];
const avgRate = (timeline.reduce((a, t) => a + t.rate, 0) / timeline.length).toFixed(1);

// Aggregate which tests appear flaky most often across history.
const offenders = new Map();
for (const r of history) {
  for (const t of r.flakyTests || []) {
    if (!offenders.has(t.name)) offenders.set(t.name, { name: t.name, seen: 0, category: t.category });
    offenders.get(t.name).seen++;
  }
}
const topOffenders = [...offenders.values()].sort((a, b) => b.seen - a.seen).slice(0, 10);

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Flaky Test Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
  :root{--bg:#0d1117;--card:#161b22;--line:#30363d;--text:#e6edf3;--mut:#8b949e;--accent:#58a6ff;--bad:#f85149;--ok:#3fb950;}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:ui-sans-serif,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--text);padding:32px}
  .wrap{max-width:1100px;margin:0 auto}
  h1{font-size:22px;margin-bottom:4px}
  .sub{color:var(--mut);font-size:13px;margin-bottom:24px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px}
  .num{font-size:28px;font-weight:700;color:var(--accent)}
  .lbl{color:var(--mut);font-size:12px;margin-top:4px}
  canvas{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px}
  table{width:100%;border-collapse:collapse;margin-top:24px;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
  th,td{text-align:left;padding:10px 14px;border-bottom:1px solid var(--line);font-size:13px}
  th{color:var(--mut);font-weight:600}
  .badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;background:#21262d;color:var(--mut)}
  .priv{margin-top:24px;color:var(--mut);font-size:12px;text-align:center}
</style></head><body><div class="wrap">
<h1>🔍 Flaky Test Dashboard</h1>
<div class="sub">Local history · ${history.length} run(s) · latest commit ${latest.metadata?.git?.shortSha || "—"}</div>
<div class="grid">
  <div class="card"><div class="num">${latest.summary.flakyTestsFound}</div><div class="lbl">flaky tests (latest)</div></div>
  <div class="card"><div class="num">${latest.summary.flakyRatePct}%</div><div class="lbl">flaky rate (latest)</div></div>
  <div class="card"><div class="num">${avgRate}%</div><div class="lbl">avg flaky rate</div></div>
  <div class="card"><div class="num" style="text-transform:uppercase">${latest.summary.health}</div><div class="lbl">suite health</div></div>
</div>
<canvas id="c" height="110"></canvas>
<table><thead><tr><th>Most persistent flaky tests</th><th>Times seen flaky</th><th>Category</th></tr></thead><tbody>
${topOffenders.map((o) => `<tr><td>${o.name}</td><td>${o.seen} / ${history.length}</td><td><span class="badge">${o.category || "—"}</span></td></tr>`).join("") || `<tr><td colspan="3" style="color:var(--mut)">No flaky tests recorded yet 🎉</td></tr>`}
</tbody></table>
<div class="priv">🔒 Generated locally. No test data, stack traces, or source ever left this machine.</div>
</div>
<script>
const tl=${JSON.stringify(timeline)};
new Chart(document.getElementById('c'),{type:'line',
 data:{labels:tl.map(x=>x.t),datasets:[{label:'Flaky rate (%)',data:tl.map(x=>x.rate),
  borderColor:'#58a6ff',backgroundColor:'rgba(88,166,255,.12)',fill:true,tension:.35,pointRadius:4}]},
 options:{plugins:{legend:{labels:{color:'#e6edf3'}}},
  scales:{y:{min:0,suggestedMax:100,ticks:{color:'#8b949e',callback:v=>v+'%'},grid:{color:'#30363d'}},
          x:{ticks:{color:'#8b949e'},grid:{color:'#21262d'}}}}});
</script></body></html>`;

const out = path.join(dataDir, "report.html");
fs.writeFileSync(out, html);
console.log(`\n✅ Dashboard written: ${out}`);
console.log(`   Open it in your browser to see trends + persistent offenders.\n`);
