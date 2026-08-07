# review/nits

Non-blocking **style / taste** nits for code review: unfinished renames, TODO
landmines, and comments that admit temporary/obsolete state.

Not a correctness or design adversary. Compose into personas (e.g. torvalds)
for depth of “nit:” class gold; surface wording can still use the persona voice.

## Run

```sh
npm ci && npm test && npm run build
adversary run . --path /path/to/repo
```

## Rules

| Rule | Class |
|------|--------|
| `nits.todo_landmine` | TODO/FIXME/HACK without ticket/URL |
| `nits.unfinished_rename` | Dual old/new naming left in one file |
| `nits.stale_comment_marker` | Comments admitting temporary/obsolete code |

## Scope

See `agent/scope.md`.
