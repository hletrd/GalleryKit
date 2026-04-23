/**
 * CSV field escaping with defense-in-depth hygiene:
 * - Strip C0/C1 control characters (0x00–0x1F, 0x7F–0x9F) to prevent
 *   column misalignment, CSV injection via embedded line breaks, and
 *   display issues in spreadsheet applications.
 * - Strip Unicode bidi override / isolate formatting characters
 *   (U+202A-202E, U+2066-2069) to prevent Trojan-Source-style visual
 *   reordering in spreadsheets (C7R-RPL-11 / AGG7R-05).
 * - Collapse CR/LF runs into a single space (C6R-RPL-06 / AGG6R-11).
 * - Prefix formula-injection characters (`=`, `+`, `-`, `@`, `\t`) with
 *   a single quote per OWASP CSV-injection guidance. The match uses
 *   `/^\s*[=+\-@\t]/` so any leading whitespace (including spaces
 *   introduced by the CRLF-collapse pass above) is accounted for
 *   (C7R-RPL-01 / AGG7R-01). Without leading-whitespace tolerance,
 *   inputs like `"\r\n=HYPERLINK(...)"` would collapse to
 *   `" =HYPERLINK(...)"` and escape the guard because spreadsheet
 *   apps trim leading whitespace before interpreting formulas.
 * - Wrap in double quotes and double any embedded double quote.
 *
 * Extracted from `apps/web/src/app/[locale]/admin/db-actions.ts` so
 * tests can import the pure helper without going through the
 * `'use server'` action surface (which prohibits non-async exports).
 */
export function escapeCsvField(value: string): string {
    value = value.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
    // C7R-RPL-11 / AGG7R-05: strip Unicode bidi override & isolate
    // formatting chars. Range U+202A-202E covers LRE/RLE/PDF/LRO/RLO,
    // U+2066-2069 covers LRI/RLI/FSI/PDI. Trojan-Source-style
    // reordering in spreadsheets is mitigated.
    value = value.replace(/[‪-‮⁦-⁩]/g, '');
    value = value.replace(/[\r\n]+/g, ' ');
    // C7R-RPL-01 / AGG7R-01: tolerate leading whitespace before the
    // formula-start character so CRLF-collapsed inputs cannot bypass
    // the formula-injection defense.
    if (/^\s*[=+\-@\t]/.test(value)) {
        value = "'" + value;
    }
    return '"' + value.replace(/"/g, '""') + '"';
}
