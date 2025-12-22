'use client';

import { login } from '@/app/actions';
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useActionState } from 'react';
import { toast } from 'sonner';
import { useEffect } from 'react';

const initialState = {
    error: '',
};

export function LoginForm() {
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
                    <CardTitle>Admin Login</CardTitle>
                    <CardDescription>Enter password to manage gallery.</CardDescription>
                </CardHeader>
                <CardContent>
                    <form action={formAction} className="space-y-4">
                        <Input type="text" name="username" placeholder="Username" required autoFocus />
                        <Input type="password" name="password" placeholder="Password" required />
                        <Button type="submit" className="w-full" disabled={isPending}>
                            {isPending ? 'Logging in...' : 'Login'}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
