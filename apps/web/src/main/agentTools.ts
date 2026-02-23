import { execSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
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
    description: "Read the contents of a file. Returns the text content (capped at 32KB).",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string" as const, description: "File path relative to the project directory" }
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
    description: "Edit an existing file by applying string replacement.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string" as const, description: "File path relative to the project directory" },
        search: { type: "string" as const, description: "Exact text to search for" },
        replace: { type: "string" as const, description: "Replacement text" },
        replaceAll: { type: "boolean" as const, description: "Replace all matches instead of first match" }
      },
      required: ["path", "search", "replace"]
    }
  },
  {
    name: "search_code",
    description: "Search code/text within project files and return matching lines.",
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
    description: "List files using a wildcard glob-like pattern.",
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
    name: "git_status",
    description: "Get git status for the current repository.",
    input_schema: { type: "object" as const, properties: {}, required: [] }
  },
  {
    name: "git_diff",
    description: "Get git diff. Optionally include --staged.",
    input_schema: {
      type: "object" as const,
      properties: {
        staged: { type: "boolean" as const, description: "Use staged diff" }
      },
      required: []
    }
  },
  {
    name: "git_add",
    description: "Stage file(s) in git index.",
    input_schema: {
      type: "object" as const,
      properties: {
        pathspec: { type: "string" as const, description: "Pathspec to stage, e.g. . or src/file.ts" }
      },
      required: ["pathspec"]
    }
  },
  {
    name: "git_commit",
    description: "Create a git commit with message.",
    input_schema: {
      type: "object" as const,
      properties: {
        message: { type: "string" as const, description: "Commit message" }
      },
      required: ["message"]
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
      return executeReadFile(String(input.path ?? ""), projectDir);
    case "run_command":
      return executeRunCommand(String(input.command ?? ""), projectDir);
    case "edit_file":
      return executeEditFile(
        String(input.path ?? ""),
        String(input.search ?? ""),
        String(input.replace ?? ""),
        input.replaceAll === true,
        projectDir
      );
    case "search_code":
      return executeSearchCode(String(input.query ?? ""), String(input.path ?? "."), projectDir);
    case "glob_files":
      return executeGlobFiles(String(input.pattern ?? "*"), String(input.path ?? "."), projectDir);
    case "git_status":
      return executeRunCommand("git status --short --branch", projectDir);
    case "git_diff":
      return executeRunCommand(input.staged === true ? "git diff --staged" : "git diff", projectDir);
    case "git_add":
      return executeGitAdd(String(input.pathspec ?? ""), projectDir);
    case "git_commit":
      return executeGitCommit(String(input.message ?? ""), projectDir);
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

function executeReadFile(filePath: string, projectDir: string): string {
  const resolved = resolveSafe(projectDir, filePath);
  const MAX_SIZE = 32 * 1024;
  const stat = statSync(resolved);
  const content = readFileSync(resolved, "utf8");
  if (stat.size > MAX_SIZE) {
    return content.slice(0, MAX_SIZE) + "\n... (truncated)";
  }
  return content;
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

function executeEditFile(filePath: string, search: string, replace: string, replaceAll: boolean, projectDir: string): string {
  if (!filePath.trim()) return "Error: path is required";
  if (!search) return "Error: search text cannot be empty";
  const resolved = resolveSafe(projectDir, filePath);
  const content = readFileSync(resolved, "utf8");
  if (!content.includes(search)) return "Error: search text not found";
  const next = replaceAll ? content.split(search).join(replace) : content.replace(search, replace);
  writeFileSync(resolved, next, "utf8");
  return `File edited: ${filePath}`;
}

function executeSearchCode(query: string, relPath: string, projectDir: string): string {
  const base = resolveSafe(projectDir, relPath || ".");
  let regex: RegExp;
  try {
    regex = new RegExp(query, "i");
  } catch {
    regex = new RegExp(escapeRegex(query), "i");
  }
  const results: string[] = [];
  scanFiles(base, (file) => {
    if (results.length >= 200) return;
    if (shouldSkipFile(file)) return;
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
  });
  return results.length > 0 ? results.join("\n") : "No matches found.";
}

function executeGlobFiles(pattern: string, relPath: string, projectDir: string): string {
  const base = resolveSafe(projectDir, relPath || ".");
  const normalizedPattern = pattern.replaceAll("\\", "/");
  const regex = globToRegex(normalizedPattern);
  const matches: string[] = [];
  scanFiles(base, (file) => {
    const rel = path.relative(projectDir, file).replaceAll("\\", "/");
    if (regex.test(rel)) matches.push(rel);
  });
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

function executeGitAdd(pathspec: string, projectDir: string): string {
  const normalized = pathspec.trim();
  if (!normalized) return "Error: pathspec is required";
  if (/[;&|`$]/.test(normalized)) return "Error: invalid pathspec characters";
  return executeRunCommand(`git add ${normalized}`, projectDir);
}

function executeGitCommit(message: string, projectDir: string): string {
  const normalized = message.trim();
  if (!normalized) return "Error: commit message is required";
  if (normalized.includes("\n")) return "Error: multiline commit messages are blocked";
  return executeRunCommand(`git commit -m "${escapeQuote(normalized)}"`, projectDir);
}

function shouldSkipFile(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/");
  return normalized.includes("/node_modules/") || normalized.includes("/.git/");
}

function scanFiles(root: string, onFile: (file: string) => void): void {
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      scanFiles(full, onFile);
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
