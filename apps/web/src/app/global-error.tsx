'use client';

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <html>
            <body className="min-h-screen bg-background flex items-center justify-center">
                <div className="text-center space-y-4 p-8">
                    <h1 className="text-4xl font-bold text-muted-foreground/30">Error</h1>
                    <p className="text-muted-foreground">Something went wrong.</p>
                    <button
                        onClick={reset}
                        className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
                    >
                        Try again
                    </button>
                </div>
            </body>
        </html>
    );
}
