import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, File, FolderOpen, Terminal, XCircle } from "lucide-react";
import type { RunStatusEvent } from "../../shared/ipc.js";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";

// --- Types ---

export interface SessionStats {
  totalInput: number;
  totalOutput: number;
  totalActions: number;
  turns: number;
  model: string | null;
  startedAt: string | null;
}

interface TurnData {
  turnNumber: number;
  events: RunStatusEvent[];
  tokenUsage: { input: number; output: number } | null;
  duration: number | null;
  model: string | null;
  isActive: boolean;
}

// --- Main Component ---

export function AgentExecutionView({
  steps,
  sessionStats,
  isExecuting,
}: {
  steps: RunStatusEvent[];
  sessionStats: SessionStats;
  isExecuting: boolean;
}): React.JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [steps.length]);

  const turns = useMemo(() => groupByTurns(steps, isExecuting), [steps, isExecuting]);

  // Setup phase events (before turn 1)
  const setupEvents = useMemo(
    () => steps.filter((s) => !s.turn || s.turn === 0),
    [steps]
  );

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden">
      {/* Session Stats Bar */}
      <SessionStatsBar stats={sessionStats} isExecuting={isExecuting} />

      {/* Event Stream */}
      <div className="max-h-[500px] overflow-auto p-1">
        {/* Setup phase */}
        {setupEvents.length > 0 && (
          <div className="px-3 py-2 space-y-0.5">
            {setupEvents.map((step, i) => (
              <SetupLine key={`setup-${step.timestamp}-${i}`} step={step} />
            ))}
          </div>
        )}

        {/* Turn groups */}
        {turns.map((turn) => (
          <TurnGroup key={turn.turnNumber} turn={turn} />
        ))}

        {/* Working indicator */}
        {isExecuting && (
          <div className="flex items-center gap-2 px-4 py-2">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
            <span className="text-zinc-500 text-xs font-mono animate-pulse">Working...</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

// --- Session Stats Bar ---

function SessionStatsBar({
  stats,
  isExecuting,
}: {
  stats: SessionStats;
  isExecuting: boolean;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-zinc-900 border-b border-zinc-800 text-xs font-mono">
      {/* Turn count */}
      <StatPill
        label="Turns"
        value={stats.turns > 0 ? String(stats.turns) : "0"}
        accent="text-blue-400"
      />

      {/* Token usage */}
      <StatPill
        label="Tokens"
        value={formatTokenCount(stats.totalInput + stats.totalOutput)}
        accent="text-emerald-400"
      />

      {/* Actions */}
      <StatPill
        label="Actions"
        value={String(stats.totalActions)}
        accent="text-amber-400"
      />

      {/* Elapsed time */}
      <div className="ml-auto flex items-center gap-1.5">
        {stats.model && (
          <span className="text-zinc-600 mr-2">{stats.model}</span>
        )}
        <ElapsedTime startedAt={stats.startedAt} isRunning={isExecuting} />
      </div>
    </div>
  );
}

function StatPill({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-zinc-600">{label}</span>
      <span className={accent}>{value}</span>
    </div>
  );
}

function ElapsedTime({
  startedAt,
  isRunning,
}: {
  startedAt: string | null;
  isRunning: boolean;
}): React.JSX.Element {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startedAt || !isRunning) return;
    const start = new Date(startedAt).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt, isRunning]);

  useEffect(() => {
    if (!isRunning && startedAt) {
      // Freeze at final value
      const start = new Date(startedAt).getTime();
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }
  }, [isRunning, startedAt]);

  if (!startedAt) return <span className="text-zinc-600">--:--</span>;

  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return (
    <span className={cn("tabular-nums", isRunning ? "text-blue-400" : "text-zinc-500")}>
      {m}:{s.toString().padStart(2, "0")}
    </span>
  );
}

// --- Turn Group ---

