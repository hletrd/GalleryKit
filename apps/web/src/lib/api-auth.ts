import { isAdmin } from '@/app/actions';
import { NextResponse } from 'next/server';

/**
 * Wrap an API route handler with mandatory admin authentication.
 * All /api/admin/* routes MUST use this wrapper or call isAdmin() directly.
 */
export function withAdminAuth<T extends unknown[]>(
    handler: (...args: T) => Promise<Response>,
): (...args: T) => Promise<Response> {
    return async (...args: T) => {
        if (!(await isAdmin())) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        return handler(...args);
    };
}
