import { describe, expect, it } from 'vitest';
import { toMySqlDateTime } from '@/lib/mysql-datetime';

/**
 * R4C2 COR-R4C2-01 / TEST-R4C2-09: value-format contract for DATETIME
 * literals written to `datetime(mode: 'string')` columns.
 *
 * MySQL strict mode (STRICT_TRANS_TABLES) rejects ISO-8601 strings with a
 * trailing `Z` (ER 1292 "Incorrect datetime value" — reproduced live against
 * MySQL 8 during the run-4 cycle-2 review). The accepted literal shape is
 * 'YYYY-MM-DD HH:MM:SS'. This suite locks that shape so a future refactor
 * back to `toISOString()` (or any `T`/`Z`-bearing form) fails loudly here
 * instead of silently un-persisting the failed-images surface again.
 */
describe('toMySqlDateTime — MySQL DATETIME literal contract', () => {
    const MYSQL_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

    it('renders the canonical MySQL DATETIME literal shape', () => {
        expect(toMySqlDateTime(new Date())).toMatch(MYSQL_DATETIME);
    });

    it('zero-pads month, day, hour, minute, and second components', () => {
        // Local-component constructor: 5 Jan, 03:07:09.
        const d = new Date(2026, 0, 5, 3, 7, 9);
        expect(toMySqlDateTime(d)).toBe('2026-01-05 03:07:09');
    });

    it('never emits the ISO T delimiter, Z designator, or fractional seconds', () => {
        const out = toMySqlDateTime(new Date(2026, 11, 31, 23, 59, 59, 999));
        expect(out).not.toContain('T');
        expect(out).not.toContain('Z');
        expect(out).not.toContain('.');
        expect(out).toBe('2026-12-31 23:59:59');
    });

    it('uses LOCAL components (consistent with mysql2 Date serialization), not UTC', () => {
        // Construct from local parts; the formatted output must echo those
        // same parts back regardless of the host TZ offset.
        const d = new Date(2026, 5, 15, 12, 34, 56);
        expect(toMySqlDateTime(d)).toBe('2026-06-15 12:34:56');
    });
});
