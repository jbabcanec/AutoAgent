# AutoAgent

AutoAgent is an open-source, provider-agnostic developer agent platform with guarded execution and context-efficient orchestration.

## Scope

- BYOK model access via OpenAI-compatible provider interfaces
- Policy-gated tool execution for safer autonomy
- Repo-aware context compiler and history selection
- Evaluation-driven optimization for quality, cost, and safety
- Self-hosted and cloud deployment references

## Monorepo

- `apps/control-plane`: API orchestration and run lifecycle
- `apps/runner`: sandboxed execution worker
- `apps/web`: lightweight UI shell
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
4. In the Electron window, navigate:
   - Dashboard, Runs, Approvals, Traces, Settings, Providers
5. Click `Play` from Dashboard to run a guarded execution test.

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

## Persistence

- Control-plane data persists in SQLite: `~/.autoagent/control-plane.db`
- Context/index data persists in SQLite: `~/.autoagent/context.db`
