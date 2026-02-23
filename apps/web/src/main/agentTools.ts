import { execSync } from "node:child_process";
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
    name: "list_directory",
    description: "List the contents of a directory, showing files and subdirectories.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string" as const, description: "Directory path relative to the project directory. Use '.' for the project root." }
      },
      required: ["path"]
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
    case "list_directory":
      return executeListDirectory(String(input.path ?? "."), projectDir);
    default:
      return `Unknown tool: ${toolName}`;
  }
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
  try {
    const stdout = execSync(command, {
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

function executeListDirectory(dirPath: string, projectDir: string): string {
  const resolved = resolveSafe(projectDir, dirPath);
  const entries = readdirSync(resolved, { withFileTypes: true });
  const lines = entries.map((entry) => {
    if (entry.isDirectory()) return `[dir]  ${entry.name}/`;
    return `[file] ${entry.name}`;
  });
  return lines.join("\n") || "(empty directory)";
}
