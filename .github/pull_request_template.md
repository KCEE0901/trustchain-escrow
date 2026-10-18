## Summary

<!-- Describe the change and the motivation. -->

## Related Issue

<!-- e.g. Closes #617 -->

## Branch Parity & Rollback Validation

- [ ] This change targets `main` and `develop` with equivalent behavior (no branch-only logic).
- [ ] Rollback path was exercised (or is covered by CI) and service health was verified afterward.
- [ ] Data consistency was verified after rollback (no orphaned or partially persisted records).
- [ ] Failure/boundary paths were considered (missing rollback target, failed health check).

## Testing

<!-- List the commands run and their results. -->

- [ ] Lint passes
- [ ] Tests pass
- [ ] Build passes

## Checklist

- [ ] Logs and errors are deterministic and contain no secrets.
- [ ] Public behavior outside this change is preserved.
