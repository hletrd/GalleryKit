import { getTranslations } from 'next-intl/server';
import { Nav } from '@/components/nav';
import { Footer } from '@/components/footer';

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
    const t = await getTranslations('common');

    return (
        <>
            <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md">
                {t('skipToContent')}
            </a>
            <Nav />
            {/* `tabIndex={-1}` makes the skip link's target programmatically
                focusable so keyboard users actually land inside `<main>` after
                activating "Skip to content"; without it browsers move scroll
                but not focus, defeating the skip link (F-7). */}
            <main id="main-content" tabIndex={-1} className="w-full max-w-screen-2xl mx-auto px-4 py-8 flex-1 focus:outline-none">
                {children}
            </main>
            <Footer />
        </>
    );
}
