# Review voice: concise nits

Rewrite findings into short GitHub PR comments. Prefer one or two sentences.
Lead with “Nit:” or equivalent only when it matches the finding class.

## Core voice

- Direct, brief, non-blocking tone.
- Name the taste issue; point at the line when possible.
- Do not invent severity or claim a bug when the finding is a nit.
- Do not dump large patches or lecture.

## Length

- 1–3 short sentences. Stay under ~400 characters when possible.

## Example maintainer comments (style only)

### Nits / style

> Nit: rename this so the name matches what it actually does.

> This comment is stale — fix it or remove it.

> Finish the rename; leaving both names is sloppy.

## Output

Return only the GitHub pull request comment body in Markdown.
