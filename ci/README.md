# CI recipes

Copy-paste setups to run Flaky Test Detector in your pipeline. Pick your platform:

| Platform | File | Where it goes |
|---|---|---|
| GitHub Actions | [`github-actions.yml`](github-actions.yml) | `.github/workflows/flaky-tests.yml` |
| GitLab CI | [`gitlab-ci.yml`](gitlab-ci.yml) | merge into `.gitlab-ci.yml` |
| Jenkins | [`Jenkinsfile`](Jenkinsfile) | a stage in your `Jenkinsfile` |

## The two flags that matter

- `--junit=results.xml` — read exact per-test results. **Make your test runner
  emit JUnit XML** (it's one flag in every framework):
  - Jest: `jest --reporters=default --reporters=jest-junit`
  - pytest: `pytest --junitxml=results.xml`
  - Go: `go test ./... | go-junit-report > results.xml`
  - Mocha: `mocha --reporter mocha-junit-reporter`
- `--ci` — only **HIGH-severity** flakes fail the job, so one noisy low-confidence
  test doesn't block the whole team.

## Run it nightly, not on every PR

Detection runs your suite multiple times — that's minutes, not seconds. Nightly
(or on a schedule) keeps your PR pipeline fast while still catching flakes early.
All recipes default to a daily schedule + a manual trigger.

## Alerts are optional and minimal

Set `SLACK_WEBHOOK_URL` (as a secret/masked variable) to get a Slack ping when
flakes appear. It sends **test names + counts only — never stack traces or
source.** Leave it unset to stay 100% local. Verify exactly what would be sent:

```bash
node index.js --junit=results.xml --dry-run-notify "your test command"
```

## Getting the detector onto the runner

Until it's published to npm, vendor it into your repo (copy the
`flaky-test-detector/` folder or add it as a git submodule) and call
`node ./flaky-test-detector/index.js ...` as the recipes show. Once published:
`npx flaky-test-detector ...`.
