import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test("the tracked bundled runtime executes without node_modules and reports its release version", async () => {
  const artifact = await mkdtemp(join(tmpdir(), "nits-artifact-"));
  const target = await mkdtemp(join(tmpdir(), "nits-target-"));
  const archive = join(artifact, "package.tar");
  const runtimeFiles = [
    "adversary.yaml",
    "dist/index.js",
    "schemas/adversary.review.v1.schema.json",
    "THIRD_PARTY_NOTICES.md",
    "package.json",
  ];

  const ignored = (await readFile(join(projectRoot, ".adversaryignore"), "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  assert.ok(ignored.includes(".git"));
  assert.ok(ignored.includes("node_modules/"));
  for (const path of runtimeFiles) {
    await execute("git", ["ls-files", "--error-unmatch", path], { cwd: projectRoot });
  }

  await execute("git", [
    "archive",
    "--format=tar",
    `--output=${archive}`,
    "HEAD",
    ...runtimeFiles,
  ], { cwd: projectRoot });
  const { stdout: listing } = await execute("tar", ["-tf", archive]);
  const inventory = listing.split(/\r?\n/).filter(Boolean);
  for (const path of inventory) {
    assert.equal(path.split("/").includes("node_modules"), false, `${path} must not ship`);
    assert.equal(path.split("/").includes(".git"), false, `${path} must not ship`);
  }
  await execute("tar", ["-xf", archive, "-C", artifact]);

  for (const path of runtimeFiles) {
    const content = await readFile(join(artifact, path), "utf8");
    assert.doesNotMatch(content, /\/Users\/[^/\s]+|\/private\/tmp\/|[A-Za-z]:\\Users\\/);
  }
  const bundle = await readFile(join(artifact, "dist", "index.js"), "utf8");
  assert.doesNotMatch(bundle, /from\s+["']@adversarylabs\/sdk["']/);
  const notices = await readFile(join(artifact, "THIRD_PARTY_NOTICES.md"), "utf8");
  assert.deepEqual([...notices.matchAll(/^## (.+?) \(/gm)].map((match) => match[1]), [
    "@adversarylabs/sdk",
    "ajv",
    "fast-deep-equal",
    "fast-uri",
    "json-schema-traverse",
    "yaml",
  ]);
  assert.match(notices, /Permission is hereby granted/);
  assert.match(notices, /Redistribution and use in source and binary forms/);

  const entrypoint = join(artifact, "dist", "index.js");
  const runtime = await import(pathToFileURL(entrypoint).href) as {
    createApp(): {
      run(options: { input: unknown; write: boolean }): Promise<{
        adversary: { name: string; version?: string };
        findings: Array<{ ruleId?: string }>;
      }>;
    };
  };

  await execute("git", ["init", "--quiet"], { cwd: target });
  await execute("git", ["config", "user.email", "tests@example.com"], { cwd: target });
  await execute("git", ["config", "user.name", "Tests"], { cwd: target });
  await mkdir(join(target, "src"), { recursive: true });
  await writeFile(
    join(target, "src", "intel_rdt.rs"),
    monitoringSource("CreateMonitoringDirectory"),
  );
  await execute("git", ["add", "src/intel_rdt.rs"], { cwd: target });
  await execute("git", ["commit", "--quiet", "-m", "fixture"], { cwd: target });
  await writeFile(
    join(target, "src", "intel_rdt.rs"),
    monitoringSource("CreateClosIDDirectory"),
  );

  const result = await runtime.createApp().run({
    input: {
      source: { path: target },
      change: {
        type: "diff",
        base_ref: "HEAD",
        head_ref: "WORKTREE",
        scan_mode: "changed",
        changed_files: ["src/intel_rdt.rs"],
      },
    },
    write: false,
  });

  assert.equal(result.adversary.name, "review/nits");
  assert.equal(result.adversary.version, "0.0.9");
  assert.equal(
    result.findings.filter((finding) => finding.ruleId === "nits.error_domain_mismatch").length,
    1,
  );
});

function monitoringSource(variant: string): string {
  return `fn setup_monitoring_group(mon_dir: &Path) -> Result<bool> {
    fs::create_dir_all(mon_dir).map_err(|err| {
        tracing::error!("failed to create monitoring subdirectory: {}", err);
        IntelRdtError::${variant}(err)
    })?;
    Ok(true)
}
`;
}
