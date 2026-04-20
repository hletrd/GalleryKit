const EXIF_DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

function parseStoredExifDateTime(value: string | null | undefined) {
    if (!value) return null;
    const match = EXIF_DATETIME_PATTERN.exec(value.trim());
    if (!match) return null;

    const [, year, month, day, hour, minute, second] = match;
    return new Date(Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
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
