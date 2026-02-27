import { execSync, spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

// --- Tool Definitions (Anthropic format) ---

export const ANTHROPIC_TOOLS = [
  {
    name: "write_file",
    description: "Create or overwrite a file at the given path with the provided content. Parent directories are created automatically.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string" as const, description: "File path relative to the project directory" },
        content: { type: "string" as const, description: "The full content to write to the file" }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "read_file",
    description: "Read the contents of a file with line numbers. Returns numbered lines (capped at 200KB). Use offset/limit for large files.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string" as const, description: "File path relative to the project directory" },
        offset: { type: "number" as const, description: "Start reading from this line number (1-indexed, default: 1)" },
        limit: { type: "number" as const, description: "Maximum number of lines to return (default: all up to size cap)" }
      },
      required: ["path"]
    }
  },
  {
    name: "run_command",
    description: "Execute a shell command in the project directory. Returns stdout, stderr, and exit code. Use this for installing dependencies, running scripts, initializing projects, etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: { type: "string" as const, description: "The shell command to execute" }
      },
      required: ["command"]
    }
  },
  {
    name: "edit_file",
    description: "Edit an existing file by replacing a range of lines. First use read_file to see line numbers, then specify the range to replace. Alternatively, use search/replace for exact string matching.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string" as const, description: "File path relative to the project directory" },
        start_line: { type: "number" as const, description: "First line number to replace (1-indexed, inclusive). Use with end_line." },
        end_line: { type: "number" as const, description: "Last line number to replace (1-indexed, inclusive). Use with start_line." },
        new_content: { type: "string" as const, description: "Replacement content for the specified line range. Can be more or fewer lines than the range." },
        search: { type: "string" as const, description: "Exact text to search for (fallback mode, prefer line numbers)" },
        replace: { type: "string" as const, description: "Replacement text (used with search)" },
        replaceAll: { type: "boolean" as const, description: "Replace all matches instead of first match (only with search/replace)" }
      },
      required: ["path"]
    }
  },
  {
    name: "search_code",
    description: "Search code/text within project files and return matching lines. Respects .gitignore.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string" as const, description: "Search text or regex string" },
        path: { type: "string" as const, description: "Optional relative path to narrow scope" }
      },
      required: ["query"]
    }
  },
  {
    name: "glob_files",
    description: "List files using a wildcard glob-like pattern. Respects .gitignore.",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: { type: "string" as const, description: "Pattern like src/**/*.ts or *.md" },
        path: { type: "string" as const, description: "Optional relative base path" }
      },
      required: ["pattern"]
    }
  },
  {
    name: "list_directory",
    description: "List the contents of a directory, showing files and subdirectories.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string" as const, description: "Directory path relative to the project directory. Use '.' for the project root." }
      },
      required: ["path"]
    }
  },
  {
    name: "agent_notes",
    description: "Read or update your persistent scratchpad. Use to track progress, decisions, and state. Content persists even if conversation context is compressed.",
    input_schema: {
      type: "object" as const,
      properties: {
        action: { type: "string" as const, enum: ["read", "append", "replace"], description: "read: get current notes, append: add to notes, replace: overwrite notes" },
        content: { type: "string" as const, description: "Content to write (for append/replace)" }
      },
      required: ["action"]
    }
  },
  {
    name: "ask_user",
    description: "Ask the human operator a clarifying question and wait for their answer before continuing.",
    input_schema: {
      type: "object" as const,
      properties: {
        question: { type: "string" as const, description: "Question for the human operator" },
        context: { type: "string" as const, description: "Optional short context for why this is needed" }
      },
      required: ["question"]
    }
  }
];

// --- Tool Definitions (OpenAI format) ---

export const OPENAI_TOOLS = ANTHROPIC_TOOLS.map((tool) => ({
  type: "function" as const,
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema
  }
}));

// --- Path Security ---

