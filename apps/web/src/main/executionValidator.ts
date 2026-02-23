import { existsSync, readFileSync, statSync } from "node:fs";
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
  confidence: number;
  verificationType: "command" | "file_write" | "file_read" | "generic";
  checks: string[];
}

export function validateToolOutcome(input: ValidationInput): ValidationResult {
  const checks: string[] = [];
  const profile = parseVerificationProfile(input.toolInput.verificationProfile);

  if (input.toolName === "run_command") {
    const exitCode = parseExitCode(input.toolResult);
    if (exitCode !== null && exitCode !== 0) {
      checks.push(`Command failed with exit code ${exitCode}.`);
      return { ok: false, severity: "error", confidence: 0.95, verificationType: "command", checks };
    }
    const expectedOutput = String(input.toolInput.expectedOutputContains ?? "").trim();
    if (expectedOutput && !input.toolResult.includes(expectedOutput)) {
      checks.push(`Expected output fragment missing: "${expectedOutput.slice(0, 120)}".`);
      return { ok: false, severity: "warn", confidence: 0.7, verificationType: "command", checks };
    }
    for (const fragment of profile.expectedOutputContains) {
      if (!input.toolResult.includes(fragment)) {
        checks.push(`Profile output fragment missing: "${fragment.slice(0, 120)}".`);
        return { ok: false, severity: "warn", confidence: 0.72, verificationType: "command", checks };
      }
    }
    if (profile.quickCheckCommand) {
      checks.push(`Quickcheck requested: ${profile.quickCheckCommand.slice(0, 140)}`);
    }
    checks.push("Command exit code indicates success.");
    return { ok: true, severity: "info", confidence: 0.9, verificationType: "command", checks };
  }

  if (input.toolName === "write_file") {
    const relPath = String(input.toolInput.path ?? "");
    if (!relPath) {
      checks.push("Write path missing.");
      return { ok: false, severity: "error", confidence: 1, verificationType: "file_write", checks };
    }
    const absPath = path.resolve(input.projectDir, relPath);
    const normalizedProject = path.resolve(input.projectDir) + path.sep;
    if (!absPath.startsWith(normalizedProject) && absPath !== path.resolve(input.projectDir)) {
      checks.push(`Path traversal detected: resolved path escapes project directory.`);
      return { ok: false, severity: "error", confidence: 1, verificationType: "file_write", checks };
    }
    if (!existsSync(absPath)) {
      checks.push("Expected file not found after write.");
      return { ok: false, severity: "error", confidence: 1, verificationType: "file_write", checks };
    }
    const size = statSync(absPath).size;
    if (size === 0) {
      checks.push("File exists but is empty after write.");
      return { ok: false, severity: "warn", confidence: 0.75, verificationType: "file_write", checks };
    }
    if (profile.minBytes > 0 && size < profile.minBytes) {
      checks.push(`File smaller than expected profile minimum (${size} < ${profile.minBytes}).`);
      return { ok: false, severity: "warn", confidence: 0.78, verificationType: "file_write", checks };
    }
    if (profile.mustContain.length > 0) {
      const content = readFileSync(absPath, "utf8");
      for (const token of profile.mustContain) {
        if (!content.includes(token)) {
          checks.push(`File missing required content token: "${token.slice(0, 120)}".`);
          return { ok: false, severity: "warn", confidence: 0.8, verificationType: "file_write", checks };
        }
      }
    }
    checks.push(`File exists after write (${size} bytes).`);
    return { ok: true, severity: "info", confidence: 0.92, verificationType: "file_write", checks };
  }

  if (input.toolName === "read_file" && input.toolResult.trim().length === 0) {
    checks.push("Read result is empty.");
    return { ok: false, severity: "warn", confidence: 0.7, verificationType: "file_read", checks };
  }

  checks.push("No validator rule for tool; treated as pass.");
  return { ok: true, severity: "info", confidence: 0.5, verificationType: "generic", checks };
}

interface VerificationProfile {
  expectedOutputContains: string[];
  mustContain: string[];
  minBytes: number;
  quickCheckCommand?: string;
}

function parseExitCode(result: string): number | null {
  const firstLine = result.split(/\r?\n/, 1)[0]?.trim() ?? "";
  const match = /^exit\s+(-?\d+)$/i.exec(firstLine);
  if (!match) return null;
  return Number(match[1]);
}

function parseVerificationProfile(value: unknown): VerificationProfile {
  if (!isRecord(value)) {
    return { expectedOutputContains: [], mustContain: [], minBytes: 0 };
  }
  const expectedOutputContains = Array.isArray(value.expectedOutputContains)
    ? value.expectedOutputContains.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean)
    : [];
  const mustContain = Array.isArray(value.mustContain)
    ? value.mustContain.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean)
    : [];
  const minBytes = typeof value.minBytes === "number" && value.minBytes > 0 ? value.minBytes : 0;
  const quickCheckCommand = typeof value.quickCheckCommand === "string" ? value.quickCheckCommand.trim() : undefined;
  const profile: VerificationProfile = {
    expectedOutputContains,
    mustContain,
    minBytes
  };
  if (quickCheckCommand) {
    profile.quickCheckCommand = quickCheckCommand;
  }
  return profile;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
