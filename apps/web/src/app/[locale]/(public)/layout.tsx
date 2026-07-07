import { Nav } from '@/components/nav';
import { Footer } from '@/components/footer';
import { getCspNonce } from '@/lib/csp-nonce';
import siteConfig from '@/site-config.json';
import Script from 'next/script';

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
    const nonce = await getCspNonce();

    return (
        <>
            <Nav />
            {/* `tabIndex={-1}` makes the skip link's target programmatically
                focusable so keyboard users actually land inside `<main>` after
                activating "Skip to content"; without it browsers move scroll
                but not focus, defeating the skip link (F-7). */}
            <main id="main-content" tabIndex={-1} className="w-full flex-1 focus:outline-none">
                <div className="container mx-auto px-4 py-8">
                    {children}
                </div>
            </main>
            <Footer />
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
        </>
    );
}
