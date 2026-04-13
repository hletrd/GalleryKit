'use client';

import Link from 'next/link';

export default function AdminError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center">
            <h1 className="text-7xl font-bold text-muted-foreground/30">Error</h1>
            <p className="text-lg text-muted-foreground">
                Something went wrong in the admin panel.
            </p>
            <div className="flex gap-4">
                <button
                    onClick={reset}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm"
                >
                    Try again
                </button>
                <Link
                    href="/admin/dashboard"
                    className="px-4 py-2 border rounded-md hover:bg-muted text-sm"
                >
                    Back to Dashboard
                </Link>
            </div>
        </div>
    );
}
