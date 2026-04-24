import { isAdmin } from '@/app/actions/auth';
import { NextResponse } from 'next/server';
import { getTranslations } from 'next-intl/server';

const NO_STORE_HEADERS = {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
};

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
            return NextResponse.json({ error: t('unauthorized') }, {
                status: 401,
                headers: NO_STORE_HEADERS,
            });
        }
        return handler(...args);
    };
}
