'use client';

const messages = {
  en: { error: 'Error', description: 'Something went wrong.', tryAgain: 'Try again' },
  ko: { error: '오류', description: '문제가 발생했습니다.', tryAgain: '다시 시도' },
} as const;

function getLocale(): 'en' | 'ko' {
  if (typeof navigator === 'undefined') return 'en';
  const lang = navigator.language || '';
  if (lang.startsWith('ko')) return 'ko';
  return 'en';
}

export default function GlobalError({
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    const t = messages[getLocale()];

    return (
        <html>
            <body className="min-h-screen flex items-center justify-center bg-[#09090b] text-[#fafafa] font-sans">
                <div className="text-center p-8">
                    <h1 className="text-5xl font-bold opacity-30 mb-4">{t.error}</h1>
                    <p className="opacity-70 mb-6">{t.description}</p>
                    <button
                        onClick={reset}
                        className="px-6 py-2 bg-[#fafafa] text-[#09090b] border-none rounded-md cursor-pointer text-sm font-medium hover:opacity-90 transition-opacity"
                    >
                        {t.tryAgain}
                    </button>
                </div>
            </body>
        </html>
    );
}
