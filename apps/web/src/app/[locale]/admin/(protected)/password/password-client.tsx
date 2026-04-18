'use client';

import { useTranslation } from "@/components/i18n-provider";
import { PasswordForm } from "./password-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function PasswordClient() {
    const { t } = useTranslation();

    return (
        <div className="max-w-2xl">
            <Card>
                <CardHeader>
                    <CardTitle>{t('password.title')}</CardTitle>
                    <CardDescription>{t('password.minLength')}</CardDescription>
                </CardHeader>
                <CardContent>
                    <PasswordForm />
                </CardContent>
            </Card>
        </div>
    );
}
