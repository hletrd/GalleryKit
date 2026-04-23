/**
 * CSV field escaping with defense-in-depth hygiene:
 * - Strip C0/C1 control characters (0x00–0x1F, 0x7F–0x9F) to prevent
 *   column misalignment, CSV injection via embedded line breaks, and
 *   display issues in spreadsheet applications.
 * - Collapse CR/LF runs into a single space (C6R-RPL-06 / AGG6R-11).
 * - Prefix formula-injection characters (`=`, `+`, `-`, `@`, `\t`) with
 *   a single quote per OWASP CSV-injection guidance.
 * - Wrap in double quotes and double any embedded double quote.
 *
 * Extracted from `apps/web/src/app/[locale]/admin/db-actions.ts` so
 * tests can import the pure helper without going through the
 * `'use server'` action surface (which prohibits non-async exports).
 */
export function escapeCsvField(value: string): string {
    value = value.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
    value = value.replace(/[\r\n]+/g, ' ');
    if (value.match(/^[=+\-@\t]/)) {
        value = "'" + value;
    }
    return '"' + value.replace(/"/g, '""') + '"';
}
