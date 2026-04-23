# critic — cycle 9 rpl

HEAD: `00000002ad51a67c0503f50c3f79c7b878c7e93f`.

This cycle reviewed actions/, lib/, components/, scripts/. Cross-cutting critique:

## Critique

### Rate-limit pre-increment ordering is not applied uniformly
`login` validates form fields BEFORE pre-incrementing the rate-limit counter (auth.ts:83-89). `updatePassword` validates form fields AFTER pre-incrementing (auth.ts:297-326). This inconsistency means legitimate typo users can be locked out of password change with no actual auth attempt. See C9R-RPL-01 / S01.

### Rate-limit pruning cadence policy is scattered
- `search`: once-per-second throttled via module-level `lastSearchRateLimitPruneAt`.
- `login`: no cadence throttle (called unconditionally).
- `share_*`: no cadence throttle.
- `user_create`: no cadence throttle.
- `password_change`: no cadence throttle.
Different cadences are probably fine at current traffic levels, but the mental overhead of reasoning about them is disproportionate to the tiny perf benefit. Pick one convention (cadence throttle when max keys > N, otherwise unconditional) and apply it everywhere.

### Dead UI branches hide intent
`photo-viewer.tsx:463-475` has conditional render blocks for `original_format` / `original_file_size`, neither of which is ever present in the public query (privacy-sensitive per `publicSelectFields`). A reader will not notice this unless they cross-reference `data.ts`. Either add a comment or split admin-only and public viewer components.

### Privacy enforcement design is excellent, but not documented centrally
`adminSelectFields` -> `publicSelectFields` rest-destructure pattern + `_PrivacySensitiveKeys` compile-time guard + `_SensitiveKeysInPublic extends never` assertion is a strong design. CLAUDE.md "Privacy" section mentions it briefly but no contributor-facing doc lists the invariants that the guard protects. Add a `docs/privacy.md` or extend CLAUDE.md with a worked example.

### `getImages` has been dead code for at least two cycles
The heavy LEFT JOIN + GROUP BY variant has no in-repo caller. Earlier cycles deferred the refactor. This is not a bug, but carrying 20 lines of non-trivial dead code across cycles increases cognitive load for every reviewer. Either delete or explicitly mark "preserved for future admin dashboard v2" with a TODO link.

### Review artifact directory is enormous
`.context/reviews/` has >300 files from 46 cycles. Most valuable content is in `_aggregate-cycle*.md`. Consider archiving pre-cycle-40 per-agent files to a `done/` subfolder to make the active review surface smaller.

## Net verdict

After 46 review cycles the project is in excellent shape. The concerns above are all paper cuts rather than scars. The single real new finding (C9R-RPL-01) deserves an implementation in this cycle; the rest can be backlog / observational. The codebase demonstrates uncommon discipline around privacy, origin provenance, CSRF-style defense-in-depth, and atomic-rename file safety.
