# Desktop Smoke Tests

## Startup

1. `pnpm install`
2. `pnpm --filter @autoagent/control-plane dev`
3. `pnpm --filter @autoagent/web dev`
4. Confirm Electron window opens.

## First launch onboarding

1. Ensure settings are at default onboarding state (`hasCompletedOnboarding=false`) by using a fresh user data directory.
2. In Step 1, enter provider ID/model/base URL + API key and click `Save Securely`.
3. In Step 2, run chat trial and repo trial.
4. In Step 3, click `Finish Onboarding`.
5. Restart app and verify onboarding does not appear again.

## Navigation

- Sidebar shows: Home, Tasks, Approvals, Connections, Settings.
- Clicking each view changes main content without reload.

## First 60-second success path

1. Open `Home`.
2. In `Quick Connect`, save an API key.
3. In `Start Task`, submit one task.
4. Confirm you are guided to use `Tasks` for follow-up activity.

## Start Task + guarded execution

1. In Home, set directory and objective.
2. Click `Start Task`.
3. Confirm approval dialog appears.
4. Approve once and verify activity contains:
   - `approval_required`
   - `approved`
   - `completed`
5. Retry and reject once; verify awaiting-approval status appears.

## Resilience + recovery

1. Start a task, then open `Tasks`.
2. Expand the task and verify controls appear: `Resume`, `Retry`, `Abort`.
3. Trigger `Abort` and verify task status updates to cancelled/failed with recovery hints.
4. Trigger `Retry` and confirm execution restarts with new traces.
5. Confirm retries and token totals appear in task metrics row.

## Execution maturity checks

1. Start a task and expand it in `Tasks`.
2. Verify a planning event appears before the first tool call.
3. Trigger a run that asks a clarification question; verify a prompt input appears in the task card.
4. Submit an answer and confirm execution resumes automatically.
5. Verify reflection event appears before final completion.
6. Verify follow-up actions are shown and launching one creates a new run.

## Verification + promotion checks

1. Run a task that executes at least one tool command and file write.
2. Verify verification traces are present (`execution.validation`) and artifacts are persisted.
3. Confirm run metrics include verification passed/failed counts.
4. Confirm promotion status is recorded for the run (promoted/rejected with reason).

## Data persistence checks

- Restart control-plane process.
- Verify seeded run/provider/settings data still exists.
- Create a task via Home and confirm it still appears after restart.
- Run backup command and verify output file exists:
  - `pnpm --filter @autoagent/control-plane db:backup`
- Stop control-plane, run restore command with that file, restart:
  - `pnpm --filter @autoagent/control-plane db:restore "<backup-file-path>"`
- Verify dashboard/runs/settings still load after restore.

## Retention cleanup checks

- Update settings retention values through API/UI:
  - `traceRetentionDays`, `artifactRetentionDays`, `promptRetentionDays`, `cleanupIntervalMinutes`.
- Restart control-plane and confirm retention cleanup logs print prune counts.
- Confirm old answered prompts/artifacts/traces are pruned while active runs remain intact.

## Key security checks

- Verify `providers` table in `~/.autoagent/control-plane.db` has metadata only and `api_key_stored` flag.
- Verify no plaintext API key appears in control-plane logs or DB rows.
- Verify chat trial only works after key was stored.

## UX guardrails

- Confirm no dead-end screens (every empty state explains the next action).
- Confirm key actions have immediate feedback (save key, start task).
- Confirm terminology is action-oriented and readable for non-expert users.
- Confirm blocked tool actions display approval context and resolution in timeline.

## Release gate checklist

- policy-denied tool call
- denied or expired egress approval
- retry then success by error class
- crash + deterministic resume
- promotion blocked for low verification pass rate

## Context retrieval checks

- Index repository via ingest/chunk flow (runner path that triggers context engine).
- Re-run retrieval query and confirm non-empty results.
- Restart process and rerun query; confirm results still resolve from persisted SQLite data.
