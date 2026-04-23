import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';

import { hasTrustedSameOrigin } from '@/lib/request-origin';

/**
 * C2R-02 — defense-in-depth provenance check for mutating server actions.
 *
 * Next.js server actions are guarded by the framework-level CSRF mechanism,
 * but the repo already enforces an explicit `hasTrustedSameOrigin` check on
 * the auth-sensitive entry points (`login`, `updatePassword`) and on the
 * `/api/admin/db/download` route. Every other mutating admin action relied
 * only on `isAdmin()`, leaving the defense posture uneven — a framework
 * regression or a reverse-proxy misconfiguration would affect the mutation
 * surface but not the login surface, even though mutations like
 * `restoreDatabase`, `createAdminUser`, and `deleteImage` are equally
 * privileged.
 *
 * `requireSameOriginAdmin()` centralizes the Origin/Referer + Host
 * reconciliation so every mutating action applies the same rule. It reads
 * `next/headers` once, runs the strict default of `hasTrustedSameOrigin`,
 * and on failure returns a localized error message string (or null on
 * success). Callers build their own action-specific error shape so
 * TypeScript union inference in the caller does not shift (`{error: string}`
 * returned inline vs returned from a variable produced different unions in
 * TS 6 — returning a message string keeps the caller's existing return type
 * stable while still centralizing the provenance policy).
 *
 * Callers:
 *   const originError = await requireSameOriginAdmin();
 *   if (originError) return { error: originError };
 *
 * The helper does NOT assume the caller has already translated — it fetches
 * its own translations so tests can mock `getTranslations` without needing
 * to thread through the outer call site.
 */
export async function requireSameOriginAdmin(): Promise<string | null> {
    const t = await getTranslations('serverActions');
    const requestHeaders = await headers();
    if (!hasTrustedSameOrigin(requestHeaders)) {
        return t('unauthorized');
    }
    return null;
}
