/**
 * MySQL DATETIME literal formatting (R4C2 COR-R4C2-01).
 *
 * MySQL strict mode (STRICT_TRANS_TABLES — the server default and what this
 * stack runs) REJECTS ISO-8601 strings with a trailing `Z` zone designator:
 * `INSERT … VALUES ('2026-06-10T13:55:00.000Z')` → ER 1292 "Incorrect
 * datetime value". MySQL 8.0.19+ accepts numeric `+HH:MM` offsets but never
 * `Z`, so `Date.prototype.toISOString()` output must NEVER be written to a
 * DATETIME column.
 *
 * This helper renders the canonical literal `'YYYY-MM-DD HH:MM:SS'` from
 * SERVER-LOCAL components — consistent with how the mysql2 driver itself
 * serializes `Date` objects for `timestamp()` columns and with `NOW()`
 * (session time zone), so DATETIME columns written via this helper sort and
 * compare coherently against driver-written timestamps on the same server.
 * (Matches the local-component convention of `parseExifDateTime`'s Date
 * branch in `lib/process-image.ts`.)
 */
export function toMySqlDateTime(date: Date): string {
    const pad2 = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
        + ` ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}
