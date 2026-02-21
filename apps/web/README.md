# AutoAgent Desktop App

This app is the local Electron operator console for first-run navigation, context-aware play execution, and approval-gated actions.

## Run locally

1. Install workspace deps:
   - `pnpm install`
2. Start control-plane API (terminal 1):
   - `pnpm --filter @autoagent/control-plane dev`
3. Start desktop app (terminal 2):
   - `pnpm --filter @autoagent/web dev`
4. Use the opened Electron window.

## Navigation targets (in sidebar)

- Dashboard
- Runs
- Approvals
- Traces
- Settings
- Providers

## Play button workflow

1. Open Dashboard.
2. Set directory and objective.
3. Click `Play`.
4. Approve or reject guarded execution when prompted.
5. Observe run status events in Run Log.
