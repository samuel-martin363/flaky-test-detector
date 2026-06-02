// Lightweight git context capture.
//
// Why this matters: the single most useful question about a flaky test is "when
// did it START being flaky?" If you tag every run with the commit SHA, you can
// later say "test X became flaky at commit abc123" — which points straight at
// the change that introduced it and the person who can fix it. This is exactly
// what the cloud tools do server-side; we do it locally, so the data stays on
// your machine.

const { execSync } = require("child_process");

function safe(cmd) {
  try {
    return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function gitContext() {
  const sha = safe("git rev-parse HEAD");
  if (!sha) return { available: false };

  return {
    available: true,
    sha,
    shortSha: sha.slice(0, 8),
    branch: safe("git rev-parse --abbrev-ref HEAD"),
    author: safe("git log -1 --pretty=format:%an"),
    subject: safe("git log -1 --pretty=format:%s"),
    dirty: safe("git status --porcelain") ? true : false,
  };
}

module.exports = { gitContext };
