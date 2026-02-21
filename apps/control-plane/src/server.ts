import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { handleApprovalsRoute } from "./routes/approvals.js";
import { handleDashboardRoute } from "./routes/dashboard.js";
import { handleProvidersRoute } from "./routes/providers.js";
import { handleRunsRoute } from "./routes/runs.js";
import { handleSettingsRoute } from "./routes/settings.js";
import { handleTracesRoute } from "./routes/traces.js";
import type { RouteContext, RouteResult } from "./routes/routeTypes.js";
import { ApprovalStore } from "./stores/approvalStore.js";
import { ProviderStore } from "./stores/providerStore.js";
import { RunStore } from "./stores/runStore.js";
import { SettingsStore } from "./stores/settingsStore.js";
import { TraceStore } from "./stores/traceStore.js";

const ctx: RouteContext = {
  runs: new RunStore(),
  approvals: new ApprovalStore(),
  traces: new TraceStore(),
  providers: new ProviderStore(),
  settings: new SettingsStore()
};

function setCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  if (chunks.length === 0) return undefined;
  const value = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function route(pathname: string, method: string, body: unknown): RouteResult | undefined {
  return (
    handleDashboardRoute(pathname, method, ctx) ??
    handleRunsRoute(pathname, method, body, ctx) ??
    handleApprovalsRoute(pathname, method, body, ctx) ??
    handleTracesRoute(pathname, method, ctx) ??
    handleSettingsRoute(pathname, method, body, ctx) ??
    handleProvidersRoute(pathname, method, ctx)
  );
}

const server = createServer(async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") {
    sendJson(res, 200, { ok: true });
    return;
  }

  const requestUrl = new URL(req.url ?? "/", "http://localhost:8080");
  const method = req.method ?? "GET";
  const body = await readBody(req);

  const result = route(requestUrl.pathname, method, body);
  if (!result) {
    sendJson(res, 404, { error: "Route not found" });
    return;
  }
  sendJson(res, result.status, result.body);
});

const port = Number(process.env.PORT ?? "8080");
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Control-plane listening on http://localhost:${port}`);
});
