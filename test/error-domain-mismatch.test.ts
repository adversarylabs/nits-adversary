import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createApp } from "../src/index.ts";

const execute = promisify(execFile);
const ruleId = "nits.error_domain_mismatch";

test("reports the Youki monitoring operation mapped to a CLOS-specific error", async () => {
  const result = await changedFinding(
    "src/intel_rdt.rs",
    youkiSource("CreateMonitoringDirectory"),
    youkiSource("CreateClosIDDirectory"),
  );

  assert.equal(result.findings.length, 1);
  const finding = result.findings[0];
  assert.equal(finding?.ruleId, ruleId);
  assert.equal(finding?.severity, "info");
  assert.equal(finding?.confidence, "medium");
  assert.match(finding?.summary ?? "", /CreateClosIDDirectory.*clos.*monitoring/i);
  assert.deepEqual(
    finding?.evidence.map((evidence) => evidence.location?.line),
    [1, 5, 6],
  );
});

test("the accepted monitoring-specific error is quiet", async () => {
  const result = await changedFinding(
    "src/intel_rdt.rs",
    youkiSource("CreateClosIDDirectory"),
    youkiSource("CreateMonitoringDirectory"),
  );
  assert.equal(hasRule(result), false);
});

test("reports the same mechanism in a different language and domain", async () => {
  const before = billingSource("BillingProfileError", "billing profile persistence failed");
  const after = billingSource("SessionTokenError", "session token persistence failed");
  const result = await changedFinding("src/profile.ts", before, after);

  const finding = result.findings.find((item) => item.ruleId === ruleId);
  assert.match(finding?.summary ?? "", /SessionTokenError.*session.*billing/i);
  assert.ok(finding?.evidence.some((evidence) => evidence.location?.line === 5));
});

test("generic and shared error variants stay quiet", async () => {
  for (const variant of ["Directory", "Operation", "Io"]) {
    const result = await changedFinding(
      "src/intel_rdt.rs",
      youkiSource("CreateMonitoringDirectory"),
      youkiSource(variant),
    );
    assert.equal(hasRule(result), false, variant);
  }
});

test("compatibility aliases and deliberate normalization stay quiet", async () => {
  const result = await changedFinding(
    "src/intel_rdt.rs",
    youkiSource("CreateMonitoringDirectory"),
    youkiSource("CreateClosIDDirectory", "// Compatibility alias retained for wire-format clients."),
  );
  assert.equal(hasRule(result), false);
});

test("one weak lexical clue and uncertain abbreviations do not prove a domain", async () => {
  const source = (variant: string) => `fn setup_mon_group(mon_dir: &Path) -> Result<bool> {
    fs::create_dir_all(mon_dir).map_err(|err| {
        tracing::error!("failed to create monitoring subdirectory: {}", err);
        IntelRdtError::${variant}(err)
    })?;
    Ok(true)
}
`;
  const result = await changedFinding(
    "src/intel_rdt.rs",
    source("CreateMonitoringDirectory"),
    source("CreateClosIDDirectory"),
  );
  assert.equal(hasRule(result), false);
});

test("an unrelated sibling operation does not borrow the function name as evidence", async () => {
  const source = (variant: string) => `fn setup_monitoring_group(cache_path: &Path) -> Result<bool> {
    cache::create(cache_path).map_err(|err| {
        tracing::error!("failed to update monitoring metadata: {}", err);
        IntelRdtError::${variant}(err)
    })?;
    Ok(true)
}
`;
  const result = await changedFinding(
    "src/intel_rdt.rs",
    source("MonitoringMetadata"),
    source("CreateClosIDDirectory"),
  );
  assert.equal(hasRule(result), false);
});

test("a nearby but unrelated error construction is not treated as the operation mapping", async () => {
  const source = (variant: string) => `fn setup_monitoring_group(mon_dir: &Path) -> Result<bool> {
    fs::create_dir_all(mon_dir)?;
    tracing::error!("monitoring metrics are disabled");
    if feature_disabled() {
        return Err(IntelRdtError::${variant}(io_error()));
    }
    Ok(true)
}
`;
  const result = await changedFinding(
    "src/intel_rdt.rs",
    source("CreateMonitoringDirectory"),
    source("CreateClosIDDirectory"),
  );
  assert.equal(hasRule(result), false);
});

test("unchanged legacy mismatches and unrelated diffs stay quiet", async () => {
  const before = `${youkiSource("CreateClosIDDirectory")}\nconst DIAGNOSTIC: &str = "old";\n`;
  const after = `${youkiSource("CreateClosIDDirectory")}\nconst DIAGNOSTIC: &str = "new";\n`;
  const result = await changedFinding("src/intel_rdt.rs", before, after);
  assert.equal(hasRule(result), false);
});

test("an inline comment-only edit on the construction stays quiet", async () => {
  const before = youkiSource("CreateClosIDDirectory", "// old wording");
  const after = youkiSource("CreateClosIDDirectory", "// clearer wording");
  const result = await changedFinding("src/intel_rdt.rs", before, after);
  assert.equal(hasRule(result), false);
});

test("test, fixture, generated, and vendor paths stay quiet", async () => {
  for (const path of [
    "tests/intel_rdt.rs",
    "fixtures/intel_rdt.rs",
    "generated/intel_rdt.rs",
    "vendor/intel_rdt.rs",
    "src/intel_rdt_test.go",
    "src/intel_rdt.spec.ts",
  ]) {
    const result = await changedFinding(
      path,
      youkiSource("CreateMonitoringDirectory"),
      youkiSource("CreateClosIDDirectory"),
    );
    assert.equal(hasRule(result), false, path);
  }
});

test("comments and strings that only mention an error constructor stay quiet", async () => {
  const before = `function setupMonitoringGroup() {
  storage.create(monitoringPath);
  logger.error("failed to create monitoring group");
  return "IntelRdtError::CreateMonitoringDirectory(err)";
}
`;
  const after = before.replace("CreateMonitoringDirectory", "CreateClosIDDirectory");
  const result = await changedFinding("src/monitoring.ts", before, after);
  assert.equal(hasRule(result), false);
});

function youkiSource(variant: string, suffix = ""): string {
  return `fn setup_monitoring_group(mon_dir: &Path) -> Result<bool> {
    let mut created_dir = false;
    if !mon_dir.exists() {
        fs::create_dir_all(mon_dir).map_err(|err| {
            tracing::error!("failed to create resctrl monitoring subdirectory: {}", err);
            IntelRdtError::${variant}(err) ${suffix}
        })?;
        created_dir = true;
    }
    Ok(created_dir)
}
`;
}

function billingSource(errorName: string, message: string): string {
  return `export async function persistBillingProfile(billingProfilePath: string): Promise<void> {
  await storage.write(billingProfilePath, payload).catch((cause) => {
    logger.error("failed to persist billing profile", cause);
    observe(cause);
    throw new ${errorName}("${message}");
  });
}
`;
}

async function changedFinding(path: string, before: string, after: string) {
  const repository = await mkdtemp(join(tmpdir(), "nits-error-domain-"));
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
      change: {
        type: "diff",
        base_ref: "HEAD",
        head_ref: "WORKTREE",
        scan_mode: "changed",
        changed_files: [path],
      },
    },
    write: false,
  });
}

function hasRule(result: Awaited<ReturnType<ReturnType<typeof createApp>["run"]>>): boolean {
  return result.findings.some((finding) => finding.ruleId === ruleId);
}
