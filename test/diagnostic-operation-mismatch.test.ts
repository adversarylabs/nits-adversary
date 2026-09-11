import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createApp } from "../src/index.ts";

const execute = promisify(execFile);

test("reports a disable endpoint diagnostic that still describes login", async () => {
  const result = await changedFinding(
    "pages/api/two-factor/disable.ts",
    'console.error("Missing encryption key; cannot proceed with two factor disable.");\n',
    'console.error("Missing encryption key; cannot proceed with backup code login.");\n',
  );
  const finding = result.findings.find((item) => item.ruleId === "nits.diagnostic_operation_mismatch");
  assert.ok(finding);
  assert.equal(finding.severity, "info");
  assert.match(finding.summary, /disable handler.*login/i);
});

test("matching operation and immediate verification wording stay quiet", async () => {
  for (const message of [
    "Missing encryption key; cannot disable two factor authentication.",
    "Missing encryption key; cannot verify the supplied backup code.",
  ]) {
    const result = await changedFinding(
      "pages/api/two-factor/disable.ts",
      'console.error("old diagnostic");\n',
      `console.error("${message}");\n`,
    );
    assert.equal(result.findings.some((item) => item.ruleId === "nits.diagnostic_operation_mismatch"), false);
  }
});

test("operation words inside the affected resource stay quiet", async () => {
  for (const [operation, message] of [
    ["delete", "Failed to delete login session."],
    ["disable", "Unable to disable the login challenge."],
  ]) {
    const result = await changedFinding(
      `pages/api/two-factor/${operation}.ts`,
      'console.error("old diagnostic");\n',
      `console.error("${message}");\n`,
    );
    assert.equal(result.findings.some((item) => item.ruleId === "nits.diagnostic_operation_mismatch"), false);
  }
});

test("ordinary files do not infer an operation from diagnostic text alone", async () => {
  const result = await changedFinding(
    "src/auth.ts",
    'console.error("old diagnostic");\n',
    'console.error("Unable to login with a backup code");\n',
  );
  assert.equal(result.findings.some((item) => item.ruleId === "nits.diagnostic_operation_mismatch"), false);
});

async function changedFinding(path: string, before: string, after: string) {
  const repository = await mkdtemp(join(tmpdir(), "nits-operation-diagnostic-"));
  await execute("git", ["init", "--quiet"], { cwd: repository });
  await execute("git", ["config", "user.email", "tests@example.com"], { cwd: repository });
  await execute("git", ["config", "user.name", "Tests"], { cwd: repository });
  await mkdir(dirname(join(repository, path)), { recursive: true });
  await writeFile(join(repository, path), before);
  await execute("git", ["add", path], { cwd: repository });
  await execute("git", ["commit", "--quiet", "-m", "fixture"], { cwd: repository });
  await writeFile(join(repository, path), after);
  return createApp().run({
    input: {
      source: { path: repository },
      change: { type: "diff", base_ref: "HEAD", head_ref: "WORKTREE", scan_mode: "changed", changed_files: [path] },
    },
    write: false,
  });
}
