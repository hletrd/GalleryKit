'use client';

import { RefObject, useEffect } from 'react';

type IsolatedElementState = {
    element: HTMLElement;
    ariaHidden: string | null;
    inert: boolean;
};

function setInert(element: HTMLElement, value: boolean) {
    (element as HTMLElement & { inert: boolean }).inert = value;
}

function getInert(element: HTMLElement) {
    return Boolean((element as HTMLElement & { inert?: boolean }).inert);
}

export function useModalTreeIsolation(active: boolean, modalRootRef: RefObject<HTMLElement | null>) {
    useEffect(() => {
        if (!active || typeof document === 'undefined') return;

        const modalRoot = modalRootRef.current;
        if (!modalRoot) return;

        const hiddenElements: IsolatedElementState[] = [];
        const hideSubtree = (element: Element) => {
            if (!(element instanceof HTMLElement)) return;
            if (element === modalRoot || element.contains(modalRoot) || modalRoot.contains(element)) return;

            const activeElement = document.activeElement;
            if (activeElement instanceof HTMLElement && element.contains(activeElement)) {
                activeElement.blur();
            }

            hiddenElements.push({
                element,
                ariaHidden: element.getAttribute('aria-hidden'),
                inert: getInert(element),
            });
            element.setAttribute('aria-hidden', 'true');
            setInert(element, true);
        };

        let current: Element | null = modalRoot;
        while (current !== null && current.parentElement !== null) {
            const parent: HTMLElement = current.parentElement;
            for (const sibling of Array.from<Element>(parent.children)) {
                if (sibling !== current) hideSubtree(sibling);
            }
            if (parent === document.body) break;
            current = parent;
        }

        return () => {
            for (const { element, ariaHidden, inert } of hiddenElements.reverse()) {
                if (ariaHidden === null) {
                    element.removeAttribute('aria-hidden');
                } else {
                    element.setAttribute('aria-hidden', ariaHidden);
                }
                setInert(element, inert);
            }
        };
    }, [active, modalRootRef]);
}
