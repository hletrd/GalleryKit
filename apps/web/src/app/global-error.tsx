'use client';

import { useEffect, useState } from 'react';

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

export default function GlobalError({
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    const [locale, setLocale] = useState<SupportedLocale>('en');

    useEffect(() => {
        const nextLocale = navigator.language.toLowerCase().startsWith('ko') ? 'ko' : 'en';
        setLocale(nextLocale);
    }, []);

    const copy = COPY[locale];

    return (
        <html lang={locale}>
            <body className="min-h-screen bg-background text-foreground">
                <main className="min-h-screen flex items-center justify-center px-6">
                    <div className="w-full max-w-md rounded-2xl border border-border bg-card/95 p-8 text-center shadow-lg">
                        <p className="text-sm font-medium text-muted-foreground uppercase tracking-[0.2em]">
                            GalleryKit
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
