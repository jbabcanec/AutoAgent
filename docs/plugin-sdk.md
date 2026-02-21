# Plugin SDK Specification

## Purpose

Plugins extend tool adapters, repo connectors, and evaluation sources without changing core services.

## Required Capabilities

- Declare action class and risk profile for each exposed operation
- Provide JSON-schema-like input/output contracts
- Emit structured events for observability
- Respect host policy decisions and approval outcomes

## Interface Sketch

```ts
export interface AutoAgentPlugin {
  id: string;
  version: string;
  tools: ToolDefinition[];
  connectors?: ConnectorDefinition[];
}
```

## Security Requirements

- Plugins must not bypass approval gates.
- Plugins must not persist raw secrets.
- Plugins should provide deterministic errors for policy and audit consistency.
