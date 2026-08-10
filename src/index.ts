#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { Adversary, Severity, log } from "@adversarylabs/sdk";

const TODO_LANDMINE =
  /\b(TODO|FIXME|XXX|HACK)\b(?![^\n]{0,80}\b(https?:\/\/|#[0-9]+|[A-Z]+-\d+)\b)/i;

// Dual naming left after a partial rename (common maintainer nit).
const UNFINISHED_RENAME_PAIRS: Array<{ a: RegExp; b: RegExp; label: string }> = [
  { a: /\bold[A-Z_]/, b: /\bnew[A-Z_]/, label: "old*/new* dual naming" },
  { a: /\b\w+Legacy\b/, b: /\b\w+V2\b/, label: "Legacy*/V2* dual naming" },
  { a: /\b\w+_old\b/i, b: /\b\w+_new\b/i, label: "_old/_new dual naming" },
];

const RECORDER_NAME = /(?:record|logger|trace|issue|audit|persist)/i;
const SECRET_MASKER_NAME = /(?:mask|redact|saniti[sz]e|scrub)/i;

interface MaskingGuarantee {
  recorder: string;
  sanitizer: string;
  path: string;
  line: number;
  start: number;
  end: number;
}

export function createApp(): Adversary {
  const app = new Adversary({
    name: "review/nits",
    // Nits are intentionally Severity.Info; surface them rather than drop as noise.
    review: {
      maximumFindings: 8,
      minimumConfidence: "medium",
      includeInformational: true,
    },
  });

  app.rule("nits.todo_landmine", async (ctx) => {
    const sources = await ctx.loadInScopeSources({ limit: 150 });
    let emitted = 0;
    for (const source of sources) {
      if (emitted >= 3) break;
      if (shouldSkipPath(source.path)) continue;
      const content = source.content || "";
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        if (!isCommentish(line, source.path) && !TODO_LANDMINE.test(line)) continue;
        if (!TODO_LANDMINE.test(line)) continue;
        // Require TODO-like token on a comment or end-of-line note.
        if (!isCommentish(line, source.path) && !/\b(TODO|FIXME|XXX|HACK)\b/.test(line)) {
          continue;
        }
        log.info(`TODO landmine in ${source.path}:${i + 1}`);
        ctx.finding({
          ruleId: "nits.todo_landmine",
          category: "style",
          severity: Severity.Info,
          confidence: "medium",
          title: "TODO landmine without ownership",
          summary:
            "A TODO/FIXME/HACK was introduced without a ticket or URL. That tends to rot.",
          evidence: [
            {
              file: rel(ctx, source.path),
              line: i + 1,
              message: line.trim().slice(0, 160),
            },
          ],
          recommendation:
            "Attach an issue/URL, or fix the underlying problem before landing. Do not leave anonymous landmines.",
        });
        emitted++;
        break;
      }
    }
  });

  app.rule("nits.unfinished_rename", async (ctx) => {
    const sources = await ctx.loadInScopeSources({ limit: 150 });
    for (const source of sources) {
      if (shouldSkipPath(source.path)) continue;
      const content = source.content || "";
      for (const pair of UNFINISHED_RENAME_PAIRS) {
        if (pair.a.test(content) && pair.b.test(content)) {
          log.info(`Unfinished rename pattern in ${source.path}`);
          ctx.finding({
            ruleId: "nits.unfinished_rename",
            category: "style",
            severity: Severity.Info,
            confidence: "medium",
            title: "Possible unfinished rename",
            summary: `Both sides of a rename still appear (${pair.label}). Finish the rename or drop the dead name.`,
            evidence: [
              {
                file: rel(ctx, source.path),
                message: pair.label,
              },
            ],
            recommendation:
              "Complete the rename in one change, or remove the obsolete symbol so only one name remains.",
          });
          return;
        }
      }
    }
  });

  app.rule("nits.stale_comment_marker", async (ctx) => {
    const sources = await ctx.loadInScopeSources({ limit: 150 });
    const stale =
      /\b(this (is|was) (no longer|not) used|obsolete|remove this later|temporary hack)\b/i;
    let emitted = 0;
    for (const source of sources) {
      if (emitted >= 2) break;
      if (shouldSkipPath(source.path)) continue;
      const lines = (source.content || "").split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        if (!isCommentish(line, source.path)) continue;
        if (!stale.test(line)) continue;
        ctx.finding({
          ruleId: "nits.stale_comment_marker",
          category: "style",
          severity: Severity.Info,
          confidence: "low",
          title: "Comment admits temporary/obsolete state",
          summary:
            "Comment language suggests temporary or obsolete code left in place. Clean it up or remove the comment and the code.",
          evidence: [
            {
              file: rel(ctx, source.path),
              line: i + 1,
              message: line.trim().slice(0, 160),
            },
          ],
          recommendation: "Either finish the cleanup or drop the dead path and comment.",
        });
        emitted++;
        break;
      }
    }
  });

  app.rule("nits.redundant_secret_masking", async (ctx) => {
    const sources = await ctx.loadInScopeSources({ limit: 150 });
    const guarantees = sources.flatMap((source) =>
      findMaskingGuarantees(source.path, source.content || ""),
    );
    let emitted = 0;

    for (const source of sources) {
      if (emitted >= 3) break;
      if (shouldSkipPath(source.path)) continue;
      const lines = (source.content || "").split("\n");
      let offset = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        const guarantee = guarantees.find(
          (candidate) =>
            candidate.path === source.path &&
            !(
              offset >= candidate.start &&
              offset < candidate.end
            ) && containsNestedMaskingCall(line, candidate),
        );
        if (guarantee === undefined) {
          offset += line.length + 1;
          continue;
        }

        ctx.finding({
          ruleId: "nits.redundant_secret_masking",
          category: "style",
          severity: Severity.Info,
          confidence: "medium",
          title: "Redundant secret masking before recorder",
          summary: `${guarantee.recorder} already applies ${guarantee.sanitizer} before emitting this value, so masking it at the call site is redundant.`,
          evidence: [
            {
              file: rel(ctx, source.path),
              line: i + 1,
              message: line.trim().slice(0, 160),
            },
            {
              file: rel(ctx, guarantee.path),
              line: guarantee.line,
              message: `${guarantee.recorder} applies ${guarantee.sanitizer} to its input`,
            },
          ],
          recommendation: `Pass the original value to ${guarantee.recorder} and let its ${guarantee.sanitizer} guarantee own the redaction.`,
        });
        emitted++;
        break;
      }
    }
  });

  app.rule("nits.dockerfile_run_indentation", async (ctx) => {
    const sources = await ctx.loadInScopeSources({
      include: isDockerfilePath,
      limit: 100,
    });
    let emitted = 0;

    for (const source of sources) {
      if (emitted >= 3) break;
      for (const outlier of findDockerfileRunIndentationOutliers(source.content || "")) {
        ctx.finding({
          ruleId: "nits.dockerfile_run_indentation",
          category: "style",
          severity: Severity.Info,
          confidence: "medium",
          title: "Inconsistent Dockerfile RUN indentation",
          summary: `This line uses ${outlier.actual} leading spaces while the adjacent continuation lines use ${outlier.expected}.`,
          evidence: [
            {
              file: rel(ctx, source.path),
              line: outlier.line,
              message: outlier.text.trim().slice(0, 160),
            },
          ],
          recommendation: `Align this continuation line to ${outlier.expected} leading spaces for consistency with the surrounding RUN block.`,
        });
        emitted++;
        break;
      }
    }
  });

  return app;
}

