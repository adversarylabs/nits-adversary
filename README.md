# Nits adversary

Non-blocking style and taste nits — naming, stale comments, unfinished renames, and similar maintainer cleanup. Not correctness; not a full design review.

## Goals

The adversary is designed to produce a small number of high-confidence,
actionable findings grounded in concrete repository evidence. Its review should
be deterministic where possible, explicit about impact, and quiet when the
available evidence does not justify a finding.

## Scope

It evaluates changed lines for non-blocking maintainer cleanup such as stale comments, unfinished renames, redundant masking, indentation outliers, unactionable TODO markers, and error names that contradict strongly established local operation vocabulary.

The complete detector or review inventory is maintained in
[CHECKS.md](CHECKS.md).

## Boundaries

It reports non-blocking taste only. Correctness, security, architecture, and domain-specific defects belong to specialist adversaries.

The error-domain check is deliberately narrow: it requires a changed error construction, an error-mapping boundary, a nearby diagnostic, and a second same-scope operation signal that agree on a different domain. Generic/shared errors, compatibility aliases, uncertain abbreviations, legacy code, tests, generated code, and weak one-clue matches remain quiet.
