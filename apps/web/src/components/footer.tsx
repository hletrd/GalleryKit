import Link from "next/link";
import { getLocale, getTranslations } from 'next-intl/server';
import siteConfig from "@/site-config.json";
import { localizePath } from '@/lib/locale-path';

function GithubIcon({ className }: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
        >
            <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
            <path d="M9 18c-4.51 2-5-2-7-2" />
        </svg>
    )
}

export async function Footer() {
    const [locale, t] = await Promise.all([
        getLocale(),
        getTranslations('footer'),
    ]);

    return (
        <footer className="border-t py-6 md:py-0">
            <div className="container mx-auto px-4 flex flex-col items-center justify-between gap-4 md:h-24 md:flex-row">
                <p className="text-center text-sm leading-loose text-muted-foreground md:text-left">
                    {siteConfig.footer_text}
                </p>
                {/* DES-R4C15-05: min-h-11 on both links — isolated tap targets
                    on every public page's mobile footer must present the 44 px
                    floor. The md:h-24 desktop footer absorbs the height. */}
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <Link href={localizePath(locale, '/privacy')} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                        {t('privacy')}
                    </Link>
                    <Link
                        href="https://github.com/hletrd/gallerykit"
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`GitHub ${t('opensInNewWindow')}`}
                        className="flex min-h-11 items-center gap-2 rounded hover:underline outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                        <GithubIcon className="h-4 w-4" />
                        GitHub
                        <span className="sr-only"> ({t('opensInNewWindow')})</span>
                    </Link>
                    <Link href={localizePath(locale, '/admin')} rel="nofollow" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                        {t('admin')}
                    </Link>
                </div>
            </div>
        </footer>
    );
}
