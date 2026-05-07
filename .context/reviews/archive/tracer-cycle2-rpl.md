# tracer — cycle 2 rpl

HEAD: `00000006e`.

## Causal trace 1 — How does a server action bypass origin check on HEAD?
- Step 1: Admin logs in. Session cookie set (`auth.ts` → login path explicitly checks `hasTrustedSameOrigin`).
- Step 2: Admin (or admin's browser) triggers a mutating server action — any of `updateImageMetadata`, `createTopic`, `deleteImage`, `updateSeoSettings`, etc.
- Step 3: Server action entry — all of them check `isAdmin()`. NONE check `hasTrustedSameOrigin`.
- Step 4: Next.js framework-level CSRF guard (RSC-action token mechanism) decides whether the request proceeds. This is a moving target; currently it guards against cross-origin POST-form but not every RSC-action transport.
- Step 5: If framework guard is bypassed (or weakened in a future minor), the action runs as if authenticated.

**Alternative hypothesis A:** framework guard is sufficient, so adding `hasTrustedSameOrigin` everywhere is redundant.
**Evidence against A:** the cycle 1 rpl plan explicitly hardened the login/updatePassword paths with the same helper — if framework guard alone were sufficient, that hardening was unnecessary. Repo is inconsistent with its own stated defense-in-depth posture.
**Alternative hypothesis B:** the login/updatePassword hardening was purely belt-and-suspenders and the mutation surface doesn't need the same.
**Evidence against B:** `login` writes the session cookie, which is a higher-privilege state transition than any individual mutation. However, `restoreDatabase` and `createAdminUser` are comparable-severity mutations. The asymmetry isn't justified by severity.

**Winning hypothesis:** the mutation-surface defense-in-depth gap (CR2R-02 / SEC2R-01 / CRIT2R-01) is real and worth closing, but is also appropriate to defer one more cycle if it's genuinely scheduled for the next cycle rather than re-deferred indefinitely.

## Causal trace 2 — `updatePassword` + transaction failure + control-flow signal
- Step 1: User posts password change form.
- Step 2: `updatePassword` passes rate-limit and argon2 checks.
- Step 3: `db.transaction(async (tx) => { ... })` kicks off; suppose the admin's Next.js integration has added `revalidatePath(...)` or similar inside the tx block (hypothetical future refactor). Next.js wraps `revalidatePath` with a mechanism that can throw internal signals.
- Step 4: Transaction throws; outer catch (line 382-393) catches it without calling `unstable_rethrow(e)`.
- Step 5: Control-flow signal is swallowed, Next.js never learns about it, user sees "failed to update password".

**Current state:** no `revalidatePath` is inside the current tx block, so this is latent. But the login path already has `unstable_rethrow` — the defensive pattern is already known to the author, just not applied uniformly. CR2R-01 is the right call.

## Causal trace 3 — Uneven rate-limit clears
- cycle 1 rpl's C1R-02 moved `clearSuccessfulPasswordAttempts(ip)` AFTER the transaction for `updatePassword`. Login (line 166-177) does the same. Admin user create (line 136-143) and share link actions (sharing.ts) also clear after success. Consistent on HEAD. No regression.

## Summary
Two causal traces (1 and 2) produce two new findings that agree with code-reviewer, security-reviewer, critic, and verifier. Cross-agent agreement is high for the mutation-surface origin gap (CR2R-02 / SEC2R-01 / CRIT2R-01) — 4 agents converge.
