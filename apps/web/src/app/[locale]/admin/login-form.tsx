'use client';

import { login } from '@/app/actions';
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useActionState } from 'react';
import { toast } from 'sonner';
import { useEffect } from 'react';

import { useTranslations } from 'next-intl';

const initialState = {
    error: '',
};

export function LoginForm() {
    const t = useTranslations('login');
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
                    <CardTitle>{t('title')}</CardTitle>
                    <CardDescription>{t('description')}</CardDescription>
                </CardHeader>
                <CardContent>
                    <form action={formAction} className="space-y-4">
                        <Input type="text" name="username" placeholder={t('username')} required autoFocus autoComplete="username" />
                        <Input type="password" name="password" placeholder={t('password')} required autoComplete="current-password" />
                        <Button type="submit" className="w-full" disabled={isPending}>
                            {isPending ? t('submitting') : t('submit')}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
