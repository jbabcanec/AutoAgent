# Contributing Guide

## Development Workflow

1. Create a focused branch.
2. Add or update tests for behavior changes.
3. Run `pnpm typecheck` and `pnpm test`.
4. Document any protocol or policy changes.
5. Open a PR with threat/risk notes for execution-related changes.

## Standards

- Keep provider interfaces backward compatible.
- Preserve guarded-execution defaults.
- Avoid model-specific logic in core orchestration paths.
- Add benchmark cases when changing retrieval, history selection, or routing logic.

## Security Reporting

Report vulnerabilities privately to project maintainers before public disclosure.
