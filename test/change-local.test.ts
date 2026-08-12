import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createApp } from "../src/index.ts";

const execute = promisify(execFile);

test("an unrelated edit does not surface legacy line-local nits", async () => {
  const repo = await fixtureRepository("review.ts", directNits("old diagnostic"));
  await writeFile(join(repo, "review.ts"), directNits("new diagnostic"));

  const result = await changedReview(repo, ["review.ts"]);
  assert.equal(hasRule(result, "nits.todo_landmine"), false);
  assert.equal(hasRule(result, "nits.stale_comment_marker"), false);
});

test("an added file remains fully eligible", async () => {
  const repo = await fixtureRepository("existing.ts", "export const value = 1;\n");
  await writeFile(join(repo, "added.ts"), "// TODO: replace this placeholder\n");

  const result = await changedReview(repo, ["added.ts"]);
  assert.equal(hasRule(result, "nits.todo_landmine"), true);
});

test("an unchanged first TODO does not hide a later changed TODO", async () => {
  const repo = await fixtureRepository("review.ts", todos("#123"));
  await writeFile(join(repo, "review.ts"), todos("owned before landing"));

  const result = await changedReview(repo, ["review.ts"]);
  const finding = result.findings.find((item) => item.ruleId === "nits.todo_landmine");
  assert.equal(finding?.evidence[0]?.location?.line, 2);
  assert.match(finding?.evidence[0]?.message ?? "", /owned before landing/);
});

test("an unrelated edit does not surface a legacy unfinished rename", async () => {
  const repo = await fixtureRepository("rename.ts", renamePair("old diagnostic"));
  await writeFile(join(repo, "rename.ts"), renamePair("new diagnostic"));

  const result = await changedReview(repo, ["rename.ts"]);
  assert.equal(hasRule(result, "nits.unfinished_rename"), false);
});

test("a changed rename side uses the unchanged counterpart as context", async () => {
  const repo = await fixtureRepository("rename.ts", singleOldName());
  await writeFile(join(repo, "rename.ts"), `${singleOldName()}const newProcess = oldProcess;\n`);

  const result = await changedReview(repo, ["rename.ts"]);
  const finding = result.findings.find((item) => item.ruleId === "nits.unfinished_rename");
  assert.equal(finding?.evidence[0]?.location?.line, 3);
});

test("an unrelated edit does not surface legacy redundant masking", async () => {
  const repo = await fixtureRepository("masking.ts", maskingSource(true, true, "old"));
  await writeFile(join(repo, "masking.ts"), maskingSource(true, true, "new"));

  const result = await changedReview(repo, ["masking.ts"]);
  assert.equal(hasRule(result, "nits.redundant_secret_masking"), false);
});

test("a changed masking call uses an unchanged recorder guarantee", async () => {
  const repo = await fixtureRepository("masking.ts", maskingSource(true, false, "fixture"));
  await writeFile(join(repo, "masking.ts"), maskingSource(true, true, "fixture"));

  const result = await changedReview(repo, ["masking.ts"]);
  const finding = result.findings.find(
    (item) => item.ruleId === "nits.redundant_secret_masking",
  );
  assert.deepEqual(
    finding?.evidence.map((evidence) => evidence.location?.line),
    [6, 10],
  );
});

test("a changed recorder guarantee can expose an unchanged redundant call", async () => {
  const repo = await fixtureRepository("masking.ts", maskingSource(false, true, "fixture"));
  await writeFile(join(repo, "masking.ts"), maskingSource(true, true, "fixture"));

  const result = await changedReview(repo, ["masking.ts"]);
  assert.equal(hasRule(result, "nits.redundant_secret_masking"), true);
});

test("an unrelated Dockerfile edit does not surface a legacy indentation outlier", async () => {
  const repo = await fixtureRepository("Dockerfile", dockerfile("old"));
  await writeFile(join(repo, "Dockerfile"), dockerfile("new"));

  const result = await changedReview(repo, ["Dockerfile"]);
  assert.equal(hasRule(result, "nits.dockerfile_run_indentation"), false);
});

async function fixtureRepository(path: string, content: string): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "nits-change-local-"));
  await execute("git", ["init", "--quiet"], { cwd: repo });
  await execute("git", ["config", "user.email", "tests@example.com"], { cwd: repo });
  await execute("git", ["config", "user.name", "Tests"], { cwd: repo });
  await writeFile(join(repo, path), content);
  await execute("git", ["add", path], { cwd: repo });
  await execute("git", ["commit", "--quiet", "-m", "fixture"], { cwd: repo });
  return repo;
}

function directNits(diagnostic: string): string {
  return `// TODO: remove this placeholder
// this is no longer used
export const diagnostic = ${JSON.stringify(diagnostic)};
`;
}

function todos(secondOwner: string): string {
  return `// TODO: legacy anonymous task
// TODO: ${secondOwner}
`;
}

function singleOldName(): string {
  return "const oldProcess = () => 1;\n\n";
}

function renamePair(diagnostic: string): string {
  return `${singleOldName()}const newProcess = oldProcess;
const diagnostic = ${JSON.stringify(diagnostic)};
`;
}

function maskingSource(
  guaranteeMasks: boolean,
  callMasks: boolean,
  diagnostic: string,
): string {
  return `function maskSecrets(value: string): string {
  return value;
}

function recordAudit(value: string): void {
  auditStore.append(${guaranteeMasks ? "maskSecrets(value)" : "value"});
}

export function handle(value: string): void {
  recordAudit(${callMasks ? "maskSecrets(value)" : "value"});
}

export const diagnostic = ${JSON.stringify(diagnostic)};
`;
}

function dockerfile(diagnostic: string): string {
  return `FROM debian:stable-slim
RUN echo one && \\
    echo two && \\
    echo three && \\
     echo four && \\
    echo five
ENV DIAGNOSTIC=${JSON.stringify(diagnostic)}
`;
}

function hasRule(result: Awaited<ReturnType<ReturnType<typeof createApp>["run"]>>, rule: string) {
  return result.findings.some((finding) => finding.ruleId === rule);
}

async function changedReview(repoPath: string, changedFiles: string[]) {
  return createApp().run({
    input: {
      source: { path: repoPath },
      change: {
        type: "diff",
        base_ref: "HEAD",
        head_ref: "WORKTREE",
        scan_mode: "changed",
        changed_files: changedFiles,
      },
    },
  });
}
