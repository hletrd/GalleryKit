import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { LOCALES } from '@/lib/constants';
import { localizeUrl } from '@/lib/locale-path';
import { getSeoSettings } from '@/lib/data';
import siteConfig from "@/site-config.json";

import Script from 'next/script';

export async function generateMetadata(): Promise<Metadata> {
  const seo = await getSeoSettings();

  return {
    metadataBase: new URL(seo.url),
    title: {
      default: seo.title,
      template: `%s | ${seo.title}`
    },
    description: seo.description,
    alternates: {
      languages: {
        'en': localizeUrl(seo.url, 'en', '/'),
        'ko': localizeUrl(seo.url, 'ko', '/'),
        'x-default': seo.url,
      },
    },
    openGraph: {
      title: seo.title,
      description: seo.description,
      url: seo.url,
      siteName: seo.title,
      locale: seo.locale,
      alternateLocale: ['ko_KR', 'en_US'],
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

  const seo = await getSeoSettings();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
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
            <Script src={`https://www.googletagmanager.com/gtag/js?id=${siteConfig.google_analytics_id}`} strategy="lazyOnload" />
            <Script id="google-analytics" strategy="lazyOnload">
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
