import { isAdmin } from '@/app/actions/auth';
import { NextResponse } from 'next/server';
import { getTranslations } from 'next-intl/server';

/**
 * Wrap an API route handler with mandatory admin authentication.
 * All /api/admin/* routes MUST use this wrapper or call isAdmin() directly.
 */
export function withAdminAuth<T extends unknown[]>(
    handler: (...args: T) => Promise<Response>,
): (...args: T) => Promise<Response> {
    return async (...args: T) => {
        if (!(await isAdmin())) {
            const t = await getTranslations('serverActions');
            return NextResponse.json({ error: t('unauthorized') }, { status: 401 });
        }
        return handler(...args);
    };
}
