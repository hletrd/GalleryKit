/**
 * C2-23 (TEST-02): behavior coverage for `isEditableTarget`
 * (apps/web/src/lib/editable-target.ts).
 *
 * Environment note: this repo's vitest config runs the default `node`
 * environment — there is no jsdom/happy-dom and no `@testing-library/react`
 * (verified: neither appears in apps/web/package.json nor anywhere under
 * node_modules; same finding already documented in
 * cycle-r10c1-a11y-contracts.test.ts for a different hook). `isEditableTarget`
 * reads `HTMLInputElement` / `HTMLTextAreaElement` / `HTMLElement` as bare
 * globals and calls `.closest()` on the target, so it cannot run under plain
 * `node` without those globals existing.
 *
 * Rather than add a new test dependency, this file defines minimal
 * hand-rolled stand-ins for `HTMLElement` / `HTMLInputElement` /
 * `HTMLTextAreaElement` (installed on `globalThis` for the duration of this
 * file only) with just enough behavior — `isContentEditable`, attributes, and
 * a real ancestor-walking `closest()` — to drive the REAL `isEditableTarget`
 * function through each of its branches. This is not jsdom; it is a
 * purpose-built fake exercising actual function behavior, not a mock of the
 * function itself.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isEditableTarget } from '@/lib/editable-target';

class FakeHTMLElement {
    tagName: string;
    isContentEditable = false;
    parentElement: FakeHTMLElement | null = null;
    private attrs = new Map<string, string>();

    constructor(tagName: string) {
        this.tagName = tagName.toUpperCase();
    }

    setAttribute(name: string, value: string) {
        this.attrs.set(name, value);
    }

    getAttribute(name: string): string | null {
        return this.attrs.get(name) ?? null;
    }

    hasAttribute(name: string): boolean {
        return this.attrs.has(name);
    }

    /** Minimal selector matcher supporting the exact selector shapes used by
     *  isEditableTarget: bare tag names and `[attr]` / `[attr="value"]`. */
    private matches(selector: string): boolean {
        const attrEq = /^\[([\w-]+)="([^"]*)"\]$/.exec(selector);
        if (attrEq) return this.getAttribute(attrEq[1]) === attrEq[2];

        const attrExists = /^\[([\w-]+)\]$/.exec(selector);
        if (attrExists) return this.hasAttribute(attrExists[1]);

        return this.tagName === selector.toUpperCase();
    }

    /** Real ancestor-walking closest(), like the DOM method it stands in for. */
    closest(selectorList: string): FakeHTMLElement | null {
        const selectors = selectorList.split(',').map((s) => s.trim());
        return this.closestMatch(selectors);
    }

    private closestMatch(selectors: string[]): FakeHTMLElement | null {
        if (selectors.some((sel) => this.matches(sel))) return this;
        return this.parentElement ? this.parentElement.closestMatch(selectors) : null;
    }
}

class FakeHTMLInputElement extends FakeHTMLElement {
    constructor() {
        super('input');
    }
}

class FakeHTMLTextAreaElement extends FakeHTMLElement {
    constructor() {
        super('textarea');
    }
}

type GlobalsWithDom = typeof globalThis & {
    HTMLElement?: unknown;
    HTMLInputElement?: unknown;
    HTMLTextAreaElement?: unknown;
};

const g = globalThis as GlobalsWithDom;
const originalHTMLElement = g.HTMLElement;
const originalHTMLInputElement = g.HTMLInputElement;
const originalHTMLTextAreaElement = g.HTMLTextAreaElement;

beforeAll(() => {
    g.HTMLElement = FakeHTMLElement as unknown as typeof HTMLElement;
    g.HTMLInputElement = FakeHTMLInputElement as unknown as typeof HTMLInputElement;
    g.HTMLTextAreaElement = FakeHTMLTextAreaElement as unknown as typeof HTMLTextAreaElement;
});

afterAll(() => {
    g.HTMLElement = originalHTMLElement;
    g.HTMLInputElement = originalHTMLInputElement;
    g.HTMLTextAreaElement = originalHTMLTextAreaElement;
});

function fakeKeyboardEvent(target: unknown): KeyboardEvent {
    return { target } as unknown as KeyboardEvent;
}

describe('isEditableTarget', () => {
    it('returns false for a plain <div>', () => {
        const div = new FakeHTMLElement('div');
        expect(isEditableTarget(fakeKeyboardEvent(div))).toBe(false);
    });

    it('returns true for <input> and <textarea> via the direct fast path', () => {
        expect(isEditableTarget(fakeKeyboardEvent(new FakeHTMLInputElement()))).toBe(true);
        expect(isEditableTarget(fakeKeyboardEvent(new FakeHTMLTextAreaElement()))).toBe(true);
    });

    it('returns true for a contentEditable div', () => {
        const div = new FakeHTMLElement('div');
        div.isContentEditable = true;
        expect(isEditableTarget(fakeKeyboardEvent(div))).toBe(true);
    });

    it('returns true for a <span> nested inside a <button> (closest() path)', () => {
        const button = new FakeHTMLElement('button');
        const span = new FakeHTMLElement('span');
        span.parentElement = button;
        expect(isEditableTarget(fakeKeyboardEvent(span))).toBe(true);
    });

    it('returns true for an element with a role="switch" ancestor', () => {
        const switchAncestor = new FakeHTMLElement('div');
        switchAncestor.setAttribute('role', 'switch');
        const span = new FakeHTMLElement('span');
        span.parentElement = switchAncestor;
        expect(isEditableTarget(fakeKeyboardEvent(span))).toBe(true);
    });

    it('returns false for a bare <span> with no matching ancestor', () => {
        const span = new FakeHTMLElement('span');
        expect(isEditableTarget(fakeKeyboardEvent(span))).toBe(false);
    });

    it('returns false for a non-Element target (e.g. document), guarded by the instanceof HTMLElement check', () => {
        const documentLikeTarget = { nodeType: 9 };
        expect(isEditableTarget(fakeKeyboardEvent(documentLikeTarget))).toBe(false);
    });
});
