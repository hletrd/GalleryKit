'use client';

import dynamic from 'next/dynamic';
import type { FocusTrapProps } from 'focus-trap-react';

const FocusTrap = dynamic<FocusTrapProps>(() => import('focus-trap-react'), {
  ssr: false,
});

export default FocusTrap;
