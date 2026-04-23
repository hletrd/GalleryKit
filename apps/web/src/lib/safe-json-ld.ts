/**
 * Serialize data for a JSON-LD script tag. Applies the following escapes:
 *
 * - `<` -> `<` prevents a closing `</script>` inside a string literal
 *   from terminating the script element and yielding an XSS vector.
 * - U+2028 (LINE SEPARATOR) and U+2029 (PARAGRAPH SEPARATOR) are valid JSON
 *   but were historically illegal JavaScript line terminators (fixed in
 *   ES2019). Escaping them keeps output safe against any parser/CDN/proxy
 *   that still treats them as line terminators when reading the script
 *   element's text content.
 *
 * C4R-RPL2-02 (aggregated finding AGG4R2-03).
 */
export function safeJsonLd(data: unknown): string {
    return JSON.stringify(data)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}
