const EXIF_DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

export function isValidExifDateTimeParts(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    second: number,
) {
    if (
        year < 1900 || year > 2100
        || month < 1 || month > 12
        || day < 1 || day > 31
        || hour < 0 || hour > 23
        || minute < 0 || minute > 59
        || second < 0 || second > 59
    ) {
        return false;
    }

    const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    return (
        date.getUTCFullYear() === year
        && date.getUTCMonth() === month - 1
        && date.getUTCDate() === day
        && date.getUTCHours() === hour
        && date.getUTCMinutes() === minute
        && date.getUTCSeconds() === second
    );
}

function parseStoredExifDateTime(value: string | null | undefined) {
    if (!value) return null;
    const match = EXIF_DATETIME_PATTERN.exec(value.trim());
    if (!match) return null;

    const [, year, month, day, hour, minute, second] = match;
    const parsedYear = Number(year);
    const parsedMonth = Number(month);
    const parsedDay = Number(day);
    const parsedHour = Number(hour);
    const parsedMinute = Number(minute);
    const parsedSecond = Number(second);

    if (!isValidExifDateTimeParts(parsedYear, parsedMonth, parsedDay, parsedHour, parsedMinute, parsedSecond)) {
        return null;
    }

    return new Date(Date.UTC(
        parsedYear,
        parsedMonth - 1,
        parsedDay,
        parsedHour,
        parsedMinute,
        parsedSecond,
    ));
}

export function formatStoredExifDate(
    value: string | null | undefined,
    locale: string,
    options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' },
) {
    const parsed = parseStoredExifDateTime(value);
    if (!parsed) return null;
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(parsed);
}

export function formatStoredExifTime(
    value: string | null | undefined,
    locale: string,
    options: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', second: '2-digit' },
) {
    const parsed = parseStoredExifDateTime(value);
    if (!parsed) return null;
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(parsed);
}
