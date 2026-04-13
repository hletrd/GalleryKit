import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';

export default async function NotFound() {
  const t = await getTranslations('notFound');
  const locale = await getLocale();

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center">
      <h1 className="text-7xl font-bold text-muted-foreground/30">404</h1>
      <p className="text-lg text-muted-foreground">
        {t('description')}
      </p>
      <Link
        href={`/${locale}`}
        className="text-primary hover:underline text-sm"
      >
        {t('backHome')}
      </Link>
    </div>
  );
}
