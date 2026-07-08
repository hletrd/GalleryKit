export function PublicRestoreMaintenance({
    title,
    body,
}: {
    title: string;
    body: string;
}) {
    return (
        <div className="mx-auto flex min-h-[50vh] max-w-2xl flex-col justify-center px-4 py-16">
            <section className="rounded-md border bg-muted/30 p-6" role="status" aria-live="polite">
                <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
                <p className="mt-3 text-sm text-muted-foreground">{body}</p>
            </section>
        </div>
    );
}
