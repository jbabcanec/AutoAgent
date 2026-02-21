# Release Process

## Channels

- `canary`: fast validation for policy/context changes
- `stable`: production-ready releases after benchmark and safety gates

## Promotion Criteria

1. No critical safety regressions in benchmark suite
2. Aggregate benchmark score is not lower than baseline
3. Token and latency budgets remain within accepted thresholds
4. Manual review completed for policy-engine changes

## Versioning

- Use semantic versioning per package.
- Publish changelogs with explicit notes on security and execution behavior.

## Rollback

- Keep previous stable image tags and lockable package versions.
- Roll back immediately on safety gate failures or approval bypass defects.
