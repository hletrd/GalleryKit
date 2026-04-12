import {getRequestConfig} from 'next-intl/server';
import { LOCALES, DEFAULT_LOCALE } from '@/lib/constants';

export default getRequestConfig(async ({requestLocale}) => {
  let locale = await requestLocale;

  if (!locale || !(LOCALES as readonly string[]).includes(locale)) {
    locale = DEFAULT_LOCALE;
  }

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default
  };
});
