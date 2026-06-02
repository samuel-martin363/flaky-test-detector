// Minimal JUnit-XML reader — zero dependencies.
//
// JUnit XML is the one output format basically every test framework can emit
// (jest-junit, pytest --junitxml, go-junit-report, mocha-junit-reporter, phpunit,
// rspec_junit, etc.). Reading it gives us EXACT per-test results — which test
// passed, which failed, and that test's own failure text — instead of guessing
// from console output. That's the difference between "something in this run
// failed" and "THIS test failed, THIS is why."

const fs = require("fs");
const path = require("path");

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#10;/g, "\n")
    .replace(/&amp;/g, "&");
}

function parseAttrs(s) {
  const out = {};
  const re = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(s)) !== null) out[m[1]] = decodeEntities(m[2]);
  return out;
}

// Parse one XML string into [{ name, failed, skipped, failureText }].
function parseJUnitXML(xml) {
  const tests = [];
  // Matches both <testcase .../> and <testcase ...> ... </testcase>
  const caseRe = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  let m;
  while ((m = caseRe.exec(xml)) !== null) {
    const attrs = parseAttrs(m[1]);
    const inner = m[2] || "";
    const name = attrs.name || "unknown";
    const cls = attrs.classname || attrs.class || "";
    const fullName = cls ? `${cls}::${name}` : name;

    const skipped = /<skipped\b/.test(inner);
    const failed = /<(failure|error)\b/.test(inner);

    let failureText = null;
    if (failed) {
      const fm =
        inner.match(/<(?:failure|error)\b([^>]*)>([\s\S]*?)<\/(?:failure|error)>/) ||
        inner.match(/<(?:failure|error)\b([^>]*)\/>/);
      if (fm) {
        const fattrs = parseAttrs(fm[1] || "");
        const body = (fm[2] || "").trim();
        failureText = decodeEntities(body || fattrs.message || "failure");
      }
    }
    tests.push({ name: fullName, failed, skipped, failureText });
  }
  return tests;
}

// Read a file, or every *.xml in a directory, and aggregate all testcases.
function readJUnit(target) {
  if (!target || !fs.existsSync(target)) return [];
  const files = [];
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    for (const f of fs.readdirSync(target)) {
      if (f.toLowerCase().endsWith(".xml")) files.push(path.join(target, f));
    }
  } else {
    files.push(target);
  }
  const all = [];
  for (const f of files) {
    try {
      all.push(...parseJUnitXML(fs.readFileSync(f, "utf-8")));
    } catch {
      /* ignore unreadable/garbage file, fall back to stdout elsewhere */
    }
  }
  return all;
}

module.exports = { parseJUnitXML, readJUnit };
