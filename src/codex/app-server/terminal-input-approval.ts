/**
 * Details carried by Codex's `kind: "writeStdin"` command-approval request.
 *
 * The current app-server serializes the four original arguments with Rust
 * `shlex::try_join`:
 *
 *   write_stdin --session-id <process-id> <input>
 *
 * The public request schema exposes only that command string.  Decode only
 * the exact four-argument shape so channel renderers can present the same
 * action Codex presents in its own UI: the target terminal and the input.
 * Callers must retain the original command as a visible fallback when this
 * conservative decoder cannot understand a future representation.
 */
export interface TerminalInputApprovalDetails {
  terminalId: string;
  input: string;
}

export function terminalInputApprovalDetailsFromCommand(command: unknown): TerminalInputApprovalDetails | undefined {
  if (Array.isArray(command)) {
    if (!command.every((part): part is string => typeof part === "string")) return undefined;
    return terminalInputApprovalDetailsFromParts(command);
  }
  if (typeof command !== "string" || !command) return undefined;
  const parts = splitPosixShellWords(command);
  return parts ? terminalInputApprovalDetailsFromParts(parts) : undefined;
}

function terminalInputApprovalDetailsFromParts(parts: string[]): TerminalInputApprovalDetails | undefined {
  if (parts.length !== 4 || parts[0] !== "write_stdin" || parts[1] !== "--session-id" || !parts[2]) return undefined;
  return { terminalId: parts[2], input: parts[3] ?? "" };
}

/**
 * Minimal POSIX-word decoder for the `shlex::try_join` representation used by
 * the current app-server. It does not execute or interpret shell syntax.
 */
function splitPosixShellWords(command: string): string[] | undefined {
  const parts: string[] = [];
  let current = "";
  let hasCurrent = false;
  let quote: "single" | "double" | undefined;

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index] ?? "";
    if (quote === "single") {
      if (character === "'") quote = undefined;
      else current += character;
      hasCurrent = true;
      continue;
    }
    if (quote === "double") {
      if (character === '"') {
        quote = undefined;
      } else if (character === "\\") {
        index += 1;
        if (index >= command.length) return undefined;
        current += command[index] ?? "";
      } else {
        current += character;
      }
      hasCurrent = true;
      continue;
    }

    if (/\s/.test(character)) {
      if (hasCurrent) {
        parts.push(current);
        current = "";
        hasCurrent = false;
      }
      continue;
    }
    if (character === "'") {
      quote = "single";
      hasCurrent = true;
      continue;
    }
    if (character === '"') {
      quote = "double";
      hasCurrent = true;
      continue;
    }
    if (character === "\\") {
      index += 1;
      if (index >= command.length) return undefined;
      current += command[index] ?? "";
      hasCurrent = true;
      continue;
    }
    current += character;
    hasCurrent = true;
  }

  if (quote) return undefined;
  if (hasCurrent) parts.push(current);
  return parts;
}
