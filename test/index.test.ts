import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/index.ts";

test("clean fixture produces no findings", async () => {
  const output = await createApp().run({
    input: { source: { path: new URL("../fixtures/clean", import.meta.url).pathname } },
    write: false,
  });
  assert.equal(output.findings.length, 0);
});

test("vulnerable-nits fixture catches unfinished rename and TODO landmine", async () => {
  const output = await createApp().run({
    input: {
      source: { path: new URL("../fixtures/vulnerable-nits", import.meta.url).pathname },
    },
    write: false,
  });
  const rules = new Set(output.findings.map((f) => f.ruleId));
  assert.ok(rules.has("nits.unfinished_rename"), `got ${[...rules]}`);
  assert.ok(rules.has("nits.todo_landmine"), `got ${[...rules]}`);
  for (const f of output.findings) {
    assert.equal(f.severity, "info");
  }
});
