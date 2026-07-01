import { sql, type AnyColumn, type SQL } from 'drizzle-orm';

type LikeColumn = AnyColumn | SQL;

export function escapeLikePattern(value: string): string {
    return value.replace(/[!%_]/g, '!$&');
}

export function containsLike(column: LikeColumn, value: string): SQL {
    return sql`${column} LIKE ${`%${escapeLikePattern(value)}%`} ESCAPE '!'`;
}
