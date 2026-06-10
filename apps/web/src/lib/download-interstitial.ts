/**
 * R4C7 COR-R4C7-02: no-claim confirmation page for the paid-download
 * route.
 *
 * Mail-security gateways (Microsoft SafeLinks / Defender, Mimecast,
 * Proofpoint, webmail link previewers) FETCH links found in inbound
 * email — and Next.js additionally auto-implements HEAD for GET-only
 * routes by invoking the GET handler itself (COR-R4C7-01). While the
 * single-use claim lived on GET, whichever automated fetch arrived
 * first consumed the customer's token with zero bytes delivered.
 *
 * The route therefore serves THIS page on GET (no claim, no fs access)
 * and performs the claim + byte streaming only on the explicit POST
 * submitted from the form below. Scanners do not submit POST forms.
 *
 * Pure module: callers resolve the localized strings (next-intl) and
 * pass them in, keeping this builder unit-testable without i18n
 * machinery. The form deliberately carries NO `action` attribute —
 * per the HTML form-submission algorithm an omitted action submits to
 * the document's own URL, so for `method="post"` the `?token=…` query
 * is preserved and the token never has to be embedded in the HTML body.
 */

export interface DownloadInterstitialStrings {
    /** Page <title> and <h1>. */
    title: string;
    /** Explanatory paragraph (already interpolated with the photo title when available). */
    description: string;
    /** Submit-button label. */
    button: string;
    /** Single-use / 24 h validity note. */
    expiryNote: string;
}

/** Minimal HTML escaper for text nodes and double-quoted attribute values. */
export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Build the interstitial document. `locale` is one of the app's
 * supported locales (caller derives it via `deriveLocaleFromReferer`);
 * it is escaped anyway as defense in depth.
 */
export function buildDownloadInterstitialHtml(opts: {
    locale: string;
    strings: DownloadInterstitialStrings;
}): string {
    const { locale, strings } = opts;
    const title = escapeHtml(strings.title);
    const description = escapeHtml(strings.description);
    const button = escapeHtml(strings.button);
    const expiryNote = escapeHtml(strings.expiryNote);

    // Inline styles only (the route ships a CSP of `default-src 'none';
    // style-src 'unsafe-inline'` — no scripts, no external fetches).
    // The submit button presents a ≥44 px target (touch-target policy).
    return `<!DOCTYPE html>
<html lang="${escapeHtml(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #fafafa; color: #171717;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #0a0a0a; color: #ededed; }
    .card { background: #171717; border-color: #262626; }
    .note { color: #a3a3a3; }
  }
  .card {
    max-width: 28rem; margin: 1rem; padding: 2rem; border: 1px solid #e5e5e5;
    border-radius: 0.75rem; background: #ffffff; text-align: center;
  }
  h1 { font-size: 1.25rem; margin: 0 0 0.75rem; }
  p { margin: 0 0 1rem; line-height: 1.5; }
  .note { font-size: 0.8125rem; color: #737373; margin-bottom: 0; }
  button {
    min-height: 44px; min-width: 44px; padding: 0.625rem 1.5rem; font-size: 1rem;
    border: 0; border-radius: 0.5rem; background: #171717; color: #fafafa; cursor: pointer;
  }
  @media (prefers-color-scheme: dark) {
    button { background: #ededed; color: #171717; }
  }
</style>
</head>
<body>
<main class="card">
<h1>${title}</h1>
<p>${description}</p>
<form method="post">
<button type="submit">${button}</button>
</form>
<p class="note">${expiryNote}</p>
</main>
</body>
</html>
`;
}
