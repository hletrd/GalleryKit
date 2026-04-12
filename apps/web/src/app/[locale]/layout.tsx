import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Nav } from "@/components/nav";
import { Toaster } from "@/components/ui/sonner";
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { Footer } from "@/components/footer";
import siteConfig from "@/site-config.json";
import { notFound } from 'next/navigation';
import { LOCALES } from '@/lib/constants';

const BASE_URL = process.env.BASE_URL || siteConfig.url;

import Script from 'next/script';

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: siteConfig.title,
    template: `%s | ${siteConfig.title}`
  },
  description: siteConfig.description,
  alternates: {
    languages: {
      'en': `${BASE_URL}/en`,
      'ko': `${BASE_URL}/ko`,
      'x-default': BASE_URL,
    },
  },
  openGraph: {
    title: siteConfig.title,
    description: siteConfig.description,
    url: BASE_URL,
    siteName: siteConfig.title,
    locale: siteConfig.locale,
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
    notFound();
  }

  // Providing all messages to the client
  // side is the easiest way to get started
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className="antialiased min-h-screen bg-background font-sans flex flex-col"
      >
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md">
          Skip to content
        </a>
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem
            disableTransitionOnChange
          >
            <Nav />
            <main id="main-content" className="container mx-auto px-4 py-8 flex-1">
              {children}
            </main>
            <Footer />
            <Toaster />
          </ThemeProvider>
        </NextIntlClientProvider>
        {/* Pretendard font — loaded via link (parallel, non-CSS-blocking) instead of @import */}
        <link
          rel="preload"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
          as="style"
        />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
        />
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
