import { contextBridge, ipcRenderer } from "electron";

export interface DesktopApi {
  getDashboard(): Promise<unknown>;
  getRuns(): Promise<unknown>;
  getApprovals(): Promise<unknown>;
  getProviders(): Promise<unknown>;
  getSettings(): Promise<unknown>;
  getTraces(runId: string): Promise<unknown>;
  startRun(input: { directory: string; objective: string }): Promise<unknown>;
  resolveApproval(input: { approvalId: string; approved: boolean }): Promise<unknown>;
  onRunStatus(listener: (payload: unknown) => void): () => void;
}

const api: DesktopApi = {
  getDashboard: () => ipcRenderer.invoke("dashboard:get"),
  getRuns: () => ipcRenderer.invoke("runs:list"),
  getApprovals: () => ipcRenderer.invoke("approvals:list"),
  getProviders: () => ipcRenderer.invoke("providers:list"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  getTraces: (runId) => ipcRenderer.invoke("traces:list", runId),
  startRun: (input) => ipcRenderer.invoke("run:start", input),
  resolveApproval: (input) => ipcRenderer.invoke("approval:resolve", input),
  onRunStatus: (listener) => {
    const wrapped = (_event: unknown, payload: unknown) => listener(payload);
    ipcRenderer.on("run:status", wrapped);
    return () => {
      ipcRenderer.removeListener("run:status", wrapped);
    };
  }
};

contextBridge.exposeInMainWorld("autoagent", api);
