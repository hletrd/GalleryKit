import { PasswordClient } from './password-client';
import { adminRouteMetadata } from '../../admin-metadata';

export const generateMetadata = () => adminRouteMetadata('password');

export default function PasswordPage() {
    return <PasswordClient />;
}
