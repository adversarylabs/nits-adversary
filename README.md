# Nits adversary

Non-blocking style and taste nits — naming, stale comments, unfinished renames, and similar maintainer cleanup. Not correctness; not a full design review.

## Goals

The adversary is designed to produce a small number of high-confidence,
actionable findings grounded in concrete repository evidence. Its review should
be deterministic where possible, explicit about impact, and quiet when the
available evidence does not justify a finding.

## Scope

It evaluates changed lines for non-blocking maintainer cleanup such as stale comments, unfinished renames, redundant masking, indentation outliers, and unactionable TODO markers.

The complete detector or review inventory is maintained in
[CHECKS.md](CHECKS.md).

## Boundaries

It reports non-blocking taste only. Correctness, security, architecture, and domain-specific defects belong to specialist adversaries.
