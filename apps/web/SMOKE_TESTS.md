# Desktop Smoke Tests

## Startup

1. `pnpm install`
2. `pnpm --filter @autoagent/control-plane dev`
3. `pnpm --filter @autoagent/web dev`
4. Confirm Electron window opens.

## Navigation

- Sidebar shows: Dashboard, Runs, Approvals, Traces, Settings, Providers.
- Clicking each view changes main content without reload.

## Play + guarded execution

1. In Dashboard, set directory and objective.
2. Click `Play`.
3. Confirm approval dialog appears.
4. Approve once and verify log contains:
   - `approval.request`
   - `approval.resolve`
   - executed status
5. Retry and reject once; verify awaiting-approval status appears.

## Data persistence checks

- Restart control-plane process.
- Verify seeded run/provider/settings data still exists.
- Create a run via Play and confirm it still appears after restart.

## Context retrieval checks

- Index repository via ingest/chunk flow (runner path that triggers context engine).
- Re-run retrieval query and confirm non-empty results.
- Restart process and rerun query; confirm results still resolve from persisted SQLite data.