function TurnGroup({ turn }: { turn: TurnData }): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false);

  const toolCalls = turn.events.filter((e) => e.type === "tool_call");
  const toolResults = turn.events.filter((e) => e.type === "tool_result");
  const llmTextEvents = turn.events.filter((e) => e.type === "llm_text");

  // For active turns: accumulate streaming deltas into one live text block
  const liveText = turn.isActive
    ? turn.events.filter((e) => e.type === "llm_delta").map((e) => e.detail ?? e.message).join("")
    : null;

  // Pair tool calls with their results
  const toolPairs: Array<{ call: RunStatusEvent; result: RunStatusEvent | null }> = toolCalls.map((call, i) => ({
    call,
    result: toolResults[i] ?? null,
  }));

  return (
    <div className="border-t border-zinc-800/50 first:border-t-0">
      {/* Turn Header */}
      <button
        className="flex items-center gap-2 w-full text-left px-3 py-1.5 hover:bg-zinc-900/50 transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3 text-zinc-600 shrink-0" />
        ) : (
          <ChevronDown className="h-3 w-3 text-zinc-600 shrink-0" />
        )}
        <span className="text-xs font-mono">
          <span className="text-blue-400">Turn {turn.turnNumber}</span>
          {turn.tokenUsage && (
            <span className="text-zinc-600 ml-2">
              {formatTokenCount(turn.tokenUsage.input + turn.tokenUsage.output)} tok
            </span>
          )}
          {turn.duration != null && (
            <span className="text-zinc-700 ml-2">{(turn.duration / 1000).toFixed(1)}s</span>
          )}
        </span>
        {turn.isActive && (
          <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse ml-1" />
        )}
        {!turn.isActive && toolCalls.length > 0 && (
          <span className="text-zinc-700 text-xs font-mono ml-auto">
            {toolCalls.length} action{toolCalls.length !== 1 ? "s" : ""}
          </span>
        )}
      </button>

      {/* Turn Content */}
      {!collapsed && (
        <div className="px-3 pb-2 space-y-1">
          {/* Live streaming text (active turn only — single accumulated block) */}
          {liveText && <LiveTextBlock text={liveText} />}

          {/* Completed LLM text blocks (never show raw deltas) */}
          {!liveText && llmTextEvents.map((evt, i) => (
            <LlmTextBlock key={`llm-${evt.timestamp}-${i}`} event={evt} />
          ))}

          {/* Tool call/result pairs */}
          {toolPairs.map((pair, i) => (
            <ToolCallEntry key={`tool-${pair.call.timestamp}-${i}`} call={pair.call} result={pair.result} />
          ))}
        </div>
      )}
    </div>
  );
}

// --- Live Streaming Text Block (active turn, accumulated deltas) ---

function LiveTextBlock({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="border-l-2 border-blue-500/40 pl-3 py-1 text-xs text-zinc-400 leading-relaxed">
      <Markdown>{text}</Markdown>
      <span className="inline-block w-1.5 h-3 bg-blue-400 animate-pulse ml-0.5 align-text-bottom" />
    </div>
  );
}

// --- LLM Text Block ---

function LlmTextBlock({ event }: { event: RunStatusEvent }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const text = event.detail ?? event.message;
  const isLong = text.length > 300;
  const displayText = isLong && !expanded ? text.slice(0, 300) + "..." : text;

  return (
    <div className="group">
      <div
        className={cn(
          "border-l-2 border-zinc-700 pl-3 py-1 text-xs text-zinc-300 leading-relaxed",
          isLong && "cursor-pointer"
        )}
        onClick={isLong ? () => setExpanded(!expanded) : undefined}
      >
        <Markdown>{displayText}</Markdown>
        {isLong && !expanded && (
          <span className="text-zinc-600 ml-1 text-[10px]">[click to expand]</span>
        )}
      </div>
    </div>
  );
}

// --- Tool Call Entry ---