function resolveSafe(projectDir: string, relativePath: string): string {
  const resolved = path.resolve(projectDir, relativePath);
  const normalizedProject = path.resolve(projectDir);
  if (!resolved.startsWith(normalizedProject)) {
    throw new Error(`Path "${relativePath}" resolves outside the project directory.`);
  }
  return resolved;
}

// --- Tool Executors ---

export function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  projectDir: string
): string {
  switch (toolName) {
    case "write_file":
      return executeWriteFile(
        String(input.path ?? ""),
        String(input.content ?? ""),
        projectDir
      );
    case "read_file":
      return executeReadFile(input, projectDir);
    case "run_command":
      return executeRunCommand(String(input.command ?? ""), projectDir);
    case "edit_file":
      return executeEditFile(input, projectDir);
    case "search_code":
      return executeSearchCode(String(input.query ?? ""), String(input.path ?? "."), projectDir);
    case "glob_files":
      return executeGlobFiles(String(input.pattern ?? "*"), String(input.path ?? "."), projectDir);
    case "agent_notes":
      return executeAgentNotes(input, projectDir);
    case "list_directory":
      return executeListDirectory(String(input.path ?? "."), projectDir);
    default:
      return `Unknown tool: ${toolName}`;
  }
}

export async function executeToolAsync(
  toolName: string,
  input: Record<string, unknown>,
  projectDir: string,
  signal?: AbortSignal
): Promise<string> {
  if (toolName === "run_command") {
    return executeRunCommandAsync(String(input.command ?? ""), projectDir, signal);
  }
  return executeTool(toolName, input, projectDir);
}

