export interface RepoDocument {
  path: string;
  content: string;
  language: string;
  tokensEstimate: number;
  fileMtimeMs?: number;
}

export interface DocumentChunk {
  id: string;
  path: string;
  language: string;
  content: string;
  startLine: number;
  endLine: number;
  tokensEstimate: number;
}

export interface HistoryTurn {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  priority?: number;
}

export interface ContextCompileInput {
  objective: string;
  changedFiles: string[];
  candidateChunks: DocumentChunk[];
  history: HistoryTurn[];
  tokenBudget: number;
}

export interface ContextCompileOutput {
  selectedChunks: DocumentChunk[];
  selectedHistory: HistoryTurn[];
  prompt: string;
  tokenEstimate: number;
}
