type PageKey = "dashboard" | "runs" | "approvals" | "traces" | "settings" | "providers";

const NAV_ITEMS: Array<{ key: PageKey; label: string }> = [
  { key: "dashboard", label: "Dashboard" },
  { key: "runs", label: "Runs" },
  { key: "approvals", label: "Approvals" },
  { key: "traces", label: "Traces" },
  { key: "settings", label: "Settings" },
  { key: "providers", label: "Providers" }
];

interface State {
  page: PageKey;
  logs: string[];
  dashboard: Record<string, unknown> | null;
  runs: Array<Record<string, unknown>>;
  approvals: Array<Record<string, unknown>>;
  traces: Array<Record<string, unknown>>;
  providers: Array<Record<string, unknown>>;
  settings: Record<string, unknown> | null;
}

const state: State = {
  page: "dashboard",
  logs: [],
  dashboard: null,
  runs: [],
  approvals: [],
  traces: [],
  providers: [],
  settings: null
};

function appendLog(line: string): void {
  state.logs.unshift(`${new Date().toLocaleTimeString()} - ${line}`);
  state.logs = state.logs.slice(0, 25);
}

async function refreshAll(): Promise<void> {
  try {
    state.dashboard = (await window.autoagent.getDashboard()) as Record<string, unknown>;
    const runResult = (await window.autoagent.getRuns()) as { runs?: Array<Record<string, unknown>> };
    state.runs = runResult.runs ?? [];
    state.approvals = (await window.autoagent.getApprovals()) as Array<Record<string, unknown>>;
    state.providers = (await window.autoagent.getProviders()) as Array<Record<string, unknown>>;
    state.settings = (await window.autoagent.getSettings()) as Record<string, unknown>;
    render();
  } catch (error) {
    appendLog(`Refresh failed: ${(error as Error).message}`);
    render();
  }
}

async function handlePlay(): Promise<void> {
  const directory = (document.getElementById("play-directory") as HTMLInputElement | null)?.value ?? "";
  const objective = (document.getElementById("play-objective") as HTMLTextAreaElement | null)?.value ?? "";
  appendLog("Play clicked, run starting.");
  render();
  try {
    const result = (await window.autoagent.startRun({ directory, objective })) as {
      run: { runId: string };
      execution: { status: string; reason: string };
    };
    appendLog(`Run ${result.run.runId}: ${result.execution.status} - ${result.execution.reason}`);
    await refreshAll();
  } catch (error) {
    appendLog(`Play failed: ${(error as Error).message}`);
    render();
  }
}

async function handleResolveApproval(approvalId: string, approved: boolean): Promise<void> {
  await window.autoagent.resolveApproval({ approvalId, approved });
  appendLog(`Approval ${approvalId} -> ${approved ? "approved" : "rejected"}`);
  await refreshAll();
}

async function handleTraceLookup(): Promise<void> {
  const runId = (document.getElementById("trace-run-id") as HTMLInputElement | null)?.value ?? "";
  state.traces = (await window.autoagent.getTraces(runId)) as Array<Record<string, unknown>>;
  appendLog(`Loaded traces for ${runId}`);
  render();
}

function renderDashboard(): string {
  const data = state.dashboard ?? {};
  return `
    <div class="stack">
      <div class="row">
        <div class="card kpi"><strong>Total runs</strong><div>${String(data.totalRuns ?? 0)}</div></div>
        <div class="card kpi"><strong>Active runs</strong><div>${String(data.activeRuns ?? 0)}</div></div>
        <div class="card kpi"><strong>Completed</strong><div>${String(data.completedRuns ?? 0)}</div></div>
        <div class="card kpi"><strong>Pending approvals</strong><div>${String(data.pendingApprovals ?? 0)}</div></div>
      </div>
      <div class="card">
        <h3>Play (guarded execution)</h3>
        <label>Directory</label>
        <input id="play-directory" value="c:\\\\Users\\\\josep\\\\Dropbox\\\\Babcanec Works\\\\Programming\\\\AutoAgent" />
        <label>Objective</label>
        <textarea id="play-objective" rows="3">Run guarded local analysis and propose next actions.</textarea>
        <div style="margin-top:12px"><button id="play-button">Play</button></div>
      </div>
    </div>
  `;
}

