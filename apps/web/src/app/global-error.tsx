'use client';

export default function GlobalError({
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <html>
            <body style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#09090b', color: '#fafafa', fontFamily: 'system-ui, sans-serif' }}>
                <div style={{ textAlign: 'center', padding: '2rem' }}>
                    <h1 style={{ fontSize: '3rem', fontWeight: 'bold', opacity: 0.3, marginBottom: '1rem' }}>Error</h1>
                    <p style={{ opacity: 0.7, marginBottom: '1.5rem' }}>Something went wrong.</p>
                    <button
                        onClick={reset}
                        style={{ padding: '0.5rem 1.5rem', backgroundColor: '#fafafa', color: '#09090b', border: 'none', borderRadius: '0.375rem', cursor: 'pointer', fontSize: '0.875rem' }}
                    >
                        Try again
                    </button>
                </div>
            </body>
        </html>
    );
}
