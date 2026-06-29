import type { ReactNode } from 'react';

import { adminRouteMetadata } from '../../admin-metadata';

export const generateMetadata = () => adminRouteMetadata('db');

export default function DbLayout({ children }: { children: ReactNode }) {
    return children;
}
