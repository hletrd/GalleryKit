import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Nav } from '@/components/nav';
import { Footer } from '@/components/footer';
import { localizePath } from '@/lib/locale-path';

// F-4 / F-22: this not-found surface previously rendered as a stripped page
// with only a "404 / Back to gallery" link, leaving users stranded with no
// nav, no footer, no `<main>` landmark, and no wayfinding. The fix
// reproduces the public layout shell so users can navigate to topics,
// search, switch locale, etc., even from a dead-end URL.
export default async function NotFound() {
  const [t, locale] = await Promise.all([
    getTranslations('notFound'),
    getLocale(),
  ]);

  return (
    <>
      <Nav />
      <main
        id="main-content"
        tabIndex={-1}
        className="container mx-auto px-4 py-8 flex-1 focus:outline-none"
      >
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center">
          {/* The big "404" numeral is purely decorative; promote
              "Page not found" to the real <h1> so screen readers announce
              the meaningful heading. The decorative numeral is bumped to
              60% opacity so it clears WCAG contrast in dark mode (F-14).
              `aria-hidden` keeps the duplicate semantic noise out of AT.
              */}
          <span aria-hidden="true" className="text-7xl font-bold text-muted-foreground/60 select-none">
            404
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('description')}
          </h1>
          <Link
            href={localizePath(locale, '/')}
            className="inline-flex items-center min-h-11 text-primary hover:underline text-sm rounded outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {t('backHome')}
          </Link>
        </div>
      </main>
      <Footer />
    </>
  );
}
