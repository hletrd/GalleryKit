/** Serialize data for a JSON-LD script tag, escaping `<` to prevent XSS via `</script>`. */
export function safeJsonLd(data: unknown): string {
    return JSON.stringify(data).replace(/</g, '\\u003c');
}
