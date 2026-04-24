import { headers } from 'next/headers';

export async function getCspNonce(): Promise<string | undefined> {
  if (process.env.NODE_ENV !== 'production') {
    return undefined;
  }

  return (await headers()).get('x-nonce') ?? undefined;
}
