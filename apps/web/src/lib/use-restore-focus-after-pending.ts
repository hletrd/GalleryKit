'use client';

import { useEffect, useRef, type RefObject } from 'react';

/**
 * WCAG 2.4.3 focus-restore fix (C1-08 / DES-02): a submit control that sets
 * `disabled={isPending}` loses focus to `<body>` the instant React commits
 * the disabled attribute — the browser is spec-required to move focus off a
 * control that can no longer be focused, and nothing else in the tree is a
 * better default. Without this hook, a keyboard-only user loses their tab
 * position after every pending submission and must re-tab from the top of
 * the document to retry.
 *
 * When `isPending` transitions from `true` to `false`, this restores focus
 * to the element referenced by `ref` — but only if focus is currently on
 * `<body>` (or nowhere), so it never steals focus the user has since moved
 * on purpose (e.g. to a validation message or another field).
 */
export function useRestoreFocusAfterPending(
    ref: RefObject<HTMLElement | null>,
    isPending: boolean,
): void {
    const wasPendingRef = useRef(false);

    useEffect(() => {
        const wasPending = wasPendingRef.current;
        wasPendingRef.current = isPending;
        if (!wasPending || isPending) return;

        const el = ref.current;
        if (!el) return;
        const active = document.activeElement;
        if (active === document.body || active === null) {
            el.focus();
        }
    }, [isPending, ref]);
}
