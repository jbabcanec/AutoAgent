import { getContextDatabase } from "./database.js";
import type { HistoryTurn } from "./types.js";

export function persistHistory(sessionId: string, turns: HistoryTurn[]): void {
  const db = getContextDatabase();
  const insert = db.prepare(`
    INSERT INTO history_turns (session_id, role, content, priority, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const tx = db.transaction((rows: HistoryTurn[]) => {
    const createdAt = new Date().toISOString();
    for (const turn of rows) {
      insert.run(sessionId, turn.role, turn.content, turn.priority ?? 0, createdAt);
    }
  });
  tx(turns);
}

export function loadHistory(sessionId: string, limit = 50): HistoryTurn[] {
  const db = getContextDatabase();
  const rows = db
    .prepare(
      `
      SELECT role, content, priority
      FROM history_turns
      WHERE session_id = ?
      ORDER BY id DESC
      LIMIT ?
    `
    )
    .all(sessionId, limit) as Array<{ role: HistoryTurn["role"]; content: string; priority: number }>;
  return rows.reverse().map((row) => ({ role: row.role, content: row.content, priority: row.priority }));
}
