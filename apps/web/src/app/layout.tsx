import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Nav } from "@/components/nav";
import { Toaster } from "@/components/ui/sonner";
import { I18nProvider } from "@/components/i18n-provider";
import { Footer } from "@/components/footer";
import siteConfig from "@/site-config.json";

const inter = Inter({ subsets: ["latin"] });

const BASE_URL = process.env.BASE_URL || siteConfig.url;

export const dynamic = 'force-dynamic';
import Script from 'next/script';

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: siteConfig.title,
    template: `%s | ${siteConfig.title}`
  },
  description: siteConfig.description,
  openGraph: {
    title: siteConfig.title,
    description: siteConfig.description,
    url: BASE_URL,
    siteName: siteConfig.title,
    locale: siteConfig.locale,
    type: "website",
  },
  robots: {
    index: true,
    follow: true,
  }
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${inter.className} antialiased min-h-screen bg-background font-sans flex flex-col`}
      >
        <I18nProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem
            disableTransitionOnChange
          >
            <Nav />
            <main className="container mx-auto px-4 py-8 flex-1">
              {children}
            </main>
            <Footer />
            <Toaster />
          </ThemeProvider>

        </I18nProvider>
        {siteConfig.google_analytics_id && (
          <>
            <Script src={`https://www.googletagmanager.com/gtag/js?id=${siteConfig.google_analytics_id}`} strategy="afterInteractive" />
            <Script id="google-analytics" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());

                gtag('config', '${siteConfig.google_analytics_id}');
              `}
            </Script>
          </>
        )}
      </body>
    </html>
  );
}
