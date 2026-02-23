import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Clock, Inbox, Trash2 } from "lucide-react";
import type { RunItem, TraceItem } from "../../lib/types.js";
import type { RunLifecycleState, RunStatusEvent } from "../../shared/ipc.js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "../components/EmptyState";
import { AgentExecutionView, type SessionStats } from "../components/AgentExecutionView";
import { cn } from "@/lib/utils";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  queued: "outline",
  running: "default",
  completed: "secondary",
  failed: "destructive",
  cancelled: "outline",
  awaiting_approval: "default",
};

const STATUS_DOT: Record<string, string> = {
  queued: "bg-gray-400",
  running: "bg-blue-500 animate-pulse",
  completed: "bg-green-500",
  failed: "bg-red-500",
  cancelled: "bg-gray-400",
  awaiting_approval: "bg-yellow-500 animate-pulse",
};

export function RunsPage({
  runs,
  traces,
  expandedRunId,
  liveSteps,
  liveResponse,
  runStatus,
  sessionStats,
  onExpandRun,
  onDeleteRun,
  onRefreshTraces,
  runMetrics,
  onResumeRun,
  onRetryRun,
  onAbortRun,
}: {
  runs: RunItem[];
  traces: TraceItem[];
  expandedRunId: string | null;
  liveSteps: RunStatusEvent[];
  liveResponse: string | null;
  runStatus: RunLifecycleState;
  sessionStats: SessionStats;
  onExpandRun: (runId: string | null) => void;
  onDeleteRun: (runId: string) => void;
  onRefreshTraces: (runId: string) => void;
  runMetrics: Record<string, { tokenTotal: number; retries: number; estimatedCostUsd: number }>;
  onResumeRun: (runId: string) => void | Promise<void>;
  onRetryRun: (runId: string) => void | Promise<void>;
  onAbortRun: (runId: string) => void | Promise<void>;
}): React.JSX.Element {
  const isExecuting = runStatus !== "idle" && runStatus !== "completed" && runStatus !== "failed";

  if (runs.length === 0 && !isExecuting) {
    return (
      <EmptyState
        icon={Inbox}
        title="No tasks yet"
        description="Start one from the Home page."
      />
    );
  }

  return (
    <div className="space-y-2">
      {/* Placeholder card while run is being created but not yet in the list */}
      {isExecuting && runs.length === 0 && (
        <Card className="ring-1 ring-primary/30">
          <CardContent className="p-0">
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
              <div className="flex-1">
                <p className="text-sm font-medium">Starting task...</p>
              </div>
              <Badge variant="default">creating</Badge>
            </div>
            {liveSteps.length > 0 && (
              <div className="border-t">
                <AgentExecutionView steps={liveSteps} sessionStats={sessionStats} isExecuting={true} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {runs.map((run) => {
        const isExpanded = expandedRunId === run.runId;
        const isActiveRun = liveSteps.length > 0 && liveSteps.some((s) => s.runId === run.runId);
        return (
          <TaskCard
            key={run.runId}
            run={run}
            isExpanded={isExpanded}
            traces={isExpanded ? traces : []}
            liveSteps={isActiveRun ? liveSteps.filter((s) => s.runId === run.runId) : []}
            liveResponse={isActiveRun ? liveResponse : null}
            isActiveRun={isActiveRun}
            sessionStats={sessionStats}
            isExecuting={isActiveRun && isExecuting}
            onToggle={() => onExpandRun(isExpanded ? null : run.runId)}
            onDelete={() => onDeleteRun(run.runId)}
            onRefreshTraces={() => onRefreshTraces(run.runId)}
            metrics={runMetrics[run.runId]}
            onResume={() => onResumeRun(run.runId)}
            onRetry={() => onRetryRun(run.runId)}
            onAbort={() => onAbortRun(run.runId)}
          />
        );
      })}
    </div>
  );
}

function TaskCard({
  run,
  isExpanded,
  traces,
  liveSteps,
  liveResponse,
  isActiveRun,
  sessionStats,
  isExecuting,
  onToggle,
  onDelete,
  onRefreshTraces,
  metrics,
  onResume,
  onRetry,
  onAbort
}: {
  run: RunItem;
  isExpanded: boolean;
  traces: TraceItem[];
  liveSteps: RunStatusEvent[];
  liveResponse: string | null;
  isActiveRun: boolean;
  sessionStats: SessionStats;
  isExecuting: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onRefreshTraces: () => void;
  metrics: { tokenTotal: number; retries: number; estimatedCostUsd: number } | undefined;
  onResume: () => void | Promise<void>;
  onRetry: () => void | Promise<void>;
  onAbort: () => void | Promise<void>;
}): React.JSX.Element {
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Build execution steps from traces for completed runs (when no live steps)
  const displaySteps = useMemo((): RunStatusEvent[] => {
    if (isActiveRun && liveSteps.length > 0) return liveSteps;

    // Reconstruct steps from traces for historical runs
    if (!isExpanded || traces.length === 0) return [];
    return traces.map((trace): RunStatusEvent => {
      const base: RunStatusEvent = {
        runId: run.runId,
        state: "completed",
        message: "",
        timestamp: trace.timestamp,
      };
      if (trace.eventType === "llm.text") {
        base.type = "llm_text";
        base.message = String(trace.payload.text ?? "").slice(0, 500);
        base.detail = String(trace.payload.text ?? "");
        if (typeof trace.payload.turn === "number") base.turn = trace.payload.turn;
      } else if (trace.eventType === "agent.tool_call") {
        base.type = "tool_call";
        base.toolName = String(trace.payload.tool ?? "");
        base.message = `${trace.payload.tool}: ${summarizePayload(trace.payload)}`;
        base.toolInput = summarizeToolInput(trace.payload);
        if (typeof trace.payload.turn === "number") base.turn = trace.payload.turn;
      } else if (trace.eventType === "agent.tool_result") {
        base.type = "tool_result";
        base.toolName = String(trace.payload.tool ?? "");
        base.message = String(trace.payload.result ?? "").slice(0, 200);
        base.detail = String(trace.payload.result ?? "");
        if (typeof trace.payload.turn === "number") base.turn = trace.payload.turn;
      } else if (trace.eventType === "llm.response") {
        base.type = "info";
        base.message = "Execution complete";
      } else {
        base.type = "info";
        base.message = `${trace.eventType}: ${summarizePayload(trace.payload)}`;
      }
      return base;
    });
  }, [isActiveRun, liveSteps, isExpanded, traces, run.runId]);

  // Build stats from traces for historical runs
  const displayStats = useMemo((): SessionStats => {
    if (isActiveRun) return sessionStats;

    // Derive from traces
    let totalInput = 0;
    let totalOutput = 0;
    let totalActions = 0;
    let maxTurn = 0;
    let model: string | null = null;
    for (const trace of traces) {
      if (trace.eventType === "llm.response") {
        if (typeof trace.payload.totalInputTokens === "number") totalInput = trace.payload.totalInputTokens;
        if (typeof trace.payload.totalOutputTokens === "number") totalOutput = trace.payload.totalOutputTokens;
        if (typeof trace.payload.actionCount === "number") totalActions = trace.payload.actionCount;
      }
      if (typeof trace.payload.turn === "number" && trace.payload.turn > maxTurn) {
        maxTurn = trace.payload.turn;
      }
      if (trace.eventType === "llm.request" && typeof trace.payload.model === "string") {
        model = trace.payload.model;
      }
    }
    return { totalInput, totalOutput, totalActions, turns: maxTurn, model, startedAt: run.createdAt };
  }, [isActiveRun, sessionStats, traces, run.createdAt]);

  // Final response text
  const responseContent = useMemo(() => {
    if (liveResponse && isActiveRun) return liveResponse;
    const llmTrace = traces.find((t) => t.eventType === "llm.response");
    if (llmTrace && typeof llmTrace.payload.response === "string") {
      return llmTrace.payload.response;
    }
    return null;
  }, [liveResponse, isActiveRun, traces]);

  return (
    <Card className={cn("transition-colors", isExpanded && "ring-1 ring-primary/30")}>
      <CardContent className="p-0">
        {/* Header row */}
        <button
          className="flex items-center gap-3 w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors rounded-t-lg"
          onClick={onToggle}
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className={cn("h-2 w-2 rounded-full shrink-0", STATUS_DOT[run.status] ?? "bg-gray-400")} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium leading-none truncate">
              {run.summary ?? run.runId}
            </p>
          </div>
          <Badge variant={STATUS_VARIANT[run.status] ?? "outline"} className="shrink-0">
            {run.status.replaceAll("_", " ")}
          </Badge>
          <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatRelativeTime(run.updatedAt)}
          </span>
        </button>

        {/* Expanded details */}
        {isExpanded && (
          <div className="border-t space-y-3">
            {/* Execution view — the main display */}
            {displaySteps.length > 0 && (
              <div className="px-3 pt-3">
                <AgentExecutionView
                  steps={displaySteps}
                  sessionStats={displayStats}
                  isExecuting={isExecuting}
                />
              </div>
            )}

            {/* Final response — shown below execution view for completed runs */}
            {!isExecuting && responseContent && (
              <ResponseView content={responseContent} />
            )}

            {/* Actions */}
            <div className="flex justify-end px-4 pb-3 pt-1 border-t">
              <div className="mr-auto text-xs text-muted-foreground flex items-center gap-3">
                <span>Tokens: {metrics?.tokenTotal ?? 0}</span>
                <span>Retries: {metrics?.retries ?? 0}</span>
                <span>Cost: ${metrics?.estimatedCostUsd?.toFixed(4) ?? "0.0000"}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onResume}>
                  Resume
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onRetry}>
                  Retry
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onAbort}>
                  Abort
                </Button>
              </div>
              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Delete this task and its logs?</span>
                  <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={onDelete}>
                    Confirm
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground hover:text-destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="h-3 w-3 mr-1" />
                  Delete
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ResponseView({ content }: { content: string }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const isLong = content.length > 800;

  return (
    <div className="px-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">Response</span>
        {isLong && (
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Collapse" : "Show full response"}
          </Button>
        )}
      </div>
      <div
        className={cn(
          "bg-muted/30 border rounded-md p-4 text-sm leading-relaxed whitespace-pre-wrap break-words overflow-auto transition-[max-height] duration-300 ease-in-out",
          expanded ? "max-h-[600px]" : "max-h-48"
        )}
      >
        {content}
      </div>
    </div>
  );
}

function summarizePayload(payload: Record<string, unknown>): string {
  if (typeof payload.status === "string") return payload.status;
  if (typeof payload.reason === "string") return payload.reason;
  if (typeof payload.message === "string") return String(payload.message);
  if (typeof payload.text === "string") return String(payload.text).slice(0, 120);
  const keys = Object.keys(payload);
  if (keys.length === 0) return "";
  return keys.join(", ");
}

function summarizeToolInput(payload: Record<string, unknown>): string {
  const input = payload.input as Record<string, unknown> | undefined;
  if (!input) return "";
  if (typeof input.path === "string") return input.path;
  if (typeof input.command === "string") return String(input.command).slice(0, 120);
  return "";
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
