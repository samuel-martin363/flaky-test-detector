// Demo suite with realistic, *categorizable* flaky failures so you can see the
// detector's fingerprinting + root-cause analysis do real work.
//
//   node index.js "node test-example.js"

let failed = false;

console.log("✓ Test 1: validates user schema");          // always passes

// Flaky #1 — a timeout-style failure (network latency race).
if (Math.random() > 0.5) {
  console.log("✓ Test 2: fetches dashboard data");
} else {
  console.log("✕ Test 2: fetches dashboard data");
  console.error("Error: Timed out after 5000ms waiting for response");
  failed = true;
}

console.log("✓ Test 3: hashes passwords");               // always passes

// Flaky #2 — a network/external dependency failure.
if (Math.random() > 0.5) {
  console.log("✓ Test 4: syncs with payment provider");
} else {
  console.log("✕ Test 4: syncs with payment provider");
  console.error("Error: connect ECONNREFUSED 127.0.0.1:5432");
  failed = true;
}

console.log("✓ Test 5: renders invoice PDF");            // always passes

process.exit(failed ? 1 : 0);
