import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONTROL_PLANE_BASE = process.env.AUTOAGENT_API_URL ?? "http://localhost:8080";

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js")
    }
  });

  const htmlPath = path.join(__dirname, "../src/renderer.html");
  mainWindow.loadFile(htmlPath);
}

async function requestJson(pathname: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${CONTROL_PLANE_BASE}${pathname}`, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Request failed ${pathname}: ${response.status} ${text}`);
  }
  return (await response.json()) as unknown;
}

function emitRunStatus(payload: unknown): void {
  mainWindow?.webContents.send("run:status", payload);
}

async function requestExecutionApproval(detail: string): Promise<boolean> {
  if (!mainWindow) return false;
  emitRunStatus({ stage: "approval.request", message: detail });
  const response = await dialog.showMessageBox(mainWindow, {
    type: "question",
    title: "Approval required",
    message: "Approve guarded execution?",
    detail,
    buttons: ["Approve", "Reject"],
    defaultId: 0,
    cancelId: 1
  });
  return response.response === 0;
}

ipcMain.handle("dashboard:get", async () => requestJson("/api/dashboard/stats"));
ipcMain.handle("runs:list", async () => requestJson("/api/runs"));
ipcMain.handle("approvals:list", async () => requestJson("/api/approvals"));
ipcMain.handle("providers:list", async () => requestJson("/api/providers"));
ipcMain.handle("settings:get", async () => requestJson("/api/settings"));
ipcMain.handle("traces:list", async (_event, runId: string) => requestJson(`/api/traces/${encodeURIComponent(runId)}`));

ipcMain.handle("approval:resolve", async (_event, input: { approvalId: string; approved: boolean }) =>
  requestJson(`/api/approvals/${encodeURIComponent(input.approvalId)}/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ approved: input.approved })
  })
);

ipcMain.handle("run:start", async (_event, input: { directory: string; objective: string }) => {
  const run = (await requestJson("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: "local-desktop", objective: input.objective })
  })) as { runId: string };

  emitRunStatus({ runId: run.runId, stage: "created", message: "Run created." });

  const approved = await requestExecutionApproval(`exec (high)\nanalyze directory ${input.directory}`);
  emitRunStatus({ runId: run.runId, stage: "approval.resolve", approved });
  const execution = approved
    ? { status: "executed", reason: `Executed in sandbox: analyze directory ${input.directory}` }
    : { status: "awaiting_approval", reason: "Approval required before execution." };

  emitRunStatus({
    runId: run.runId,
    stage: execution.status,
    message: execution.reason
  });

  return { run, execution };
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