function ToolCallEntry({
  call,
  result,
}: {
  call: RunStatusEvent;
  result: RunStatusEvent | null;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const toolName = call.toolName ?? "unknown";
  const ToolIcon = getToolIcon(toolName);
  const isSuccess = result && !result.message.startsWith("Error:");
  const resultText = result?.detail ?? result?.message ?? "";

  return (
    <div className="group">
      {/* Tool call line */}
      <div className="flex items-center gap-2 py-0.5">
        <ToolIcon className="h-3 w-3 text-amber-400/70 shrink-0" />
        <span className="text-xs font-mono text-amber-400">
          {toolName}
        </span>
        <span className="text-xs font-mono text-zinc-500 truncate flex-1">
          {call.toolInput ?? ""}
        </span>
        {result && (
          <button
            className="flex items-center gap-1 shrink-0 hover:bg-zinc-800 rounded px-1 transition-colors"
            onClick={() => setExpanded(!expanded)}
          >
            {isSuccess ? (
              <CheckCircle2 className="h-3 w-3 text-green-500/70" />
            ) : (
              <XCircle className="h-3 w-3 text-red-400/70" />
            )}
            {result.duration != null && (
              <span className="text-[10px] font-mono text-zinc-700">{result.duration}ms</span>
            )}
            {expanded ? (
              <ChevronDown className="h-2.5 w-2.5 text-zinc-600" />
            ) : (
              <ChevronRight className="h-2.5 w-2.5 text-zinc-600" />
            )}
          </button>
        )}
      </div>

      {/* Expanded result */}
      {expanded && resultText && (
        <div className="ml-5 mt-0.5 mb-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-xs font-mono text-zinc-500 whitespace-pre-wrap break-words max-h-48 overflow-auto">
          {resultText}
        </div>
      )}
    </div>
  );
}

// --- Setup Line ---

function SetupLine({ step }: { step: RunStatusEvent }): React.JSX.Element {
  const typeLabel =
    step.type === "plan"
      ? "[plan]"
      : step.type === "reflection"
        ? "[reflection]"
        : step.type === "ask_user"
          ? "[ask-user]"
          : step.type === "follow_up"
            ? "[follow-up]"
            : "";
  return (
    <div className="flex items-start gap-2 py-0.5 text-xs font-mono">
      <span className="h-3 w-3 flex items-center justify-center mt-0.5 shrink-0">
        <span className={cn(
          "h-1.5 w-1.5 rounded-full",
          step.type === "error" ? "bg-red-400" : "bg-zinc-700"
        )} />
      </span>
      <span className="text-zinc-600 shrink-0">
        {new Date(step.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </span>
      <span className={cn(
        "flex-1",
        step.type === "error" ? "text-red-400" : "text-zinc-500"
      )}>
        {typeLabel ? `${typeLabel} ${step.message}` : step.message}
      </span>
    </div>
  );
}

// --- Helpers ---

function groupByTurns(steps: RunStatusEvent[], isExecuting: boolean): TurnData[] {
  const turnMap = new Map<number, RunStatusEvent[]>();
  for (const step of steps) {
    if (!step.turn || step.turn === 0) continue;
    const existing = turnMap.get(step.turn);
    if (existing) {
      existing.push(step);
    } else {
      turnMap.set(step.turn, [step]);
    }
  }

  const maxTurn = Math.max(0, ...Array.from(turnMap.keys()));
  const turns: TurnData[] = [];

  for (const [turnNumber, events] of turnMap.entries()) {
    // Find the info event for this turn (has token usage / duration)
    const infoEvent = events.find((e) => e.type === "info" && e.message === `Turn ${turnNumber}`);
    turns.push({
      turnNumber,
      events,
      tokenUsage: infoEvent?.tokenUsage ?? null,
      duration: infoEvent?.duration ?? null,
      model: infoEvent?.model ?? null,
      isActive: isExecuting && turnNumber === maxTurn,
    });
  }

  return turns.sort((a, b) => a.turnNumber - b.turnNumber);
}

function getToolIcon(toolName: string): React.ElementType {
  switch (toolName) {
    case "write_file":
    case "edit_file":
    case "read_file":
      return File;
    case "search_code":
    case "glob_files":
      return FolderOpen;
    case "run_command":
    case "git_status":
    case "git_diff":
    case "git_add":
    case "git_commit":
      return Terminal;
    case "list_directory":
      return FolderOpen;
    default:
      return Terminal;
  }
}

function formatTokenCount(n: number): string {
  if (n === 0) return "0";
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}
