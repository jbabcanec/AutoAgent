import { Component, type ReactNode, useEffect, useMemo, useState } from "react";
import { AlertCircle, FolderOpen, Home, ListTodo, Plug, Settings, ShieldCheck } from "lucide-react";
import type { ApprovalItem, DashboardStats, ProviderItem, RunItem, SettingsItem, TraceItem, UserPromptItem } from "../lib/types.js";
import type { FollowUpAction, RunLifecycleState, RunStatusEvent } from "../shared/ipc.js";
import type { SessionStats } from "./components/AgentExecutionView";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { OnboardingFlow } from "./components/OnboardingFlow";
import { ShellLayout } from "./components/ShellLayout";
import { SidebarNav } from "./components/SidebarNav";
import { StatusBadge } from "./components/StatusBadge";
import { ApprovalsPage } from "./pages/ApprovalsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ProvidersPage } from "./pages/ProvidersPage";
import { RunsPage } from "./pages/RunsPage";
import { FileBrowserPage } from "./pages/FileBrowserPage";
import { SettingsPage } from "./pages/SettingsPage";

type PageKey = "dashboard" | "runs" | "approvals" | "files" | "providers" | "settings";

interface AppState {
  page: PageKey;
  status: RunLifecycleState;
  expandedRunId: string | null;
  dashboard: DashboardStats | null;
  runs: RunItem[];
  approvals: ApprovalItem[];
  traces: TraceItem[];
  providers: ProviderItem[];
  settings: SettingsItem | null;
  logs: string[];
  loading: boolean;
  startupError: string | null;
}

const NAV_ITEMS: Array<{ key: PageKey; label: string; icon: React.ElementType }> = [
  { key: "dashboard", label: "Home", icon: Home },
  { key: "runs", label: "Tasks", icon: ListTodo },
  { key: "approvals", label: "Approvals", icon: ShieldCheck },
  { key: "files", label: "Files", icon: FolderOpen },
  { key: "providers", label: "Connections", icon: Plug },
  { key: "settings", label: "Settings", icon: Settings }
];

const initialState: AppState = {
  page: "dashboard",
  status: "idle",
  expandedRunId: null,
  dashboard: null,
  runs: [],
  approvals: [],
  traces: [],
  providers: [],
  settings: null,
  logs: [],
  loading: true,
  startupError: null
};

