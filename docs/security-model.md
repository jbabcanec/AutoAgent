# Security Model

## Principles

- Least privilege by default
- Human approval for risky side effects
- Provider-agnostic but policy-consistent behavior
- Full observability for forensics and incident response

## Key Controls

- **Identity**: actor-scoped run initiation and approval authority checks
- **Policy**: centralized action classification (`read`, `write`, `exec`, `external`, `deploy`)
- **Execution**: sandboxed runner with no implicit host escalation
- **Secrets**: never persisted in plain logs; masked before model input
- **Audit**: append-only run events for model calls, tool calls, and approvals

## Deployment Expectations

- Self-hosted users own infrastructure, network boundaries, and key management.
- Cloud deployments enforce tenant isolation, encrypted transit/storage, and rotating service credentials.