function rel(ctx: { relpath?: (p: string) => string }, path: string): string {
  return ctx.relpath ? ctx.relpath(path) : path;
}

function shouldSkipPath(path: string): boolean {
  const p = path.replace(/\\/g, "/");
  return (
    p.includes("/.git/") ||
    p.includes("node_modules/") ||
    p.includes("/dist/") ||
    p.endsWith(".gitkeep") ||
    p.endsWith("package-lock.json")
  );
}

interface IndentationOutlier {
  line: number;
  actual: number;
  expected: number;
  text: string;
}

function isDockerfilePath(path: string): boolean {
  const name = path.replace(/\\/g, "/").split("/").at(-1)?.toLowerCase() ?? "";
  return name === "dockerfile" || name.startsWith("dockerfile.") || name.endsWith(".dockerfile");
}

function findDockerfileRunIndentationOutliers(content: string): IndentationOutlier[] {
  const lines = content.split("\n");
  const outliers: IndentationOutlier[] = [];

  for (let runLine = 0; runLine < lines.length; runLine++) {
    const first = lines[runLine] ?? "";
    if (!/^\s*RUN\b/i.test(first) || !hasLineContinuation(first)) continue;

    let end = runLine;
    while (end + 1 < lines.length && hasLineContinuation(lines[end] ?? "")) end++;
    if (end - runLine < 3) {
      runLine = end;
      continue;
    }

    const block = lines.slice(runLine, end + 1);
    if (isStructurallyIndentedRunBlock(block)) {
      runLine = end;
      continue;
    }

    for (let current = runLine + 2; current < end; current++) {
      const previous = lines[current - 1] ?? "";
      const line = lines[current] ?? "";
      const next = lines[current + 1] ?? "";
      if (
        previous.trim() === "" ||
        line.trim() === "" ||
        next.trim() === "" ||
        /^\s*#/.test(line) ||
        /^[ \t]*\t/.test(previous) ||
        /^[ \t]*\t/.test(line) ||
        /^[ \t]*\t/.test(next)
      ) {
        continue;
      }

      const expected = leadingSpaces(previous);
      const actual = leadingSpaces(line);
      if (
        expected === 0 ||
        leadingSpaces(next) !== expected ||
        Math.abs(actual - expected) !== 1
      ) {
        continue;
      }

      outliers.push({ line: current + 1, actual, expected, text: line });
    }
    runLine = end;
  }

  return outliers;
}

