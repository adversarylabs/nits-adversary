# Checks

| Rule | Severity | Scans for |
| --- | --- | --- |
| `nits.dockerfile_run_indentation` | Review | Isolated one-space outlier in a flat continued `RUN` block |
| `nits.error_domain_mismatch` | Review | Changed error construction naming a sibling domain that contradicts two agreeing local operation signals |
| `nits.redundant_secret_masking` | Review | Duplicate masking before a recorder with the same guarantee |
| `nits.stale_comment_marker` | Review | Comments admitting temporary/obsolete code |
| `nits.todo_landmine` | Review | TODO/FIXME/HACK without ticket/URL |
| `nits.unfinished_rename` | Review | Dual old/new naming left in one file |
