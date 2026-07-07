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

export type MySqlDateParts = {
    year: number;
    month: number;
    day: number;
};

const MYSQL_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

export function parseMySqlDateTimeParts(value: string | null | undefined): MySqlDateParts | null {
    if (!value) return null;
    const match = MYSQL_DATETIME_RE.exec(value);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6]);

    if (
        !Number.isInteger(year)
        || !Number.isInteger(month)
        || !Number.isInteger(day)
        || !Number.isInteger(hour)
        || !Number.isInteger(minute)
        || !Number.isInteger(second)
        || month < 1
        || month > 12
        || day < 1
        || hour < 0
        || hour > 23
        || minute < 0
        || minute > 59
        || second < 0
        || second > 59
    ) {
        return null;
    }

    const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (day > maxDay) return null;

    return { year, month, day };
}
