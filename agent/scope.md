# review/nits — mission and scope

Source of truth for what this adversary is *for*.

- **Package:** `review/nits` (keep in sync with `adversary.yaml`)
- **Factory / train routing:** human PR comments are attributed here only when they match **In scope**.
- **Languages / surfaces:** Any language (nits are cross-cutting).

## Mission

Catch **non-blocking maintainer taste**: naming, comment hygiene, unfinished cleanup, and consistency that a careful human would still mention without treating as a defect.

This is **not** a correctness detector, security tool, or staff-level design review.

## In scope (fair miss if a human raised it and we did not)

- “Nit:” / style / rename / formatting taste on the change
- Names that lie or confuse (without claiming a logic bug)
- Stale, wrong, or noise comments on touched lines
- Unfinished renames (old and new names both left behind)
- Landmine TODOs/FIXMEs introduced without ownership
- Consistency with surrounding code when the inconsistency is pure taste
- Changed error names that contradict two independent, same-scope operation-domain signals
- Redundant cleanup when an in-scope downstream recorder explicitly applies the same operation

## Out of scope (not a miss for this package)

- Real defects, races, security, API design judgment → specialists / eng-review
- Over-abstraction as the main issue → `review/complexity`
- “This whole stack is wrong” persona posture → persona packages (e.g. torvalds)
- CI / packaging / framework-specific idioms → domain packages
- Pure format-only diffs with no human-style judgment (optional ignore)
- Error-domain guesses based only on abbreviations, a single clue, tests/generated code, or unchanged legacy code

## Factory grading rule

- **In scope + human raised it + this adversary did not surface an equivalent class** → miss for **review/nits**
- **Out of scope** → do not grade as a miss here
- Prefer this package over eng-review for pure nits so eng-review is not a dump
