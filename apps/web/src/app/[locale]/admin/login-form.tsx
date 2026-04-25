'use client';

import { login } from '@/app/actions';
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import { useActionState } from 'react';
import { toast } from 'sonner';
import { useEffect } from 'react';

import { useTranslations } from 'next-intl';
import { useTranslation } from '@/components/i18n-provider';

const initialState = {
    error: '',
};

export function LoginForm() {
    const t = useTranslations('login');
    const { locale } = useTranslation();
    const [state, formAction, isPending] = useActionState(login, initialState);

    useEffect(() => {
        if (state?.error) {
            toast.error(state.error);
        }
    }, [state]);

    return (
        <div className="flex items-center justify-center min-h-[60vh]">
            <Card className="w-full max-w-sm">
                <CardHeader>
                    <h1 className="text-2xl font-semibold leading-none tracking-tight">{t('title')}</h1>
                    <CardDescription>{t('description')}</CardDescription>
                </CardHeader>
                <CardContent>
                    <form action={formAction} className="space-y-4">
                        <input type="hidden" name="locale" value={locale} />
                        <label htmlFor="login-username" className="sr-only">{t('username')}</label>
                        <Input id="login-username" type="text" name="username" placeholder={t('username')} required autoFocus autoComplete="username" maxLength={64} />
                        <label htmlFor="login-password" className="sr-only">{t('password')}</label>
                        <Input id="login-password" type="password" name="password" placeholder={t('password')} required autoComplete="current-password" maxLength={1024} />
                        {state?.error && (
                            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert" aria-live="assertive">
                                {state.error}
                            </p>
                        )}
                        <Button type="submit" className="w-full" disabled={isPending}>
                            {isPending ? t('submitting') : t('submit')}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
