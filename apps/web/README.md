# AutoAgent Desktop App

This app is the local Electron operator console for polished first-run onboarding, secure provider key setup, context-aware play execution, and approval-gated actions.

## Run locally

1. Install workspace deps:
   - `pnpm install`
2. Start control-plane API (terminal 1):
   - `pnpm --filter @autoagent/control-plane dev`
3. Start desktop app (terminal 2):
   - `pnpm --filter @autoagent/web dev`
4. Use the opened Electron window.

## Quick Start in 3 steps

1. Open `Home` and use **Quick Connect** to save your API key.
2. In **Start Task**, choose a project folder and describe the task.
3. Go to `Tasks` to monitor activity and outcomes.

## Navigation targets (in sidebar)

- Home
- Tasks
- Approvals
- Connections
- Settings

## First-run onboarding

1. Launch the app with a fresh profile.
2. Complete onboarding Step 1:
   - Enter provider metadata for an `openai-compatible` endpoint.
   - Enter API key (`sk-...`) and click `Save Securely`.
3. Complete onboarding Step 2:
   - Run Chat trial.
   - Run Repo trial.
4. Complete onboarding Step 3:
   - Click `Open Dashboard`.

### Security notes

- Provider API keys are stored in Electron main process encrypted storage (`safeStorage`) and never sent to control-plane DB.
- Control-plane SQLite stores provider metadata and the `apiKeyStored` boolean only.

## Start Task workflow

1. Open Dashboard.
2. Set directory and objective.
3. Click `Start Task`.
4. Approve or reject guarded execution when prompted.
5. Review detailed activity in `Tasks`.

## Reliability and performance features

- Per-tool policy checks with approval gating for risky actions.
- Retry + circuit breaker behavior for transient model/tool failures.
- Execution checkpoints persisted for resume/retry recovery flows.
- Run metrics available per task: tokens, retries, latency, and estimated cost.
- Routing mode controls in Settings: `balanced`, `latency`, `quality`, `cost`.
