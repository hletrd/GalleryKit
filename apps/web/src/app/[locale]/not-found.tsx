import Link from 'next/link';
import { useTranslations } from 'next-intl';

export default function NotFound() {
  const t = useTranslations('notFound');

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center">
      <h1 className="text-7xl font-bold text-muted-foreground/30">404</h1>
      <p className="text-lg text-muted-foreground">
        {t('description')}
      </p>
      <Link
        href="/"
        className="text-primary hover:underline text-sm"
      >
        {t('backHome')}
      </Link>
    </div>
  );
}