function renderList(items: Array<Record<string, unknown>>, fields: string[]): string {
  if (items.length === 0) return `<div class="card">No data yet.</div>`;
  return items
    .map((item) => {
      const lines = fields.map((field) => `<div><strong>${field}:</strong> ${String(item[field] ?? "")}</div>`).join("");
      return `<div class="card">${lines}</div>`;
    })
    .join("");
}

function renderApprovals(): string {
  if (state.approvals.length === 0) return `<div class="card">No approvals queued.</div>`;
  return state.approvals
    .map((item) => {
      const id = String(item.id ?? "");
      return `
        <div class="card">
          <div><strong>${id}</strong></div>
          <div class="muted">Run: ${String(item.runId ?? "")}</div>
          <div>Reason: ${String(item.reason ?? "")}</div>
          <div>Status: ${String(item.status ?? "")}</div>
          <div style="margin-top:8px">
            <button data-approve="${id}">Approve</button>
            <button data-reject="${id}" style="margin-left:8px">Reject</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderPageContent(): string {
  if (state.page === "dashboard") return renderDashboard();
  if (state.page === "runs") return renderList(state.runs, ["runId", "projectId", "status", "updatedAt"]);
  if (state.page === "approvals") return renderApprovals();
  if (state.page === "traces") {
    return `
      <div class="stack">
        <div class="card">
          <label>Run ID</label>
          <input id="trace-run-id" value="seed-run-1" />
          <div style="margin-top:8px"><button id="trace-load">Load traces</button></div>
        </div>
        ${renderList(state.traces, ["runId", "timestamp", "eventType"])}
      </div>
    `;
  }
  if (state.page === "settings") return renderList(state.settings ? [state.settings] : [], ["requireApproval"]);
  return renderList(state.providers, ["id", "displayName", "kind", "baseUrl", "defaultModel"]);
}

function render(): void {
  const app = document.getElementById("app");
  if (!app) return;
  app.innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <h2 style="margin-top:0">AutoAgent Desktop</h2>
        <p class="muted">local app runtime</p>
        <div class="nav">
          ${NAV_ITEMS.map((item) => `<button data-nav="${item.key}" class="${state.page === item.key ? "active" : ""}">${item.label}</button>`).join("")}
        </div>
      </aside>
      <main class="content">
        <header class="card" style="margin-bottom:12px"><strong>${state.page.toUpperCase()}</strong></header>
        <section class="stack">
          ${renderPageContent()}
          <div class="card">
            <h3>Run Log</h3>
            ${state.logs.length === 0 ? "<div class='muted'>No events yet.</div>" : state.logs.map((x) => `<div>${x}</div>`).join("")}
          </div>
        </section>
      </main>
    </div>
  `;

  document.querySelectorAll("[data-nav]").forEach((element) => {
    element.addEventListener("click", () => {
      state.page = (element.getAttribute("data-nav") as PageKey) ?? "dashboard";
      render();
    });
  });
  document.getElementById("play-button")?.addEventListener("click", () => {
    void handlePlay();
  });
  document.getElementById("trace-load")?.addEventListener("click", () => {
    void handleTraceLookup();
  });
  document.querySelectorAll("[data-approve]").forEach((element) => {
    element.addEventListener("click", () => {
      const id = element.getAttribute("data-approve");
      if (id) void handleResolveApproval(id, true);
    });
  });
  document.querySelectorAll("[data-reject]").forEach((element) => {
    element.addEventListener("click", () => {
      const id = element.getAttribute("data-reject");
      if (id) void handleResolveApproval(id, false);
    });
  });
}

window.autoagent.onRunStatus((payload) => {
  appendLog(`run status: ${JSON.stringify(payload)}`);
  render();
});

void refreshAll();
render();
