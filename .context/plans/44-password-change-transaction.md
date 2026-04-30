# Plan 44 — Password Change Transaction Safety

**Created:** 2026-04-19 (Cycle 7)
**Status:** Pending

## Findings Addressed

- C7-03 (MEDIUM): `updatePassword` session invalidation is not in a transaction with the password change, allowing old sessions to survive if the DELETE fails.

## Implementation

### File: `apps/web/src/app/actions/auth.ts`

Wrap the password hash update and session invalidation in a single `db.transaction()`:

```ts
// Current (lines 289-304):
const newHash = await argon2.hash(newPassword, { type: argon2.argon2id });

await db.update(adminUsers)
    .set({ password_hash: newHash })
    .where(eq(adminUsers.id, currentUser.id));

const currentSession = await getSession();
if (currentSession) {
     await db.delete(sessions).where(and(
         eq(sessions.userId, currentUser.id),
         sql`${sessions.id} != ${currentSession.id}`
     ));
} else {
     await db.delete(sessions).where(eq(sessions.userId, currentUser.id));
}

return { success: true, message: 'Password updated successfully.' };
```

Change to:

```ts
const newHash = await argon2.hash(newPassword, { type: argon2.argon2id });
const currentSession = await getSession();

await db.transaction(async (tx) => {
    await tx.update(adminUsers)
        .set({ password_hash: newHash })
        .where(eq(adminUsers.id, currentUser.id));

    if (currentSession) {
        await tx.delete(sessions).where(and(
            eq(sessions.userId, currentUser.id),
            sql`${sessions.id} != ${currentSession.id}`
        ));
    } else {
        await tx.delete(sessions).where(eq(sessions.userId, currentUser.id));
    }
});

return { success: true, message: 'Password updated successfully.' };
```

Key change: Move `getSession()` before the transaction to avoid calling it inside the tx block, then wrap both the UPDATE and DELETE in a single transaction.

## Verification

- Build passes (`npm run build`)
- Password change still works end-to-end
- On DB error, both operations roll back atomically
