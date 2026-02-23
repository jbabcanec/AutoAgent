export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface RegisteredMcpAdapter {
  id: string;
  listTools: () => Promise<McpToolDescriptor[]>;
  invokeTool: (name: string, input: Record<string, unknown>) => Promise<{ ok: boolean; output: string }>;
}

const adapters = new Map<string, RegisteredMcpAdapter>();

export function registerMcpAdapter(adapter: RegisteredMcpAdapter): void {
  adapters.set(adapter.id, adapter);
}

export function listMcpAdapters(): RegisteredMcpAdapter[] {
  return [...adapters.values()];
}

export function getMcpAdapter(id: string): RegisteredMcpAdapter | undefined {
  return adapters.get(id);
}

export function clearMcpAdapters(): void {
  adapters.clear();
}

/**
 * Collect all tools from all registered MCP adapters and return them in
 * Anthropic and OpenAI formats, along with a mapping from prefixed tool name
 * back to the adapter + original tool name for execution routing.
 */
export async function collectMcpToolDefinitions(): Promise<{
  anthropicTools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
  openaiTools: Array<{ type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }>;
  toolMap: Map<string, { adapterId: string; toolName: string }>;
}> {
  const anthropicTools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }> = [];
  const openaiTools: Array<{ type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }> = [];
  const toolMap = new Map<string, { adapterId: string; toolName: string }>();

  for (const adapter of adapters.values()) {
    let tools: McpToolDescriptor[];
    try {
      tools = await adapter.listTools();
    } catch {
      continue;
    }
    for (const tool of tools) {
      // Prefix with adapter id to avoid name collisions
      const prefixedName = `mcp_${adapter.id}_${tool.name}`;
      const description = `[MCP: ${adapter.id}] ${tool.description}`;

      toolMap.set(prefixedName, { adapterId: adapter.id, toolName: tool.name });

      anthropicTools.push({
        name: prefixedName,
        description,
        input_schema: tool.inputSchema
      });

      openaiTools.push({
        type: "function",
        function: {
          name: prefixedName,
          description,
          parameters: tool.inputSchema
        }
      });
    }
  }

  return { anthropicTools, openaiTools, toolMap };
}

/**
 * Execute a tool via its MCP adapter, returning the result string.
 */
export async function executeMcpTool(
  adapterId: string,
  toolName: string,
  input: Record<string, unknown>
): Promise<string> {
  const adapter = adapters.get(adapterId);
  if (!adapter) return `Error: MCP adapter "${adapterId}" not found`;
  try {
    const result = await adapter.invokeTool(toolName, input);
    return result.ok ? result.output : `Error: ${result.output}`;
  } catch (err) {
    return `Error: MCP tool invocation failed: ${err instanceof Error ? err.message : "unknown error"}`;
  }
}
