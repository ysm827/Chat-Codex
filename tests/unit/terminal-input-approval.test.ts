import test from "node:test";
import assert from "node:assert/strict";
import { terminalInputApprovalDetailsFromCommand } from "../../src/codex/app-server/terminal-input-approval.js";

test("terminal-input approval decoder preserves the exact terminal and stdin from Codex shlex text", () => {
  assert.deepEqual(
    terminalInputApprovalDetailsFromCommand("write_stdin --session-id 42 'confirm\n'"),
    { terminalId: "42", input: "confirm\n" },
  );
  assert.deepEqual(
    terminalInputApprovalDetailsFromCommand("write_stdin --session-id 42 'it'\"'\"'s\\n'"),
    { terminalId: "42", input: "it's\\n" },
  );
});

test("terminal-input approval decoder accepts legacy array commands without losing input boundaries", () => {
  assert.deepEqual(
    terminalInputApprovalDetailsFromCommand(["write_stdin", "--session-id", "42", "confirm\n\t"]),
    { terminalId: "42", input: "confirm\n\t" },
  );
});

test("terminal-input approval decoder rejects malformed or ambiguous representations", () => {
  assert.equal(terminalInputApprovalDetailsFromCommand("write_stdin --session-id 42"), undefined);
  assert.equal(terminalInputApprovalDetailsFromCommand("write_stdin --session-id 42 confirm extra"), undefined);
  assert.equal(terminalInputApprovalDetailsFromCommand("write_stdin --session-id 42 'unterminated"), undefined);
});
