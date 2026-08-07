#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { Adversary, Severity, log } from "@adversarylabs/sdk";
const TODO_LANDMINE = /\b(TODO|FIXME|XXX|HACK)\b(?![^\n]{0,80}\b(https?:\/\/|#[0-9]+|[A-Z]+-\d+)\b)/i;
// Dual naming left after a partial rename (common maintainer nit).
const UNFINISHED_RENAME_PAIRS = [
    { a: /\bold[A-Z_]/, b: /\bnew[A-Z_]/, label: "old*/new* dual naming" },
    { a: /\b\w+Legacy\b/, b: /\b\w+V2\b/, label: "Legacy*/V2* dual naming" },
    { a: /\b\w+_old\b/i, b: /\b\w+_new\b/i, label: "_old/_new dual naming" },
];
export function createApp() {
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
            if (emitted >= 3)
                break;
            if (shouldSkipPath(source.path))
                continue;
            const content = source.content || "";
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i] ?? "";
                if (!isCommentish(line, source.path) && !TODO_LANDMINE.test(line))
                    continue;
                if (!TODO_LANDMINE.test(line))
                    continue;
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
                    summary: "A TODO/FIXME/HACK was introduced without a ticket or URL. That tends to rot.",
                    evidence: [
                        {
                            file: rel(ctx, source.path),
                            line: i + 1,
                            message: line.trim().slice(0, 160),
                        },
                    ],
                    recommendation: "Attach an issue/URL, or fix the underlying problem before landing. Do not leave anonymous landmines.",
                });
                emitted++;
                break;
            }
        }
    });
    app.rule("nits.unfinished_rename", async (ctx) => {
        const sources = await ctx.loadInScopeSources({ limit: 150 });
        for (const source of sources) {
            if (shouldSkipPath(source.path))
                continue;
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
                        recommendation: "Complete the rename in one change, or remove the obsolete symbol so only one name remains.",
                    });
                    return;
                }
            }
        }
    });
    app.rule("nits.stale_comment_marker", async (ctx) => {
        const sources = await ctx.loadInScopeSources({ limit: 150 });
        const stale = /\b(this (is|was) (no longer|not) used|obsolete|remove this later|temporary hack)\b/i;
        let emitted = 0;
        for (const source of sources) {
            if (emitted >= 2)
                break;
            if (shouldSkipPath(source.path))
                continue;
            const lines = (source.content || "").split("\n");
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i] ?? "";
                if (!isCommentish(line, source.path))
                    continue;
                if (!stale.test(line))
                    continue;
                ctx.finding({
                    ruleId: "nits.stale_comment_marker",
                    category: "style",
                    severity: Severity.Info,
                    confidence: "low",
                    title: "Comment admits temporary/obsolete state",
                    summary: "Comment language suggests temporary or obsolete code left in place. Clean it up or remove the comment and the code.",
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
    return app;
}
function rel(ctx, path) {
    return ctx.relpath ? ctx.relpath(path) : path;
}
function shouldSkipPath(path) {
    const p = path.replace(/\\/g, "/");
    return (p.includes("/.git/") ||
        p.includes("node_modules/") ||
        p.includes("/dist/") ||
        p.endsWith(".gitkeep") ||
        p.endsWith("package-lock.json"));
}
function isCommentish(line, path) {
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("#") || t.startsWith("*") || t.startsWith("/*")) {
        return true;
    }
    if (path.endsWith(".md"))
        return true;
    return /\/\/.*\b(TODO|FIXME|XXX|HACK)\b/i.test(line);
}
const app = createApp();
export default app;
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await app.runFromEnvironment();
}
