'use client';

import { resolveErrorShellBrand } from '@/lib/error-shell';
import siteConfig from '@/site-config.json';

const COPY = {
    en: {
        title: 'Something went wrong',
        description: 'A fatal error interrupted the app.',
        action: 'Try again',
    },
    ko: {
        title: '문제가 발생했습니다',
        description: '치명적인 오류로 앱 실행이 중단되었습니다.',
        action: '다시 시도',
    },
} as const;

type SupportedLocale = keyof typeof COPY;

function detectLocale(): SupportedLocale {
    if (typeof window === 'undefined') return 'en';

    const [, firstSegment] = window.location.pathname.split('/');
    if (firstSegment?.toLowerCase() === 'ko') {
        return 'ko';
    }

    if (firstSegment?.toLowerCase() === 'en') {
        return 'en';
    }

    if (typeof navigator === 'undefined') return 'en';
    return navigator.language.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

function detectBrandTitle() {
    if (typeof document === 'undefined') {
        return resolveErrorShellBrand(null, siteConfig.nav_title, siteConfig.title);
    }

    return resolveErrorShellBrand(document, siteConfig.nav_title, siteConfig.title);
}

function detectDarkMode() {
    if (typeof document === 'undefined') return false;
    return document.documentElement.classList.contains('dark');
}

export default function GlobalError({
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    const locale = detectLocale();
    const copy = COPY[locale];
    const brandTitle = detectBrandTitle();
    const isDark = detectDarkMode();

    return (
        <html lang={locale} className={isDark ? 'dark' : undefined}>
            <body className="min-h-screen bg-background text-foreground">
                <main className="min-h-screen flex items-center justify-center px-6">
                    <div className="w-full max-w-md rounded-2xl border border-border bg-card/95 p-8 text-center shadow-lg">
                        <p className="text-sm font-medium text-muted-foreground uppercase tracking-[0.2em]">
                            {brandTitle}
                        </p>
                        <h1 className="mt-4 text-3xl font-semibold tracking-tight">{copy.title}</h1>
                        <p className="mt-3 text-sm text-muted-foreground">{copy.description}</p>
                        <button
                            type="button"
                            onClick={reset}
                            className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                        >
                            {copy.action}
                        </button>
                    </div>
                </main>
            </body>
        </html>
    );
}