function hasLineContinuation(line: string): boolean {
  return /\\\s*$/.test(line);
}

function leadingSpaces(line: string): number {
  return line.match(/^ */)?.[0].length ?? 0;
}

function isStructurallyIndentedRunBlock(lines: string[]): boolean {
  if (lines.some((line) => line.includes("<<"))) return true;

  return lines.some((line) => {
    const shell = line.trim().replace(/^(?:&&|\|\|)\s*/, "");
    return /^(?:if|then|elif|else|fi|for|while|until|case|esac|select|do|done)\b/.test(shell) ||
      /^[({]/.test(shell);
  });
}

function isCommentish(line: string, path: string): boolean {
  const t = line.trim();
  if (t.startsWith("//") || t.startsWith("#") || t.startsWith("*") || t.startsWith("/*")) {
    return true;
  }
  if (path.endsWith(".md")) return true;
  return /\/\/.*\b(TODO|FIXME|XXX|HACK)\b/i.test(line);
}

function findMaskingGuarantees(path: string, content: string): MaskingGuarantee[] {
  const guarantees: MaskingGuarantee[] = [];
  const signature = /(?:^|\n)[^\n{};]*?\b([A-Za-z_]\w*)\s*\(([^()\n]*)\)\s*(?:[^\n{]*)\{/g;
  const controlWords = new Set(["catch", "for", "if", "switch", "while"]);

  for (const match of content.matchAll(signature)) {
    const recorder = match[1];
    const parameters = match[2];
    if (
      recorder === undefined ||
      parameters === undefined ||
      controlWords.has(recorder) ||
      !RECORDER_NAME.test(recorder)
    ) {
      continue;
    }

    const open = (match.index ?? 0) + match[0].lastIndexOf("{");
    const end = matchingBrace(content, open);
    if (end === undefined) continue;
    const body = content.slice(open + 1, end);
    const parameterNames = extractParameterNames(parameters, path);
    const call = /\b(?:[A-Za-z_]\w*\.)*([A-Za-z_]\w*)\s*\(([^()\n]*)\)/g;

    for (const sanitizerCall of body.matchAll(call)) {
      const sanitizer = sanitizerCall[1];
      const args = sanitizerCall[2];
      const sanitizerOffset = sanitizerCall.index ?? 0;
      const sanitizerLine = body.slice(0, sanitizerOffset).split("\n").length;
      const line = body.split("\n")[sanitizerLine - 1] ?? "";
      if (
        sanitizer === undefined ||
        args === undefined ||
        !SECRET_MASKER_NAME.test(sanitizer) ||
        !parameterNames.some((parameter) =>
          new RegExp(`\\b${escapeRegex(parameter)}\\b`).test(args),
        ) ||
        !isTopLevelNestedCall(body, sanitizerOffset, line, sanitizer)
      ) {
        continue;
      }
      const sourceLine = content.slice(0, open + 1).split("\n").length + sanitizerLine - 1;
      guarantees.push({ recorder, sanitizer, path, line: sourceLine, start: open, end });
    }
  }

  return guarantees;
}

function isTopLevelNestedCall(
  body: string,
  sanitizerOffset: number,
  line: string,
  sanitizer: string,
): boolean {
  const prefix = body.slice(0, sanitizerOffset);
  const depth = [...prefix].reduce(
    (value, character) => value + (character === "{" ? 1 : character === "}" ? -1 : 0),
    0,
  );
  if (depth !== 0) return false;

  const beforeSanitizer = line.slice(0, line.search(new RegExp(`\\b${escapeRegex(sanitizer)}\\b`)));
  return /\b[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\s*\([^;]*$/.test(beforeSanitizer);
}

function extractParameterNames(parameters: string, path: string): string[] {
  return parameters
    .split(",")
    .map((parameter) => parameter.trim().split("=")[0]?.trim() ?? "")
    .map((parameter) => {
      const beforeType = parameter.split(":")[0]?.trim() ?? "";
      const identifiers = beforeType.match(/[A-Za-z_]\w*/g) ?? [];
      if (path.endsWith(".go")) return identifiers[0];
      return identifiers.at(-1);
    })
    .filter((parameter): parameter is string => parameter !== undefined);
}

function matchingBrace(content: string, open: number): number | undefined {
  let depth = 0;
  for (let i = open; i < content.length; i++) {
    if (content[i] === "{") depth++;
    if (content[i] === "}") depth--;
    if (depth === 0) return i + 1;
  }
  return undefined;
}

function containsNestedMaskingCall(line: string, guarantee: MaskingGuarantee): boolean {
  const recorder = escapeRegex(guarantee.recorder);
  const sanitizer = escapeRegex(guarantee.sanitizer);
  return new RegExp(`\\b${recorder}\\s*\\([^;\\n]*\\b${sanitizer}\\s*\\(`).test(line);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const app = createApp();
export default app;

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await app.runFromEnvironment();
}
