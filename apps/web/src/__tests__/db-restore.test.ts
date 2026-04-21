import { describe, expect, it } from 'vitest';

import { isIgnorableRestoreStdinError } from '@/lib/db-restore';

describe('isIgnorableRestoreStdinError', () => {
    it('treats broken-pipe style child-stdin errors as benign', () => {
        expect(isIgnorableRestoreStdinError({ code: 'EPIPE' })).toBe(true);
        expect(isIgnorableRestoreStdinError({ code: 'ERR_STREAM_DESTROYED' })).toBe(true);
    });

    it('rejects unrelated or missing error codes', () => {
        expect(isIgnorableRestoreStdinError({ code: 'ECONNRESET' })).toBe(false);
        expect(isIgnorableRestoreStdinError(new Error('boom'))).toBe(false);
        expect(isIgnorableRestoreStdinError(null)).toBe(false);
    });
});
