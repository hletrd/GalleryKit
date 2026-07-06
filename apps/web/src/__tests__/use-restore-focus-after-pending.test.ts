/**
 * C2-49 (TEST-04): behavior coverage for `useRestoreFocusAfterPending`
 * (apps/web/src/lib/use-restore-focus-after-pending.ts).
 *
 * Environment note: this repo's vitest config runs the default `node`
 * environment. There is no jsdom/happy-dom, no `@testing-library/react`, and
 * no `react-test-renderer` anywhere in the dependency tree (verified against
 * apps/web/package.json and node_modules) — `cycle-r10c1-a11y-contracts.test.ts`
 * already documents this same gap for this exact hook and falls back to
 * source-contract assertions only.
 *
 * Per the task's documented fallback ("build a minimal harness ... do NOT add
 * dependencies"), this file drives the REAL hook through `react-dom/client` +
 * `React.act` (both already present via the app's own `react`/`react-dom`
 * deps) using a hand-rolled minimal DOM stand-in — just enough surface for
 * react-dom's host config to mount a null-returning component and flush
 * effects — instead of a real jsdom document. The `ref` under test is a
 * plain externally-owned RefObject pointing at a fake element with a spy
 * `focus()`, so no actual host-DOM attachment is required for the element
 * the hook restores focus to; only `document.activeElement` / `document.body`
 * need to exist, which the fake document below provides directly.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import * as React from 'react';
import * as ReactDOMClient from 'react-dom/client';
import { useRestoreFocusAfterPending } from '@/lib/use-restore-focus-after-pending';

/** Minimal fake DOM node: enough for react-dom's host config to mount a
 *  container whose tree never renders any host elements (our harness
 *  component always returns null). */
class FakeDomNode {
    nodeType = 1;
    tagName = 'DIV';
    namespaceURI = 'http://www.w3.org/1999/xhtml';
    style = {};
    addEventListener() {}
    removeEventListener() {}
    appendChild(c: unknown) { return c; }
    insertBefore(c: unknown) { return c; }
    removeChild(c: unknown) { return c; }
    setAttribute() {}
    removeAttribute() {}
    get ownerDocument() { return (globalThis as { document?: unknown }).document; }
}

class FakeHTMLIFrameElement {}

type GlobalsWithDom = typeof globalThis & {
    window?: unknown;
    document?: unknown;
    HTMLIFrameElement?: unknown;
    IS_REACT_ACT_ENVIRONMENT?: unknown;
};

const g = globalThis as GlobalsWithDom;
const originalWindow = g.window;
const originalDocument = g.document;
const originalHTMLIFrameElement = g.HTMLIFrameElement;
const originalActEnvironment = g.IS_REACT_ACT_ENVIRONMENT;

let fakeBody: FakeDomNode;
let fakeDocument: {
    activeElement: unknown;
    body: FakeDomNode;
    createElement: () => FakeDomNode;
    createTextNode: () => FakeDomNode;
    createComment: () => FakeDomNode;
    createDocumentFragment: () => FakeDomNode;
    addEventListener: () => void;
    removeEventListener: () => void;
};

beforeEach(() => {
    fakeBody = new FakeDomNode();
    fakeDocument = {
        activeElement: fakeBody,
        body: fakeBody,
        createElement: () => new FakeDomNode(),
        createTextNode: () => new FakeDomNode(),
        createComment: () => new FakeDomNode(),
        createDocumentFragment: () => new FakeDomNode(),
        addEventListener: () => {},
        removeEventListener: () => {},
    };
    g.document = fakeDocument as unknown as Document;
    g.window = globalThis as unknown as Window & typeof globalThis;
    g.HTMLIFrameElement = FakeHTMLIFrameElement as unknown as typeof HTMLIFrameElement;
    g.IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(() => {
    g.document = originalDocument;
    g.window = originalWindow;
    g.HTMLIFrameElement = originalHTMLIFrameElement;
    g.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
});

function mountHarness(ref: React.RefObject<HTMLElement | null>, initialIsPending: boolean) {
    const container = new FakeDomNode();

    function Harness({ isPending }: { isPending: boolean }) {
        useRestoreFocusAfterPending(ref, isPending);
        return null;
    }

    let root!: ReactDOMClient.Root;
    React.act(() => {
        root = ReactDOMClient.createRoot(container as unknown as Element);
        root.render(React.createElement(Harness, { isPending: initialIsPending }));
    });

    return {
        rerender(isPending: boolean) {
            React.act(() => {
                root.render(React.createElement(Harness, { isPending }));
            });
        },
        unmount() {
            React.act(() => {
                root.unmount();
            });
        },
    };
}

function makeFocusableRef(): { ref: React.RefObject<HTMLElement | null>; focusMock: ReturnType<typeof vi.fn> } {
    const focusMock = vi.fn();
    const target = { focus: focusMock } as unknown as HTMLElement;
    return { ref: { current: target }, focusMock };
}

describe('useRestoreFocusAfterPending', () => {
    it('restores focus on a true -> false transition when focus is on document.body', () => {
        const { ref, focusMock } = makeFocusableRef();
        const harness = mountHarness(ref, false);

        harness.rerender(true);
        expect(focusMock).not.toHaveBeenCalled();

        harness.rerender(false);
        expect(focusMock).toHaveBeenCalledTimes(1);

        harness.unmount();
    });

    it('does not steal focus when the user moved focus elsewhere during the pending window', () => {
        const { ref, focusMock } = makeFocusableRef();
        const harness = mountHarness(ref, false);

        harness.rerender(true);
        // The user tabs away to another control while the request is pending.
        const otherElement = new FakeDomNode();
        fakeDocument.activeElement = otherElement;

        harness.rerender(false);
        expect(focusMock).not.toHaveBeenCalled();

        harness.unmount();
    });

    it('does not call focus when the pending transition never happens', () => {
        // Stays false the whole time: no true->false edge ever occurs.
        const { ref: refA, focusMock: focusA } = makeFocusableRef();
        const harnessA = mountHarness(refA, false);
        harnessA.rerender(false);
        harnessA.rerender(false);
        expect(focusA).not.toHaveBeenCalled();
        harnessA.unmount();

        // Goes false -> true only (never back to false): still no restore.
        const { ref: refB, focusMock: focusB } = makeFocusableRef();
        const harnessB = mountHarness(refB, false);
        harnessB.rerender(true);
        expect(focusB).not.toHaveBeenCalled();
        harnessB.unmount();
    });
});
