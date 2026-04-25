'use client';

import { useTranslation } from "@/components/i18n-provider";
import { PasswordForm } from "./password-form";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";

export function PasswordClient() {
    const { t } = useTranslation();

    return (
        <div className="max-w-2xl">
            <Card>
                <CardHeader>
                    <h1 className="text-2xl font-semibold leading-none tracking-tight">{t('password.title')}</h1>
                    <CardDescription>{t('password.minLength')}</CardDescription>
                </CardHeader>
                <CardContent>
                    <PasswordForm />
                </CardContent>
            </Card>
        </div>
    );
}
