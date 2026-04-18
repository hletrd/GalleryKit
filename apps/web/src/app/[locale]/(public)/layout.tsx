import { Nav } from '@/components/nav';
import { Footer } from '@/components/footer';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
    return (
        <>
            <Nav />
            <main id="main-content" className="container mx-auto px-4 py-8 flex-1">
                {children}
            </main>
            <Footer />
        </>
    );
}
