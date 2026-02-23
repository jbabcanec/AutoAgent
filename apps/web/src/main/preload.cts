const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

const IPC_CHANNELS = {
  fetchDashboard: "data.fetch.dashboard",
  fetchRuns: "data.fetch.runs",
  fetchApprovals: "data.fetch.approvals",
  fetchProviders: "data.fetch.providers",
  fetchProvider: "data.fetch.provider",
  createProvider: "data.create.provider",
  updateProvider: "data.update.provider",
  fetchSettings: "data.fetch.settings",
  updateSettings: "data.update.settings",
  fetchTraces: "data.fetch.traces",
  fetchRunMetrics: "data.fetch.runMetrics",
  deleteRun: "data.delete.run",
  runStart: "run.start",
  runResume: "run.resume",
  runRetry: "run.retry",
  runAbort: "run.abort",
  runQuickLaunch: "run.quickLaunch",
  runChatTrial: "run.trial.chat",
  runRepoTrial: "run.trial.repo",
  runStatus: "run.status",
  approvalResolve: "approval.resolve",
  keychainStoreApiKey: "keychain.store.apiKey",
  keychainDeleteApiKey: "keychain.delete.apiKey",
  keychainGetApiKeyStatus: "keychain.get.apiKeyStatus",
  dialogSelectDirectory: "dialog.selectDirectory",
  fsReadDirectory: "fs.readDirectory",
  fsReadFile: "fs.readFile"
} as const;

const api = {
  fetchDashboard: () => ipcRenderer.invoke(IPC_CHANNELS.fetchDashboard),
  fetchRuns: async () => {
    const payload = (await ipcRenderer.invoke(IPC_CHANNELS.fetchRuns)) as { runs: unknown[] };
    return payload.runs as never[];
  },
  fetchApprovals: () => ipcRenderer.invoke(IPC_CHANNELS.fetchApprovals),
  fetchProviders: () => ipcRenderer.invoke(IPC_CHANNELS.fetchProviders),
  fetchProvider: (providerId: string) => ipcRenderer.invoke(IPC_CHANNELS.fetchProvider, providerId),
  createProvider: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.createProvider, input),
  updateProvider: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.updateProvider, input),
  fetchSettings: () => ipcRenderer.invoke(IPC_CHANNELS.fetchSettings),
  updateSettings: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.updateSettings, input),
  fetchTraces: (runId: string) => ipcRenderer.invoke(IPC_CHANNELS.fetchTraces, runId),
  fetchRunMetrics: (runId: string) => ipcRenderer.invoke(IPC_CHANNELS.fetchRunMetrics, runId),
  deleteRun: (runId: string) => ipcRenderer.invoke(IPC_CHANNELS.deleteRun, runId),
  startRun: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.runStart, input),
  resumeRun: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.runResume, input),
  retryRun: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.runRetry, input),
  abortRun: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.runAbort, input),
  runQuickLaunch: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.runQuickLaunch, input),
  runChatTrial: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.runChatTrial, input),
  runRepoTrial: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.runRepoTrial, input),
  resolveApproval: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.approvalResolve, input),
  keychainStoreApiKey: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.keychainStoreApiKey, input),
  keychainDeleteApiKey: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.keychainDeleteApiKey, input),
  keychainGetApiKeyStatus: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.keychainGetApiKeyStatus, input),
  dialogSelectDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.dialogSelectDirectory),
  fsReadDirectory: (dirPath: string) => ipcRenderer.invoke(IPC_CHANNELS.fsReadDirectory, dirPath),
  fsReadFile: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.fsReadFile, filePath),
  onRunStatus: (listener: (event: unknown) => void) => {
    const wrapped = (_event: unknown, payload: unknown) => listener(payload);
    ipcRenderer.on(IPC_CHANNELS.runStatus, wrapped);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.runStatus, wrapped);
    };
  }
};

contextBridge.exposeInMainWorld("autoagent", api);
