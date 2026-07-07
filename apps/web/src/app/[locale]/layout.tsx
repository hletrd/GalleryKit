import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { IMAGE_BASE_URL, LOCALES } from '@/lib/constants';
import { buildHreflangAlternates, getAlternateOpenGraphLocales, getLocaleDirection, getOpenGraphLocale } from '@/lib/locale-path';
import { getSeoSettings } from '@/lib/data';
import { getCspNonce } from '@/lib/csp-nonce';

import { RegisterServiceWorker } from '@/components/register-service-worker';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const seo = await getSeoSettings();
  const openGraphLocale = getOpenGraphLocale(locale, seo.locale);

  return {
    metadataBase: new URL(seo.url),
    title: {
      default: seo.title,
      template: `%s | ${seo.title}`
    },
    description: seo.description,
    // AGG2L-LOW-02 / plan-303-B: derive the hreflang alternates map from the
    // shared `buildHreflangAlternates` helper instead of inlining
    // `{ 'en': ..., 'ko': ... }` literals. This keeps the root layout in sync
    // with the home / topic / photo pages (all of which already use the
    // helper post plan-301-C) and makes adding a new locale to `LOCALES`
    // automatically extend every alternate-language map. It also unifies
    // `x-default` semantics across the site: the helper resolves it to
    // `localizeUrl(seo.url, DEFAULT_LOCALE, '/')` (e.g. `…/en`) instead of
    // the bare `seo.url`, so search engines see one consistent default URL
    // regardless of which surface emits the metadata.
    alternates: {
      languages: buildHreflangAlternates(seo.url, '/'),
    },
    openGraph: {
      title: seo.title,
      description: seo.description,
      url: seo.url,
      siteName: seo.title,
      locale: openGraphLocale,
      alternateLocale: getAlternateOpenGraphLocales(locale, seo.locale),
      type: "website",
    },
    twitter: {
      card: 'summary_large_image',
    },
    // C3-05 (run-10 c3, TRC3-03 + DES3-01): deliberately NO explicit
    // `robots: { index: true, follow: true }` here. Next elides the robots
    // meta tag entirely for the index/follow default on valid pages, so the
    // explicit block was a no-op everywhere EXCEPT real 404s — where the
    // ancestor-resolved "index, follow" tag rendered ALONGSIDE the
    // framework-injected `noindex` (Next auto-injects
    // `<meta name="robots" content="noindex">` on 404-status pages),
    // shipping two CONFLICTING robots directives on every not-found URL.
    // Omitting the default leaves the framework's noindex as the single
    // authoritative tag on 404s and changes nothing on valid pages.
    // (`not-found.tsx` cannot carry its own metadata export — only the
    // experimental global-not-found.js supports that per Next 16 docs —
    // so this elision IS the fix.) Pinned by e2e/not-found-status.spec.ts.
  };
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    // CM-LOW-3: pure black in dark to match the OLED canvas background
    // (--background: 0 0% 0%). The pre-fix #09090b created a visible
    // status-bar-vs-canvas seam in OLED dark mode on iOS Safari.
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
};

export default async function RootLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // Ensure that the incoming `locale` is valid
  if (!(LOCALES as readonly string[]).includes(locale)) {
    return notFound();
  }

  const [seo, messages, t] = await Promise.all([
    getSeoSettings(),
    getMessages(),
    getTranslations('common'),
  ]);
  const nonce = await getCspNonce();

  return (
    <html
      lang={locale}
      // Explicit `dir` improves SR speech-flow heuristics and future-proofs for
      // RTL locales. Currently only LTR locales are shipped (C3R-RPL-05 /
      // AGG3R-05).
      dir={getLocaleDirection(locale)}
      suppressHydrationWarning
      data-gallery-title={seo.title}
      data-gallery-nav-title={seo.nav_title || seo.title}
      // COR-R4C16-03: IMAGE_BASE_URL is a server-runtime env var (not
      // NEXT_PUBLIC_), so client bundles resolve it to '' — stamping it
      // on <html> lets lib/image-url.ts resolve the CDN base in the
      // browser (document.documentElement.dataset.imageBase). The SSR
      // pass and this attribute read the same env, so hydration sees
      // identical URLs. Omitted entirely when unset (the common
      // single-host topology) — zero behavior change there.
      data-image-base={IMAGE_BASE_URL || undefined}
    >
      <head>
        <link rel="preconnect" href={seo.url} crossOrigin="anonymous" />
      </head>
      <body
        suppressHydrationWarning
        className="antialiased min-h-screen bg-background font-sans flex flex-col"
      >
        {/* Skip-to-main-content: first focusable element in the document so
            keyboard users can bypass repeated navigation on every page load.
            Becomes visible on focus; target id="main-content" is set by the
            (public) sub-layout's <main> element (US-P15 AC-6). */}
        <a
          href="#main-content"
          className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:top-4 focus-visible:left-4 focus-visible:z-50 focus-visible:px-4 focus-visible:py-2 focus-visible:bg-primary focus-visible:text-primary-foreground focus-visible:rounded-md"
        >
          {t('skipToContent')}
        </a>
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            themes={['system', 'light', 'dark', 'oled']}
            storageKey="gallery_theme"
            disableTransitionOnChange
            nonce={nonce}
          >
            <div className="flex-1">
              {children}
            </div>
            <Toaster />
          </ThemeProvider>
        </NextIntlClientProvider>
        <RegisterServiceWorker />
        {/* Pretendard font loaded via self-hosted @font-face in globals.css */}
      </body>
    </html>
  );
}
