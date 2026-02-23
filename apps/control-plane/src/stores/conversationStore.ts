import { getControlPlaneDatabase } from "../database.js";
import type { ConversationMessageItem, ConversationThreadItem } from "../types.js";

export class ConversationStore {
  private readonly db = getControlPlaneDatabase();

  public getThreadByRun(runId: string): ConversationThreadItem | undefined {
    const row = this.db
      .prepare(
        "SELECT thread_id, run_id, parent_thread_id, title, metadata_json, created_at, updated_at FROM conversation_threads WHERE run_id = ? ORDER BY updated_at DESC LIMIT 1"
      )
      .get(runId) as
      | {
          thread_id: string;
          run_id: string;
          parent_thread_id: string | null;
          title: string | null;
          metadata_json: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    return row ? mapThread(row) : undefined;
  }

  public createThread(input: {
    runId: string;
    parentThreadId?: string;
    title?: string;
    metadata?: Record<string, unknown>;
  }): ConversationThreadItem {
    const threadId = `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO conversation_threads (thread_id, run_id, parent_thread_id, title, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        threadId,
        input.runId,
        input.parentThreadId ?? null,
        input.title ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        now,
        now
      );
    const result: ConversationThreadItem = {
      threadId,
      runId: input.runId,
      createdAt: now,
      updatedAt: now
    };
    if (input.parentThreadId !== undefined) result.parentThreadId = input.parentThreadId;
    if (input.title !== undefined) result.title = input.title;
    if (input.metadata !== undefined) result.metadata = input.metadata;
    return result;
  }

  public listMessages(threadId: string): ConversationMessageItem[] {
    const rows = this.db
      .prepare(
        "SELECT id, thread_id, role, content, turn_number, metadata_json, created_at FROM conversation_messages WHERE thread_id = ? ORDER BY id ASC"
      )
      .all(threadId) as Array<{
      id: number;
      thread_id: string;
      role: ConversationMessageItem["role"];
      content: string;
      turn_number: number;
      metadata_json: string | null;
      created_at: string;
    }>;
    return rows.map((row) => {
      const item: ConversationMessageItem = {
        id: row.id,
        threadId: row.thread_id,
        role: row.role,
        content: row.content,
        turnNumber: row.turn_number,
        createdAt: row.created_at
      };
      if (row.metadata_json !== null) item.metadata = parseRecord(row.metadata_json);
      return item;
    });
  }

  public appendMessage(input: {
    threadId: string;
    role: ConversationMessageItem["role"];
    content: string;
    turnNumber: number;
    metadata?: Record<string, unknown>;
  }): ConversationMessageItem {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        "INSERT INTO conversation_messages (thread_id, role, content, turn_number, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        input.threadId,
        input.role,
        input.content,
        input.turnNumber,
        input.metadata ? JSON.stringify(input.metadata) : null,
        now
      );
    this.db.prepare("UPDATE conversation_threads SET updated_at = ? WHERE thread_id = ?").run(now, input.threadId);
    const msg: ConversationMessageItem = {
      id: Number(result.lastInsertRowid),
      threadId: input.threadId,
      role: input.role,
      content: input.content,
      turnNumber: input.turnNumber,
      createdAt: now
    };
    if (input.metadata !== undefined) msg.metadata = input.metadata;
    return msg;
  }
}

function mapThread(row: {
  thread_id: string;
  run_id: string;
  parent_thread_id: string | null;
  title: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
}): ConversationThreadItem {
  const item: ConversationThreadItem = {
    threadId: row.thread_id,
    runId: row.run_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  if (row.parent_thread_id !== null) item.parentThreadId = row.parent_thread_id;
  if (row.title !== null) item.title = row.title;
  if (row.metadata_json !== null) item.metadata = parseRecord(row.metadata_json);
  return item;
}

function parseRecord(payload: string): Record<string, unknown> {
  try {
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return {};
  }
}
