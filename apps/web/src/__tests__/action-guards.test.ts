import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * C2R-02 unit test: assert `requireSameOriginAdmin` returns a localized
 * unauthorized error when the `hasTrustedSameOrigin` check fails, and
 * returns `null` on success.
 *
 * We mock `next/headers` and `next-intl/server` so the test runs without a
 * Next.js runtime. The underlying `hasTrustedSameOrigin` implementation is
 * imported directly — it's a pure function over a `HeaderLookup` so we can
 * exercise both branches just by feeding it different headers.
 */
describe('requireSameOriginAdmin', () => {
    const headersMock = vi.fn();
    const translationsMock = vi.fn();

    beforeEach(() => {
        vi.resetModules();
        vi.doMock('next/headers', () => ({
            headers: headersMock,
        }));
        vi.doMock('next-intl/server', () => ({
            getTranslations: async () => translationsMock,
        }));
        translationsMock.mockImplementation((key: string) => `T:${key}`);
    });

    afterEach(() => {
        headersMock.mockReset();
        translationsMock.mockReset();
        vi.doUnmock('next/headers');
        vi.doUnmock('next-intl/server');
    });

    it('returns null when the request carries a valid same-origin header', async () => {
        headersMock.mockReturnValue({
            get(name: string) {
                const lower = name.toLowerCase();
                if (lower === 'host') return 'gallery.atik.kr';
                if (lower === 'x-forwarded-proto') return 'https';
                if (lower === 'origin') return 'https://gallery.atik.kr';
                return null;
            },
        });

        const { requireSameOriginAdmin } = await import('@/lib/action-guards');
        const result = await requireSameOriginAdmin();
        expect(result).toBeNull();
    });

    it('returns a localized unauthorized error string when origin metadata is missing (fail-closed)', async () => {
        headersMock.mockReturnValue({
            get(name: string) {
                const lower = name.toLowerCase();
                if (lower === 'host') return 'gallery.atik.kr';
                if (lower === 'x-forwarded-proto') return 'https';
                return null;
            },
        });

        const { requireSameOriginAdmin } = await import('@/lib/action-guards');
        const result = await requireSameOriginAdmin();
        expect(result).toBe('T:unauthorized');
    });

    it('returns an error string when the Origin header points to a different origin', async () => {
        headersMock.mockReturnValue({
            get(name: string) {
                const lower = name.toLowerCase();
                if (lower === 'host') return 'gallery.atik.kr';
                if (lower === 'x-forwarded-proto') return 'https';
                if (lower === 'origin') return 'https://evil.example';
                return null;
            },
        });

        const { requireSameOriginAdmin } = await import('@/lib/action-guards');
        const result = await requireSameOriginAdmin();
        expect(result).toBe('T:unauthorized');
    });
});
