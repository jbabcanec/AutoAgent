# Threat Model

## Assets

- User source code and repository metadata
- API keys and provider credentials
- Execution outputs and deployment artifacts
- Audit logs and evaluation traces

## Primary Threats

1. Prompt injection from repository content or retrieved data
2. Secret exfiltration through prompts or tool outputs
3. Unsafe autonomous execution (destructive shell or deploy actions)
4. Tenant data isolation failure in managed cloud mode
5. Supply chain compromise via dependencies or plugins

## Mitigations

- Policy-gated tool execution with deny/approval defaults for high-risk actions
- Secret redaction and scoped tool-time credential injection
- Sandboxed runner profiles for local, container, and hardened worker modes
- Signed run events and immutable audit trails
- Dependency scanning and mandatory review for plugin publication
