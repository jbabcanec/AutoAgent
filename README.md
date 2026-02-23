# AutoAgent

AutoAgent is an open-source, provider-agnostic developer agent platform with guarded execution and context-efficient orchestration.

## Scope

- BYOK model access via OpenAI-compatible provider interfaces
- Policy-gated tool execution for safer autonomy
- Repo-aware context compiler and history selection
- Evaluation-driven optimization for quality, cost, and safety
- Desktop-first Electron operation with local control-plane services

## Monorepo

- `apps/control-plane`: API orchestration and run lifecycle
- `apps/runner`: sandboxed execution worker
- `apps/web`: desktop Electron app (Vite + React renderer)
- `packages/protocol`: typed platform contracts
- `packages/provider-sdk`: provider abstraction layer
- `packages/context-engine`: context compilation pipeline
- `packages/policy-engine`: action policy and approval gates
- `packages/evals`: scoring and optimization workflows
- `infra`: deployment references
- `docs`: security and contributor documentation

## Local desktop first test

1. Install dependencies:
   - `pnpm install`
2. Start control-plane API:
   - `pnpm --filter @autoagent/control-plane dev`
3. Start desktop app:
   - `pnpm --filter @autoagent/web dev`
4. On first launch, complete onboarding:
   - configure `openai-compatible` provider metadata
   - save ChatGPT key securely
   - run chat + repo trial steps
5. In the Electron window, navigate:
   - Dashboard, Runs, Approvals, Traces, Settings, Providers
6. Click `Play` from Dashboard to run a guarded execution test.

## Packaging

- Build desktop binaries:
  - `pnpm --filter @autoagent/web dist`
- Build unpacked app directory:
  - `pnpm --filter @autoagent/web package`

## API smoke examples

- Dashboard stats:
  - `curl http://localhost:8080/api/dashboard/stats`
- Runs list:
  - `curl http://localhost:8080/api/runs`
- Create run:
  - `curl -X POST http://localhost:8080/api/runs -H "Content-Type: application/json" -d "{\"projectId\":\"demo\",\"objective\":\"first test\"}"`
- Approvals list:
  - `curl http://localhost:8080/api/approvals`
- Providers list:
  - `curl http://localhost:8080/api/providers`
- Provider get:
  - `curl http://localhost:8080/api/providers/openai-default`

## Persistence

- Control-plane data persists in SQLite: `~/.autoagent/control-plane.db`
- Context/index data persists in SQLite: `~/.autoagent/context.db`

## Backup + restore runbook

- Create a timestamped backup:
  - `pnpm --filter @autoagent/control-plane db:backup`
- Create backup to a specific file path:
  - `pnpm --filter @autoagent/control-plane db:backup "C:/temp/control-plane-backup.db"`
- Restore from a backup file:
  - `pnpm --filter @autoagent/control-plane db:restore "C:/temp/control-plane-backup.db"`
- Recommended restore flow:
  - stop `@autoagent/control-plane` process,
  - run restore command,
  - restart control-plane and verify `GET /api/dashboard/stats`.

## Data retention policy

- Retention settings are in `/api/settings`:
  - `traceRetentionDays`
  - `artifactRetentionDays`
  - `promptRetentionDays`
  - `promptCacheRetentionDays`
  - `cleanupIntervalMinutes`
- Cleanup executes on control-plane startup and then on a fixed interval.

## Agent tooling uplift

- Built-in coding tools now include:
  - `edit_file`
  - `search_code`
  - `glob_files`
  - `git_status`, `git_diff`, `git_add`, `git_commit` (guarded subset)
- `run_command` now uses async process execution with timeout and abort handling.
- Run timeline supports incremental assistant deltas for streaming-like UX.

## Project-level agent config

- Optional file at repo root: `.autoagent.json`
- Supported fields:
  - `toolAllowlist` (array of tool names)
  - `preferredModel`
  - `maxTokens`
  - `contextHistoryMaxMessages`
  - `contextSummaryMaxChars`
