export const dynamic = 'force-dynamic';

export async function GET() {
    return Response.json({ status: 'ok' }, {
        headers: { 'X-Content-Type-Options': 'nosniff' },
    });
}
