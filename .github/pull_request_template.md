## Summary

Briefly describe what changed and why.

Closes #

## Changes

-
-
-

## Testing

List the exact commands you ran locally.

```bash
# Examples
cargo test --workspace
npm run test -w backend
npm run test -w frontend
npm run lint
```

## Review Notes

Call out any context reviewers should know:

- areas that need extra attention
- follow-up work or known limitations
- deployment or migration considerations

## Checklist

- [ ] Code compiles, or the updated docs reference working commands
- [ ] Tests were added or updated when behavior changed
- [ ] Linting and formatting were run
- [ ] Documentation was updated when needed
- [ ] No breaking changes, or they are clearly described
- [ ] Screenshots or recordings are included for UI changes

## Security Checklist (for contract/auth changes)

_Optional — fill this in if your PR touches smart contracts, authentication, or authorization. Skip if not applicable._

- [ ] No hardcoded secrets or private keys
- [ ] Auth checks performed before any state mutation
- [ ] Integer arithmetic reviewed for overflow/underflow
- [ ] Input validation added for all new parameters
- [ ] New endpoints have rate limiting applied