function executeWriteFile(filePath: string, content: string, projectDir: string): string {
  const resolved = resolveSafe(projectDir, filePath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  writeFileSync(resolved, content, "utf8");
  return `File written: ${filePath} (${content.length} bytes)`;
}

// --- read_file with line numbers, 200KB cap, and pagination ---

function executeReadFile(input: Record<string, unknown>, projectDir: string): string {
  const filePath = String(input.path ?? "").trim();
  if (!filePath) return "Error: path is required";
  const resolved = resolveSafe(projectDir, filePath);
  const MAX_SIZE = 200 * 1024; // 200KB
  const offset = typeof input.offset === "number" && input.offset >= 1 ? Math.floor(input.offset) : 1;
  const limit = typeof input.limit === "number" && input.limit >= 1 ? Math.floor(input.limit) : Infinity;

  const stat = statSync(resolved);
  if (stat.size > MAX_SIZE) {
    // Read only up to MAX_SIZE bytes to avoid loading huge files into memory
    const fd = openSync(resolved, "r");
    const buffer = Buffer.alloc(MAX_SIZE);
    const bytesRead = readSync(fd, buffer, 0, MAX_SIZE, 0);
    closeSync(fd);
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    const allLines = text.split("\n");
    // Drop potentially partial last line from truncation
    if (bytesRead === MAX_SIZE) allLines.pop();
    return formatLinesWithNumbers(allLines, offset, limit, true);
  }

  const content = readFileSync(resolved, "utf8");
  const allLines = content.split("\n");
  return formatLinesWithNumbers(allLines, offset, limit, false);
}

function formatLinesWithNumbers(
  allLines: string[],
  offset: number,
  limit: number,
  truncated: boolean
): string {
  const startIdx = offset - 1;
  if (startIdx >= allLines.length) {
    return `Error: offset ${offset} exceeds available lines (${allLines.length})`;
  }
  const endIdx = Math.min(startIdx + limit, allLines.length);
  const selectedLines = allLines.slice(startIdx, endIdx);
  const maxLineNum = offset + selectedLines.length - 1;
  const gutterWidth = String(maxLineNum).length;

  const numbered = selectedLines.map((line, i) => {
    const lineNum = String(offset + i).padStart(gutterWidth, " ");
    return `${lineNum} | ${line}`;
  });

  let result = numbered.join("\n");
  if (endIdx < allLines.length) {
    result += `\n... (${allLines.length - endIdx} more lines. Use offset=${endIdx + 1} to continue.)`;
  }
  if (truncated) {
    result += "\n... (file truncated at 200KB)";
  }
  return result;
}

function executeRunCommand(command: string, projectDir: string): string {
  const normalized = command.trim();
  if (!normalized) {
    return "exit 1\nCommand cannot be empty.";
  }
  if (normalized.includes("\n")) {
    return "exit 1\nMulti-line commands are blocked.";
  }
  if (/[`]|(\$\([^)]+\))|(\|\|)/.test(normalized)) {
    return "exit 1\nShell expansion and fallback chaining are blocked.";
  }
  if (/\b(npm|pnpm|yarn)\s+start\b/i.test(normalized)) {
    return "exit 1\nLong-running start commands are blocked in guarded execution.";
  }
  try {
    const stdout = execSync(normalized, {
      cwd: projectDir,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    });
    return `exit 0\n${stdout}`.trim();
  } catch (err: unknown) {
    const execError = err as { status?: number; stdout?: string; stderr?: string; message?: string };
    const exitCode = execError.status ?? 1;
    const stdout = execError.stdout ?? "";
    const stderr = execError.stderr ?? "";
    return `exit ${exitCode}\n${stdout}\n${stderr}`.trim();
  }
}

// --- edit_file with line-number-based editing (preferred) + string match (fallback) ---

function executeEditFile(input: Record<string, unknown>, projectDir: string): string {
  const filePath = String(input.path ?? "").trim();
  if (!filePath) return "Error: path is required";
  const resolved = resolveSafe(projectDir, filePath);

  const startLine = typeof input.start_line === "number" ? input.start_line : undefined;
  const endLine = typeof input.end_line === "number" ? input.end_line : undefined;
  const newContent = typeof input.new_content === "string" ? input.new_content : undefined;

  // Line-number-based editing (preferred path)
  if (startLine !== undefined && endLine !== undefined) {
    if (startLine < 1) return "Error: start_line must be >= 1";
    if (endLine < startLine) return "Error: end_line must be >= start_line";

    const content = readFileSync(resolved, "utf8");
    const lines = content.split("\n");
    const totalLines = lines.length;

    if (startLine > totalLines) return `Error: start_line ${startLine} exceeds file length (${totalLines} lines)`;
    if (endLine > totalLines) return `Error: end_line ${endLine} exceeds file length (${totalLines} lines)`;

    const before = lines.slice(0, startLine - 1);
    const after = lines.slice(endLine);
    const replacementLines = newContent !== undefined ? newContent.split("\n") : [];
    const next = [...before, ...replacementLines, ...after].join("\n");
    writeFileSync(resolved, next, "utf8");

    const removedCount = endLine - startLine + 1;
    const addedCount = replacementLines.length;
    return `File edited: ${filePath} (replaced lines ${startLine}-${endLine}: removed ${removedCount}, added ${addedCount} lines)`;
  }

  // Legacy string-based editing (backwards compatibility)
  const search = String(input.search ?? "");
  const replace = String(input.replace ?? "");
  const replaceAll = input.replaceAll === true;

  if (!search) return "Error: either start_line/end_line or search/replace is required";
  const content = readFileSync(resolved, "utf8");
  if (!content.includes(search)) return "Error: search text not found in file";
  const next = replaceAll ? content.split(search).join(replace) : content.replace(search, replace);
  writeFileSync(resolved, next, "utf8");
  return `File edited: ${filePath}`;
}

// --- .gitignore-aware search and glob ---

const DEFAULT_IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "out",
  "coverage", "__pycache__", ".cache", ".vscode", ".idea",
  "dist-main", "dist-renderer", ".pnpm", "target", "vendor"
]);

const DEFAULT_IGNORE_PATTERNS = [
  /\.min\.js$/,
  /\.min\.css$/,
  /\.map$/,
  /\.lock$/,
  /package-lock\.json$/,
  /\.DS_Store$/,
  /Thumbs\.db$/
];

interface GitignoreRules {
  patterns: Array<{ regex: RegExp; negated: boolean; dirOnly: boolean }>;
}

function parseGitignoreFile(content: string): GitignoreRules {
  const patterns: GitignoreRules["patterns"] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    let negated = false;
    let pattern = line;
    if (pattern.startsWith("!")) {
      negated = true;
      pattern = pattern.slice(1);
    }

    const dirOnly = pattern.endsWith("/");
    if (dirOnly) pattern = pattern.slice(0, -1);

    if (pattern.startsWith("/")) pattern = pattern.slice(1);

    const regex = gitignorePatternToRegex(pattern);
    patterns.push({ regex, negated, dirOnly });
  }
  return { patterns };
}

function gitignorePatternToRegex(pattern: string): RegExp {
  let output = "";
  // If pattern has no slash, it matches basename anywhere in the tree
  const matchesAnywhere = !pattern.includes("/");

  if (matchesAnywhere) {
    output += "(?:^|/)";
  } else {
    output += "^";
  }

  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          output += "(?:.*/)?";
          i += 3;
        } else {
          output += ".*";
          i += 2;
        }
      } else {
        output += "[^/]*";
        i += 1;
      }
    } else if (ch === "?") {
      output += "[^/]";
      i += 1;
    } else {
      output += escapeRegex(ch);
      i += 1;
    }
  }
  output += "(?:$|/)";
  return new RegExp(output);
}

function loadGitignoreRules(projectDir: string): GitignoreRules {
  try {
    const content = readFileSync(path.join(projectDir, ".gitignore"), "utf8");
    return parseGitignoreFile(content);
  } catch {
    return { patterns: [] };
  }
}

function isGitignored(relativePath: string, isDir: boolean, rules: GitignoreRules): boolean {
  const normalizedPath = relativePath.replaceAll("\\", "/");
  let ignored = false;
  for (const rule of rules.patterns) {
    if (rule.dirOnly && !isDir) continue;
    if (rule.regex.test(normalizedPath)) {
      ignored = !rule.negated;
    }
  }
  return ignored;
}

function executeSearchCode(query: string, relPath: string, projectDir: string): string {
  const base = resolveSafe(projectDir, relPath || ".");
  const gitignoreRules = loadGitignoreRules(projectDir);
  let regex: RegExp;
  try {
    regex = new RegExp(query, "i");
  } catch {
    regex = new RegExp(escapeRegex(query), "i");
  }
  const results: string[] = [];
  scanFiles(base, (file) => {
    if (results.length >= 200) return;
    if (shouldSkipFile(file, projectDir, gitignoreRules)) return;
    try {
      const text = readFileSync(file, "utf8");
      const lines = text.split(/\r?\n/g);
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i] ?? "")) {
          results.push(`${path.relative(projectDir, file)}:${i + 1}:${lines[i]}`);
          if (results.length >= 200) break;
        }
      }
    } catch {
      // ignore binary/unreadable files
    }
  }, projectDir, gitignoreRules);
  return results.length > 0 ? results.join("\n") : "No matches found.";
}

function executeGlobFiles(pattern: string, relPath: string, projectDir: string): string {
  const base = resolveSafe(projectDir, relPath || ".");
  const normalizedPattern = pattern.replaceAll("\\", "/");
  const regex = globToRegex(normalizedPattern);
  const gitignoreRules = loadGitignoreRules(projectDir);
  const matches: string[] = [];
  scanFiles(base, (file) => {
    const rel = path.relative(projectDir, file).replaceAll("\\", "/");
    if (regex.test(rel)) matches.push(rel);
  }, projectDir, gitignoreRules);
  return matches.slice(0, 500).join("\n") || "No files matched.";
}

async function executeRunCommandAsync(command: string, projectDir: string, signal?: AbortSignal): Promise<string> {
  const normalized = command.trim();
  if (!normalized) return "exit 1\nCommand cannot be empty.";
  if (normalized.includes("\n")) return "exit 1\nMulti-line commands are blocked.";
  if (/[`]|(\$\([^)]+\))|(\|\|)/.test(normalized)) return "exit 1\nShell expansion and fallback chaining are blocked.";
  if (/\b(npm|pnpm|yarn)\s+start\b/i.test(normalized)) return "exit 1\nLong-running start commands are blocked in guarded execution.";

  return await new Promise((resolve) => {
    const child = spawn(normalized, {
      cwd: projectDir,
      shell: true,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, 30_000);
    const onAbort = () => child.kill("SIGTERM");
    if (signal) {
      if (signal.aborted) onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
    }
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (stdout.length > 1024 * 1024) stdout = stdout.slice(-1024 * 1024);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 1024 * 1024) stderr = stderr.slice(-1024 * 1024);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      if (timedOut) {
        resolve(`exit 124\n${stdout}\n${stderr}\nCommand timed out after 30s.`.trim());
        return;
      }
      resolve(`exit ${code ?? 1}\n${stdout}\n${stderr}`.trim());
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve(`exit 1\n${error.message}`);
    });
  });
}