export function App(): React.JSX.Element {
  const [state, setState] = useState<AppState>(initialState);
  const [playDirectory, setPlayDirectory] = useState("c:\\Users\\josep\\Dropbox\\Babcanec Works\\Programming\\AutoAgent");
  const [playObjective, setPlayObjective] = useState("Run guarded local analysis and propose next actions.");
  const [activeProviderId, setActiveProviderId] = useState<string>("openai-default");
  const [setupNotice, setSetupNotice] = useState<string | undefined>(undefined);
  const [taskNotice, setTaskNotice] = useState<string | undefined>(undefined);
  const [liveSteps, setLiveSteps] = useState<RunStatusEvent[]>([]);
  const [liveResponse, setLiveResponse] = useState<string | null>(null);
  const [runMetrics, setRunMetrics] = useState<
    Record<
      string,
      {
        tokenTotal: number;
        retries: number;
        estimatedCostUsd: number;
        verificationPassed: number;
        verificationFailed: number;
        egressDenied: number;
        transientRetries: number;
        providerRetries: number;
        toolRetries: number;
        policyRetries: number;
        planningEvents: number;
        reflectionEvents: number;
        cacheHits: number;
        cacheMisses: number;
      }
    >
  >({});
  const [promptsByRun, setPromptsByRun] = useState<Record<string, UserPromptItem[]>>({});
  const [followUpActionsByRun, setFollowUpActionsByRun] = useState<Record<string, FollowUpAction[]>>({});

  const sessionStats = useMemo((): SessionStats => {
    let totalInput = 0;
    let totalOutput = 0;
    let totalActions = 0;
    let maxTurn = 0;
    let model: string | null = null;
    let startedAt: string | null = null;
    for (const step of liveSteps) {
      if (step.tokenUsage) {
        totalInput += step.tokenUsage.input;
        totalOutput += step.tokenUsage.output;
      }
      if (step.type === "tool_call") totalActions++;
      if (step.turn && step.turn > maxTurn) maxTurn = step.turn;
      if (step.model && !model) model = step.model;
      if (!startedAt) startedAt = step.timestamp;
    }
    return { totalInput, totalOutput, totalActions, turns: maxTurn, model, startedAt };
  }, [liveSteps]);

  useEffect(() => {
    const unsubscribe = window.autoagent.onRunStatus((event) => {
      setState((prev) => ({
        ...prev,
        status: event.state,
        logs: [`${formatEvent(event)}`, ...prev.logs].slice(0, 40)
      }));
      setLiveSteps((prev) => [...prev.slice(-99), event]);
      if (event.state === "completed" && event.detail) {
        setLiveResponse(event.detail);
      }
      if (event.type === "follow_up" && event.followUpActions) {
        setFollowUpActionsByRun((prev) => ({ ...prev, [event.runId]: event.followUpActions ?? [] }));
      }
    });
    void refreshAll();
    return unsubscribe;
  }, []);

  async function refreshAll(): Promise<void> {
    setState((prev) => ({ ...prev, loading: true, startupError: null }));
    try {
      const [dashboard, runs, approvals, providers, settings] = await Promise.all([
        window.autoagent.fetchDashboard(),
        window.autoagent.fetchRuns(),
        window.autoagent.fetchApprovals(),
        window.autoagent.fetchProviders(),
        window.autoagent.fetchSettings()
      ]);
      setState((prev) => ({
        ...prev,
        dashboard,
        runs,
        approvals,
        providers,
        settings,
        loading: false
      }));
      if (providers.length > 0) {
        const withKey = providers.find((p) => p.apiKeyStored);
        const fallbackProviderId = withKey?.id ?? providers[0]?.id ?? "openai-default";
        setActiveProviderId((prev) => (providers.some((provider) => provider.id === prev) ? prev : fallbackProviderId));
      }
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        startupError: error instanceof Error ? error.message : "Failed to initialize desktop app."
      }));
    }
  }

  async function loadTraces(runId: string): Promise<void> {
    try {
      const traces = await window.autoagent.fetchTraces(runId);
      setState((prev) => ({ ...prev, expandedRunId: runId, traces }));
      const prompts = await window.autoagent.fetchUserPrompts(runId);
      setPromptsByRun((prev) => ({ ...prev, [runId]: prompts }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        logs: [`Trace load failed: ${error instanceof Error ? error.message : "Unknown error"}`, ...prev.logs]
      }));
    }
  }

  async function loadRunMetrics(runId: string): Promise<void> {
    try {
      const metrics = (await window.autoagent.fetchRunMetrics(runId)) as {
        tokenTotal: number;
        retries: number;
        estimatedCostUsd: number;
        verificationPassed: number;
        verificationFailed: number;
        egressDenied: number;
        transientRetries: number;
        providerRetries: number;
        toolRetries: number;
        policyRetries: number;
        planningEvents: number;
        reflectionEvents: number;
        cacheHits: number;
        cacheMisses: number;
      };
      setRunMetrics((prev) => ({ ...prev, [runId]: metrics }));
    } catch {
      // best effort
    }
  }

  async function deleteRun(runId: string): Promise<void> {
    await window.autoagent.deleteRun(runId);
    setState((prev) => ({
      ...prev,
      expandedRunId: prev.expandedRunId === runId ? null : prev.expandedRunId,
      traces: prev.expandedRunId === runId ? [] : prev.traces
    }));
    await refreshAll();
  }

  async function answerPrompt(promptId: string, responseText: string): Promise<void> {
    await window.autoagent.answerUserPrompt({ promptId, responseText });
    if (state.expandedRunId) {
      await loadTraces(state.expandedRunId);
    }
  }

  async function executeFollowUp(runId: string, objective: string): Promise<void> {
    const result = await window.autoagent.executeFollowUp({ runId, objective });
    setState((prev) => ({ ...prev, expandedRunId: result.run.runId, page: "runs" }));
    await refreshAll();
    await loadTraces(result.run.runId);
    const followups = await window.autoagent.getFollowUpSuggestions({ runId: result.run.runId });
    setFollowUpActionsByRun((prev) => ({ ...prev, [result.run.runId]: followups }));
  }

  async function handlePlay(): Promise<void> {
    setTaskNotice(undefined);
    setLiveSteps([]);
    setLiveResponse(null);
    setState((prev) => ({ ...prev, status: "creating_run", page: "runs" }));
    try {
      const result = await window.autoagent.runQuickLaunch({ providerId: activeProviderId, directory: playDirectory, objective: playObjective });
      setState((prev) => ({
        ...prev,
        logs: [`Run ${result.run.runId}: ${result.execution.status}`, ...prev.logs].slice(0, 40),
        expandedRunId: result.run.runId
      }));
      setPlayObjective("");
      await refreshAll();
      await loadTraces(result.run.runId);
      const followups = await window.autoagent.getFollowUpSuggestions({ runId: result.run.runId });
      setFollowUpActionsByRun((prev) => ({ ...prev, [result.run.runId]: followups }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        status: "failed",
        logs: [`Play failed: ${error instanceof Error ? error.message : "Unknown error"}`, ...prev.logs].slice(0, 40)
      }));
    }
  }

  async function resolveApproval(approvalId: string, approved: boolean): Promise<void> {
    await window.autoagent.resolveApproval({ approvalId, approved });
    await refreshAll();
  }

  async function saveProviderAndKey(input: {
    id: string;
    displayName: string;
    kind: "openai-compatible" | "anthropic-compatible" | "custom";
    baseUrl: string;
    defaultModel: string;
    apiKey: string;
  }): Promise<ProviderItem> {
    const existing = state.providers.find((provider) => provider.id === input.id);
    let provider: ProviderItem;
    if (existing) {
      provider = await window.autoagent.updateProvider({
        id: existing.id,
        updates: {
          displayName: input.displayName,
          kind: input.kind,
          baseUrl: input.baseUrl,
          defaultModel: input.defaultModel
        }
      });
    } else {
      provider = await window.autoagent.createProvider({
        id: input.id,
        displayName: input.displayName,
        kind: input.kind,
        baseUrl: input.baseUrl,
        defaultModel: input.defaultModel,
        apiKeyStored: true
      });
    }
    await window.autoagent.keychainStoreApiKey({ providerId: provider.id, apiKey: input.apiKey });
    const updated = await window.autoagent.updateProvider({
      id: provider.id,
      updates: { apiKeyStored: true }
    });
    setActiveProviderId(updated.id);
    setSetupNotice("Connection saved securely. You are ready to start tasks.");
    // Refresh providers without triggering full loading skeleton
    const [providers, settings] = await Promise.all([
      window.autoagent.fetchProviders(),
      window.autoagent.fetchSettings()
    ]);
    setState((prev) => ({ ...prev, providers, settings }));
    return updated;
  }

  async function runChatTrial(prompt: string): Promise<string> {
    const result = await window.autoagent.runChatTrial({ providerId: activeProviderId, prompt });
    return result.text;
  }

  async function runRepoTrial(input: { directory: string; objective: string }): Promise<string> {
    const result = await window.autoagent.runRepoTrial({ providerId: activeProviderId, ...input });
    return result.text;
  }

  async function completeOnboarding(trialCompleted: "chat" | "repo" | "both"): Promise<void> {
    await window.autoagent.updateSettings({
      hasCompletedOnboarding: true,
      trialTaskCompleted: trialCompleted,
      onboardingCompletedAt: new Date().toISOString()
    });
    setSetupNotice("Setup complete. Next step: start your first task from Home.");
    setState((prev) => ({ ...prev, page: "dashboard" }));
    await refreshAll();
  }

  const content = useMemo(() => {
    if (state.loading) {
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        </div>
      );
    }
    if (state.startupError) {
      return (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Startup Error</AlertTitle>
          <AlertDescription>{state.startupError}</AlertDescription>
        </Alert>
      );
    }

    if (state.page === "dashboard") {
      return (
        <DashboardPage
          dashboard={state.dashboard}
          providers={state.providers}
          activeProviderId={activeProviderId}
          playDirectory={playDirectory}
          playObjective={playObjective}
          onSetActiveProvider={setActiveProviderId}
          onQuickConnect={(input) =>
            saveProviderAndKey({
              id: input.providerId,
              displayName: input.displayName,
              kind: "openai-compatible",
              baseUrl: input.baseUrl,
              defaultModel: input.defaultModel,
              apiKey: input.apiKey
            }).then(() => undefined)
          }
          onChangeDirectory={setPlayDirectory}
          onChangeObjective={setPlayObjective}
          onPlay={handlePlay}
          setupNotice={setupNotice}
          taskNotice={taskNotice}
        />
      );
    }

    if (state.page === "runs") {
      return (
        <RunsPage
          runs={state.runs}
          traces={state.traces}
          expandedRunId={state.expandedRunId}
          liveSteps={liveSteps}
          liveResponse={liveResponse}
          runStatus={state.status}
          sessionStats={sessionStats}
          onExpandRun={(runId) => {
            if (runId) {
              void loadTraces(runId);
              void loadRunMetrics(runId);
            } else {
              setState((prev) => ({ ...prev, expandedRunId: null, traces: [] }));
            }
          }}
          onDeleteRun={(runId) => void deleteRun(runId)}
          onRefreshTraces={(runId) => void loadTraces(runId)}
          runMetrics={runMetrics}
          onResumeRun={async (runId) => {
            await window.autoagent.resumeRun({ runId });
            await refreshAll();
            await loadTraces(runId);
            await loadRunMetrics(runId);
          }}
          onRetryRun={async (runId) => {
            await window.autoagent.retryRun({ runId });
            await refreshAll();
            await loadTraces(runId);
            await loadRunMetrics(runId);
          }}
          onAbortRun={async (runId) => {
            await window.autoagent.abortRun({ runId });
            await refreshAll();
            await loadTraces(runId);
            await loadRunMetrics(runId);
          }}
          promptsByRun={promptsByRun}
          onAnswerPrompt={(promptId, responseText) => void answerPrompt(promptId, responseText)}
          followUpActionsByRun={followUpActionsByRun}
          onExecuteFollowUp={(runId, objective) => void executeFollowUp(runId, objective)}
        />
      );
    }

    if (state.page === "approvals") {
      return <ApprovalsPage approvals={state.approvals} onResolve={(id, approved) => void resolveApproval(id, approved)} />;
    }

    if (state.page === "files") {
      return <FileBrowserPage rootDirectory={playDirectory} />;
    }

    if (state.page === "settings") {
      return (
        <SettingsPage
          settings={state.settings}
          onUpdate={async (input) => {
            await window.autoagent.updateSettings(input);
            await refreshAll();
          }}
        />
      );
    }

    return <ProvidersPage providers={state.providers} onSetActive={setActiveProviderId} activeProviderId={activeProviderId} />;
  }, [
    state,
    playDirectory,
    playObjective,
    activeProviderId,
    setupNotice,
    taskNotice,
    liveSteps,
    liveResponse,
    sessionStats,
    promptsByRun,
    followUpActionsByRun
  ]);

  if (state.loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="space-y-3 text-center">
          <Skeleton className="h-8 w-48 mx-auto" />
          <Skeleton className="h-4 w-32 mx-auto" />
        </div>
      </div>
    );
  }

  if (!state.settings?.hasCompletedOnboarding) {
    return (
      <OnboardingFlow
        providers={state.providers}
        onSaveProviderAndKey={saveProviderAndKey}
        onRunChatTrial={async (providerId, prompt) => {
          setActiveProviderId(providerId);
          const result = await window.autoagent.runChatTrial({ providerId, prompt });
          return result.text;
        }}
        onRunRepoTrial={async (providerId, input) => {
          setActiveProviderId(providerId);
          const result = await window.autoagent.runRepoTrial({ providerId, ...input });
          return result.text;
        }}
        onComplete={completeOnboarding}
      />
    );
  }

  return (
    <DesktopErrorBoundary>
      <ShellLayout
        sidebar={
          <SidebarNav
            status={<StatusBadge value={state.status} />}
            items={NAV_ITEMS}
            activeKey={state.page}
            onSelect={(key) => setState((prev) => ({ ...prev, page: key as PageKey }))}
          />
        }
        title={NAV_ITEMS.find((item) => item.key === state.page)?.label ?? "AutoAgent"}
        onRefresh={() => void refreshAll()}
      >
        <div key={state.page} className="animate-page-enter">
          {content}
        </div>
      </ShellLayout>
    </DesktopErrorBoundary>
  );
}

class DesktopErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  public constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  public static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-full items-center justify-center p-8">
          <Alert variant="destructive" className="max-w-md">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Something went wrong</AlertTitle>
            <AlertDescription>The renderer failed to initialize. Check desktop logs for details.</AlertDescription>
          </Alert>
        </div>
      );
    }
    return this.props.children;
  }
}

function formatEvent(event: RunStatusEvent): string {
  return `${new Date(event.timestamp).toLocaleTimeString()} [${event.state}] ${event.message}`;
}
