import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test("bundled runtime executes without node_modules and reports its release version", async () => {
  const artifact = await mkdtemp(join(tmpdir(), "nits-artifact-"));
  const target = await mkdtemp(join(tmpdir(), "nits-target-"));
  const entrypoint = join(artifact, "dist", "index.js");
  await mkdir(dirname(entrypoint), { recursive: true });
  await copyFile(join(projectRoot, "dist", "index.js"), entrypoint);
  await writeFile(join(artifact, "package.json"), '{"type":"module"}\n');
  await writeFile(join(target, "clean.ts"), "export const ready = true;\n");

  const runtime = await import(pathToFileURL(entrypoint).href) as {
    createApp(): {
      run(options: { input: unknown; write: boolean }): Promise<{
        adversary: { name: string; version?: string };
        findings: unknown[];
      }>;
    };
  };
  const result = await runtime.createApp().run({
    input: { source: { path: target } },
    write: false,
  });

  assert.equal(result.adversary.name, "review/nits");
  assert.equal(result.adversary.version, "0.0.5");
  assert.deepEqual(result.findings, []);
});
