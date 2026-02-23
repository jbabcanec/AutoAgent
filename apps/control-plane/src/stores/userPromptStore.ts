import { getControlPlaneDatabase } from "../database.js";
import type { UserPromptItem } from "../types.js";

export class UserPromptStore {
  private readonly db = getControlPlaneDatabase();

  public listByRun(runId: string): UserPromptItem[] {
    const rows = this.db
      .prepare(
        "SELECT prompt_id, run_id, thread_id, turn_number, prompt_text, context_json, status, requested_at, answered_at, response_text, expires_at FROM user_prompts WHERE run_id = ? ORDER BY requested_at ASC"
      )
      .all(runId) as Array<{
      prompt_id: string;
      run_id: string;
      thread_id: string | null;
      turn_number: number;
      prompt_text: string;
      context_json: string | null;
      status: UserPromptItem["status"];
      requested_at: string;
      answered_at: string | null;
      response_text: string | null;
      expires_at: string | null;
    }>;
    return rows.map(mapPrompt);
  }

  public get(promptId: string): UserPromptItem | undefined {
    const row = this.db
      .prepare(
        "SELECT prompt_id, run_id, thread_id, turn_number, prompt_text, context_json, status, requested_at, answered_at, response_text, expires_at FROM user_prompts WHERE prompt_id = ?"
      )
      .get(promptId) as
      | {
          prompt_id: string;
          run_id: string;
          thread_id: string | null;
          turn_number: number;
          prompt_text: string;
          context_json: string | null;
          status: UserPromptItem["status"];
          requested_at: string;
          answered_at: string | null;
          response_text: string | null;
          expires_at: string | null;
        }
      | undefined;
    return row ? mapPrompt(row) : undefined;
  }

  public create(input: {
    runId: string;
    threadId?: string;
    turnNumber: number;
    promptText: string;
    context?: Record<string, unknown>;
    expiresAt?: string;
  }): UserPromptItem {
    const promptId = `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const requestedAt = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO user_prompts (prompt_id, run_id, thread_id, turn_number, prompt_text, context_json, status, requested_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)"
      )
      .run(
        promptId,
        input.runId,
        input.threadId ?? null,
        input.turnNumber,
        input.promptText,
        input.context ? JSON.stringify(input.context) : null,
        requestedAt,
        input.expiresAt ?? null
      );
    const result: UserPromptItem = {
      promptId,
      runId: input.runId,
      turnNumber: input.turnNumber,
      promptText: input.promptText,
      status: "pending",
      requestedAt
    };
    if (input.threadId !== undefined) result.threadId = input.threadId;
    if (input.context !== undefined) result.context = input.context;
    if (input.expiresAt !== undefined) result.expiresAt = input.expiresAt;
    return result;
  }

  public answer(promptId: string, responseText: string): UserPromptItem | undefined {
    const answeredAt = new Date().toISOString();
    const nowMs = Date.now();
    const existing = this.get(promptId);
    if (!existing) return undefined;
    if (existing.status !== "pending") return existing;
    if (existing.expiresAt && Date.parse(existing.expiresAt) <= nowMs) {
      this.db.prepare("UPDATE user_prompts SET status = 'expired' WHERE prompt_id = ?").run(promptId);
      return this.get(promptId);
    }
    this.db
      .prepare("UPDATE user_prompts SET status = 'answered', answered_at = ?, response_text = ? WHERE prompt_id = ?")
      .run(answeredAt, responseText, promptId);
    return this.get(promptId);
  }

  public pruneOlderThan(days: number, nowMs = Date.now()): number {
    if (!Number.isFinite(days) || days <= 0) return 0;
    const cutoff = new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
    const result = this.db
      .prepare("DELETE FROM user_prompts WHERE requested_at < ? AND status IN ('answered', 'expired', 'cancelled')")
      .run(cutoff);
    return result.changes;
  }
}

function mapPrompt(row: {
  prompt_id: string;
  run_id: string;
  thread_id: string | null;
  turn_number: number;
  prompt_text: string;
  context_json: string | null;
  status: UserPromptItem["status"];
  requested_at: string;
  answered_at: string | null;
  response_text: string | null;
  expires_at: string | null;
}): UserPromptItem {
  const item: UserPromptItem = {
    promptId: row.prompt_id,
    runId: row.run_id,
    turnNumber: row.turn_number,
    promptText: row.prompt_text,
    status: row.status,
    requestedAt: row.requested_at
  };
  if (row.thread_id !== null) item.threadId = row.thread_id;
  if (row.context_json !== null) item.context = parseRecord(row.context_json);
  if (row.answered_at !== null) item.answeredAt = row.answered_at;
  if (row.response_text !== null) item.responseText = row.response_text;
  if (row.expires_at !== null) item.expiresAt = row.expires_at;
  return item;
}

function parseRecord(payload: string): Record<string, unknown> {
  try {
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return {};
  }
}
