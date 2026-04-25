import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PasswordClient } from './password-client';

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('nav');
    return { title: `${t('password')} | ${t('admin')}` };
}

export default function PasswordPage() {
    return <PasswordClient />;
}
