import { Nav } from '@/components/nav';
import { Footer } from '@/components/footer';

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
    return (
        <>
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
