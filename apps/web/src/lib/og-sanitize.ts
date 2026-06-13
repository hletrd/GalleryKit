import { stripUnicodeFormatting } from '@/lib/validation';

/**
 * Shared OG-text sanitizer for the Satori-rendered OpenGraph image routes.
 *
 * AGG-R8-13 / SEC-1 (run-8 c2): the per-photo OG route
 * (`api/og/photo/[id]/route.tsx`) sanitized its title via a local
 * `sanitizeForOg`, but the home/site OG route (`api/og/route.tsx`) rendered
 * `siteTitle` / `topicLabel` / tag entries RAW. That was a defense-in-depth
 * SYMMETRY gap, not a live exploit (the inputs are admin-controlled and
 * `containsUnicodeFormatting`-rejected at write time, and Satori renders text
 * nodes into an image — no script/`</script>` sink). Extracting the sanitizer
 * to one module follows the repo's "derive, don't copy" discipline for
 * Unicode-format defenses (cf. `UNICODE_FORMAT_CHARS` in validation.ts) so a
 * future regression (a loosened SEO/topic/tag validator) cannot let bidi /
 * zero-width / C0 chars reach ONE OG card while the other still strips them.
 *
 * AGG-4 lineage: use `stripUnicodeFormatting` (the GLOBAL-flag twin), which
 * replace-alls bidi + zero-width / invisible formatting chars (a non-global
 * `.replace` would strip only the FIRST). Then strip C0 control chars (minus
 * \t \n \r) that could distort the rendered SVG/PNG text layout.
 */

/** C0 control chars except tab (\x09), LF (\x0A), CR (\x0D). Global. */
export const OG_C0_CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;

/** Strip Unicode formatting (bidi/zero-width) + C0 control chars for OG text. */
export function sanitizeForOg(value: string): string {
    return (stripUnicodeFormatting(value) ?? '').replace(OG_C0_CONTROL_CHARS, '');
}
