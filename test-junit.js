// Demo: emulates a test framework that writes a JUnit XML report (like
// `pytest --junitxml=results.xml` or jest-junit). Two tests are flaky, each
// failing its OWN distinct way — so the detector should categorize them
// SEPARATELY and correctly (timeout vs. network), which stdout scraping can't.
//
//   node index.js --junit=results.xml "node test-junit.js"

const fs = require("fs");

const fail2 = Math.random() > 0.5; // dashboard: timeout-style
const fail4 = Math.random() > 0.5; // payments: network-style

const tc = (name, time, failure) =>
  failure
    ? `  <testcase classname="api" name="${name}" time="${time}"><failure message="${failure.msg}">${failure.body}</failure></testcase>`
    : `  <testcase classname="api" name="${name}" time="${time}"/>`;

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
<testsuite name="api" tests="5" failures="${(fail2 ? 1 : 0) + (fail4 ? 1 : 0)}">
${tc("validates_user_schema", "0.01")}
${tc("fetches_dashboard_data", "5.0", fail2 ? { msg: "Timed out", body: "Error: Timed out after 5000ms waiting for response" } : null)}
${tc("hashes_passwords", "0.02")}
${tc("syncs_with_payment_provider", "0.30", fail4 ? { msg: "ECONNREFUSED", body: "Error: connect ECONNREFUSED 127.0.0.1:5432" } : null)}
${tc("renders_invoice_pdf", "0.10")}
</testsuite>
</testsuites>`;

fs.writeFileSync("results.xml", xml);
process.exit(fail2 || fail4 ? 1 : 0);
