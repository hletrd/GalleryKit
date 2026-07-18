export const MIN_ARCHIVE_YEAR = 1000;
export const MAX_ARCHIVE_YEAR = 9999;

export type ArchiveRange = {
    start: string;
    /** Null only when the requested range reaches MySQL DATETIME's maximum year. */
    end: string | null;
};

export function parseArchiveYear(value: string | undefined): number | null {
    if (!value || !/^\d{4}$/.test(value)) return null;
    const year = Number(value);
    return year >= MIN_ARCHIVE_YEAR && year <= MAX_ARCHIVE_YEAR ? year : null;
}

function assertArchiveYear(year: number): void {
    if (!Number.isInteger(year) || year < MIN_ARCHIVE_YEAR || year > MAX_ARCHIVE_YEAR) {
        throw new RangeError(`Archive year must be an integer from ${MIN_ARCHIVE_YEAR} through ${MAX_ARCHIVE_YEAR}.`);
    }
}

function padDatePart(value: number): string {
    return String(value).padStart(2, '0');
}

export function archiveRange(year: number, month?: number): ArchiveRange {
    assertArchiveYear(year);
    if (month !== undefined && (!Number.isInteger(month) || month < 1 || month > 12)) {
        throw new RangeError('Archive month must be an integer from 1 through 12.');
    }

    const startMonth = month ?? 1;
    const reachesNextYear = month === undefined || month === 12;
    const endYear = reachesNextYear ? year + 1 : year;
    const endMonth = reachesNextYear ? 1 : (month ?? 1) + 1;

    return {
        start: `${year}-${padDatePart(startMonth)}-01 00:00:00`,
        // MySQL DATETIME has no year 10000. Omitting the upper predicate is
        // exact at the type maximum because no later DATETIME value can exist.
        end: endYear > MAX_ARCHIVE_YEAR
            ? null
            : `${endYear}-${padDatePart(endMonth)}-01 00:00:00`,
    };
}
