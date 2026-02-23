import { existsSync, statSync } from "node:fs";
import path from "node:path";

export interface ValidationInput {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolResult: string;
  projectDir: string;
}

export interface ValidationResult {
  ok: boolean;
  severity: "info" | "warn" | "error";
  checks: string[];
}

export function validateToolOutcome(input: ValidationInput): ValidationResult {
  const checks: string[] = [];

  if (input.toolName === "run_command") {
    const exitCode = parseExitCode(input.toolResult);
    if (exitCode !== null && exitCode !== 0) {
      checks.push(`Command failed with exit code ${exitCode}.`);
      return { ok: false, severity: "error", checks };
    }
    checks.push("Command exit code indicates success.");
    return { ok: true, severity: "info", checks };
  }

  if (input.toolName === "write_file") {
    const relPath = String(input.toolInput.path ?? "");
    if (!relPath) {
      checks.push("Write path missing.");
      return { ok: false, severity: "error", checks };
    }
    const absPath = path.resolve(input.projectDir, relPath);
    const normalizedProject = path.resolve(input.projectDir) + path.sep;
    if (!absPath.startsWith(normalizedProject) && absPath !== path.resolve(input.projectDir)) {
      checks.push(`Path traversal detected: resolved path escapes project directory.`);
      return { ok: false, severity: "error", checks };
    }
    if (!existsSync(absPath)) {
      checks.push("Expected file not found after write.");
      return { ok: false, severity: "error", checks };
    }
    const size = statSync(absPath).size;
    checks.push(`File exists after write (${size} bytes).`);
    return { ok: true, severity: "info", checks };
  }

  if (input.toolName === "read_file" && input.toolResult.trim().length === 0) {
    checks.push("Read result is empty.");
    return { ok: false, severity: "warn", checks };
  }

  checks.push("No validator rule for tool; treated as pass.");
  return { ok: true, severity: "info", checks };
}

function parseExitCode(result: string): number | null {
  const firstLine = result.split(/\r?\n/, 1)[0]?.trim() ?? "";
  const match = /^exit\s+(-?\d+)$/i.exec(firstLine);
  if (!match) return null;
  return Number(match[1]);
}