function executeListDirectory(dirPath: string, projectDir: string): string {
  const resolved = resolveSafe(projectDir, dirPath);
  const entries = readdirSync(resolved, { withFileTypes: true });
  const lines = entries.map((entry) => {
    if (entry.isDirectory()) return `[dir]  ${entry.name}/`;
    return `[file] ${entry.name}`;
  });
  return lines.join("\n") || "(empty directory)";
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeQuote(value: string): string {
  return value.replaceAll('"', '\\"');
}

function executeAgentNotes(input: Record<string, unknown>, projectDir: string): string {
  const notesPath = path.join(projectDir, ".autoagent-notes.md");
  const action = String(input.action ?? "read");
  if (action === "read") {
    try { return readFileSync(notesPath, "utf8") || "(empty)"; }
    catch { return "(no notes yet)"; }
  }
  if (action === "append") {
    const existing = (() => { try { return readFileSync(notesPath, "utf8"); } catch { return ""; } })();
    writeFileSync(notesPath, existing + "\n" + String(input.content ?? ""), "utf8");
    return "Notes updated.";
  }
  if (action === "replace") {
    writeFileSync(notesPath, String(input.content ?? ""), "utf8");
    return "Notes replaced.";
  }
  return "Error: action must be read, append, or replace";
}

function shouldSkipFile(filePath: string, projectDir: string, gitignoreRules: GitignoreRules): boolean {
  const normalized = filePath.replaceAll("\\", "/");
  if (normalized.includes("/node_modules/") || normalized.includes("/.git/")) return true;

  for (const pattern of DEFAULT_IGNORE_PATTERNS) {
    if (pattern.test(normalized)) return true;
  }

  const relativePath = path.relative(projectDir, filePath).replaceAll("\\", "/");
  if (isGitignored(relativePath, false, gitignoreRules)) return true;

  return false;
}

function scanFiles(
  root: string,
  onFile: (file: string) => void,
  projectDir: string,
  gitignoreRules: GitignoreRules
): void {
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (DEFAULT_IGNORE_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      const relDir = path.relative(projectDir, full).replaceAll("\\", "/");
      if (isGitignored(relDir, true, gitignoreRules)) continue;
      scanFiles(full, onFile, projectDir, gitignoreRules);
      continue;
    }
    onFile(full);
  }
}

function globToRegex(pattern: string): RegExp {
  let output = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        output += ".*";
        i += 1;
      } else {
        output += "[^/]*";
      }
      continue;
    }
    output += escapeRegex(ch ?? "");
  }
  output += "$";
  return new RegExp(output, "i");
}
