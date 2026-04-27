import { UNICODE_FORMAT_CHARS } from '@/lib/validation';

// Global-flag variant for .replace() usage — the canonical constant in
// validation.ts intentionally omits the `g` flag to avoid lastIndex state
// bugs with .test() (alternating true/false across calls). csv-escape.ts
// needs the global flag to strip ALL formatting chars in a single pass.
const UNICODE_FORMAT_CHARS_G = new RegExp(UNICODE_FORMAT_CHARS.source, 'g');

/**
 * CSV field escaping with defense-in-depth hygiene:
 * - Strip C0/C1 control characters (0x00–0x1F, 0x7F–0x9F) to prevent
 *   column misalignment, CSV injection via embedded line breaks, and
 *   display issues in spreadsheet applications.
 * - Strip Unicode bidi override / isolate formatting characters
 *   (U+202A-202E, U+2066-2069) to prevent Trojan-Source-style visual
 *   reordering in spreadsheets (C7R-RPL-11 / AGG7R-05), AND zero-width
 *   / invisible formatting characters (U+200B-200F ZWSP/ZWNJ/ZWJ/LRM/RLM,
 *   U+2060 WJ, U+FEFF BOM, U+180E MVS, U+FFF9-FFFB interlinear
 *   annotation anchors) to prevent invisible-character formula-injection
 *   bypasses. JS regex `\s` does NOT match ZWSP (U+200B), so without
 *   this strip an input like `​=HYPERLINK(...)` would escape the
 *   formula-prefix guard because the leading ZWSP is neither collapsed
 *   nor matched by `^\s*`. Spreadsheet apps routinely trim leading
 *   invisible characters on import, then interpret the formula
 *   (C8R-RPL-01 / AGG8R-01).
 * - Collapse CR/LF runs into a single space (C6R-RPL-06 / AGG6R-11).
 * - Prefix formula-injection characters (`=`, `+`, `-`, `@`) with
 *   a single quote per OWASP CSV-injection guidance. The match uses
 *   `/^\s*[=+\-@]/` so any leading whitespace (including spaces
 *   introduced by the CRLF-collapse pass above) is accounted for
 *   (C7R-RPL-01 / AGG7R-01). Tab (`\t`) is already stripped by the
 *   C0/C1 control-char pass above and therefore cannot appear in
 *   `value` at this point (C8R-RPL-05 / AGG8R-10 — removed from char
 *   class to eliminate dead code).
 * - Wrap in double quotes and double any embedded double quote.
 *
 * Extracted from `apps/web/src/app/[locale]/admin/db-actions.ts` so
 * tests can import the pure helper without going through the
 * `'use server'` action surface (which prohibits non-async exports).
 */
export function escapeCsvField(value: string): string {
    // Strip C0/C1 control characters, preserving LF (0x0A) and CR (0x0D)
    // which are collapsed to spaces in the [\r\n]+ pass below.
    value = value.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
    // C7R-RPL-11 / AGG7R-05 + C8R-RPL-01 / AGG8R-01: strip Unicode
    // bidi overrides (U+202A-202E LRE/RLE/PDF/LRO/RLO), bidi isolates
    // (U+2066-2069 LRI/RLI/FSI/PDI), zero-width / format chars
    // (U+200B ZWSP, U+200C ZWNJ, U+200D ZWJ, U+200E LRM, U+200F RLM),
    // U+2060 WJ, U+FEFF BOM, U+180E MVS, U+FFF9-FFFB interlinear
    // annotation anchors. Consolidated into a single character class
    // pass for minimal regex work. These cover Trojan-Source-style
    // reordering AND invisible-character formula-injection bypasses.
    // C3-F06: import the shared regex instead of duplicating the literal.
    value = value.replace(UNICODE_FORMAT_CHARS_G, '');
    value = value.replace(/[\r\n]+/g, ' ');
    // C7R-RPL-01 / AGG7R-01: tolerate leading whitespace before the
    // formula-start character so CRLF-collapsed inputs cannot bypass
    // the formula-injection defense. C8R-RPL-05 / AGG8R-10: drop `\t`
    // from the char class since tab is pre-stripped by the C0/C1 pass.
    if (/^\s*[=+\-@]/.test(value)) {
        value = "'" + value;
    }
    return '"' + value.replace(/"/g, '""') + '"';
}
