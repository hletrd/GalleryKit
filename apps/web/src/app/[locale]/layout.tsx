import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { LOCALES } from '@/lib/constants';
import { buildHreflangAlternates, getAlternateOpenGraphLocales, getOpenGraphLocale } from '@/lib/locale-path';
import { getSeoSettings } from '@/lib/data';
import siteConfig from "@/site-config.json";
import { getCspNonce } from '@/lib/csp-nonce';

import Script from 'next/script';

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
    robots: {
      index: true,
      follow: true,
    },
  };
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
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

  const [seo, messages] = await Promise.all([
    getSeoSettings(),
    getMessages(),
  ]);
  const nonce = await getCspNonce();

  return (
    <html
      lang={locale}
      // Explicit `dir` improves SR speech-flow heuristics and future-proofs for
      // RTL locales. Currently only LTR locales are shipped (C3R-RPL-05 /
      // AGG3R-05).
      dir="ltr"
      suppressHydrationWarning
      data-gallery-title={seo.title}
      data-gallery-nav-title={seo.nav_title || seo.title}
    >
      <body
        suppressHydrationWarning
        className="antialiased min-h-screen bg-background font-sans flex flex-col"
      >
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
            nonce={nonce}
          >
            <div className="flex-1">
              {children}
            </div>
            <Toaster />
          </ThemeProvider>
        </NextIntlClientProvider>
        {/* Pretendard font loaded via self-hosted @font-face in globals.css */}
        {siteConfig.google_analytics_id && /^(G-[A-Z0-9]+|UA-\d+-\d+)$/.test(siteConfig.google_analytics_id) && (
          <>
            <Script src={`https://www.googletagmanager.com/gtag/js?id=${siteConfig.google_analytics_id}`} strategy="lazyOnload" nonce={nonce} />
            <Script id="google-analytics" strategy="lazyOnload" nonce={nonce}>
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', ${JSON.stringify(siteConfig.google_analytics_id)});
              `}
            </Script>
          </>
        )}
      </body>
    </html>
  );
}
