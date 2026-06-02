// Failure fingerprinting & root-cause categorization.
//
// Two ideas here, both things a "run it 5 times" script doesn't do:
//
//  1. FINGERPRINT: normalize a failure's output (strip line numbers, hex
//     addresses, timestamps, ports, temp paths) and hash it. Two runs that fail
//     "the same way" share a fingerprint; a test failing for three different
//     reasons is a different (worse) problem than one failing the same way
//     thrice. That distinction drives the fix.
//
//  2. CATEGORIZE: match the normalized text against known flake signatures so
//     the report says *why* ("network/external dependency") instead of just
//     "it's flaky". This is the part that turns a dashboard into a to-do list.

const crypto = require("crypto");

// Strip everything run-specific so the same logical failure hashes the same.
function normalize(output) {
  return (output || "")
    .replace(/0x[0-9a-fA-F]+/g, "0xADDR")          // memory addresses
    .replace(/\b\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?/g, "TIMESTAMP") // ISO timestamps
    .replace(/\b\d+ms\b/g, "Nms")                   // durations
    .replace(/:\d+:\d+/g, ":LINE:COL")              // file:line:col
    .replace(/\b\d{2,5}\b/g, "N")                   // ports, big numbers
    .replace(/\/tmp\/\S+/g, "/tmp/PATH")            // temp paths
    .replace(/[A-Za-z]:\\\\\S+/g, "WINPATH")        // windows paths
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function fingerprint(output) {
  const norm = normalize(output);
  if (!norm) return null;
  return crypto.createHash("sha1").update(norm).digest("hex").slice(0, 12);
}

// Ordered most-specific-first. Each rule, if its pattern hits, explains the
// likely cause and the standard fix. These mirror the categories real flake
// tools use (timing, network, order/shared-state, nondeterminism, assertion).
const SIGNATURES = [
  {
    id: "timeout",
    test: /timed?\s*out|timeout|exceeded .* timeout|deadline exceeded|etimedout/i,
    cause: "Timing / timeout",
    fix: "Raise the timeout, or await the real condition instead of a fixed sleep. Flaky timeouts almost always mean a hard-coded wait racing a variable-latency operation.",
  },
  {
    id: "network",
    test: /econnrefused|econnreset|enotfound|socket hang up|network|fetch failed|503|502|gateway|dns/i,
    cause: "Network / external dependency",
    fix: "Mock the external call or add bounded retries. A test that hits a real network is flaky by construction.",
  },
  {
    id: "order",
    test: /already exists|duplicate key|unique constraint|left over|not empty|already in use|address in use|eaddrinuse/i,
    cause: "Test-order / shared state",
    fix: "State is leaking between tests. Reset DB/fixtures/globals in teardown, or isolate this test. Run the suite in a shuffled order to confirm.",
  },
  {
    id: "concurrency",
    test: /race|deadlock|concurrent|mutex|lock|unhandled (promise )?rejection/i,
    cause: "Concurrency / race condition",
    fix: "Two things are racing. Serialize the access, or await all in-flight work before asserting.",
  },
  {
    id: "nondeterminism",
    test: /math\.random|date\.now|new date\(\)|uuid|random|locale|timezone/i,
    cause: "Nondeterministic input",
    fix: "Pin the source of randomness — seed RNG, freeze the clock, fix the locale/timezone.",
  },
  {
    id: "null",
    test: /cannot read propert|undefined is not|null is not|nonetype|nullpointer|nullreferenceexception/i,
    cause: "Null / uninitialized state",
    fix: "Something isn't ready when the test reads it — usually an unawaited async setup or a missing fixture.",
  },
  {
    id: "assertion",
    test: /assert|expected .* to (be|equal)|tobe|toequal|assertionerror/i,
    cause: "Assertion mismatch (nondeterministic value)",
    fix: "The value under assertion varies between runs. Trace what feeds it — ordering, time, or floating-point are the usual culprits.",
  },
];

function categorize(output) {
  const text = output || "";
  for (const sig of SIGNATURES) {
    if (sig.test.test(text)) {
      return { id: sig.id, cause: sig.cause, fix: sig.fix };
    }
  }
  return {
    id: "unknown",
    cause: "Uncategorized",
    fix: "No known signature matched. Inspect the captured failure output below; if this recurs, the fingerprint will tell you whether it's one bug or several.",
  };
}

module.exports = { normalize, fingerprint, categorize, SIGNATURES };
