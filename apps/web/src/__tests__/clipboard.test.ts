import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { copyToClipboard } from '@/lib/clipboard';

type SelectionStub = {
    rangeCount: number;
    getRangeAt: ReturnType<typeof vi.fn>;
    removeAllRanges: ReturnType<typeof vi.fn>;
    addRange: ReturnType<typeof vi.fn>;
};

const originalNavigator = globalThis.navigator;
const originalDocument = globalThis.document;
const originalHTMLElement = globalThis.HTMLElement;

function setNavigator(value: Navigator | undefined) {
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value,
    });
}

function setDocument(value: Document | undefined) {
    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value,
    });
}

describe('copyToClipboard', () => {
    beforeEach(() => {
        setNavigator(undefined);
        setDocument(undefined);
        Object.defineProperty(globalThis, 'HTMLElement', {
            configurable: true,
            value: class HTMLElement {},
        });
    });

    afterEach(() => {
        setNavigator(originalNavigator);
        setDocument(originalDocument);
        Object.defineProperty(globalThis, 'HTMLElement', {
            configurable: true,
            value: originalHTMLElement,
        });
        vi.restoreAllMocks();
    });

    it('uses navigator.clipboard.writeText when available', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        setNavigator({ clipboard: { writeText } } as unknown as Navigator);

        await expect(copyToClipboard('share-link')).resolves.toBe(true);
        expect(writeText).toHaveBeenCalledWith('share-link');
    });

    it('falls back to execCommand when navigator.clipboard is unavailable', async () => {
        const focus = vi.fn();
        const textarea = {
            value: '',
            style: {},
            setAttribute: vi.fn(),
            focus,
            select: vi.fn(),
        };
        const savedRange = { id: 'saved-range' };
        const selection: SelectionStub = {
            rangeCount: 1,
            getRangeAt: vi.fn().mockReturnValue(savedRange),
            removeAllRanges: vi.fn(),
            addRange: vi.fn(),
        };
        const activeElement = new (globalThis.HTMLElement as typeof HTMLElement)();
        activeElement.focus = focus;
        const documentStub = {
            activeElement,
            body: {
                appendChild: vi.fn(),
                removeChild: vi.fn(),
            },
            createElement: vi.fn().mockReturnValue(textarea),
            execCommand: vi.fn().mockReturnValue(true),
            getSelection: vi.fn().mockReturnValue(selection),
        };
        setDocument(documentStub as unknown as Document);

        await expect(copyToClipboard('fallback-link')).resolves.toBe(true);
        expect(documentStub.createElement).toHaveBeenCalledWith('textarea');
        expect(textarea.select).toHaveBeenCalledTimes(1);
        expect(documentStub.execCommand).toHaveBeenCalledWith('copy');
        expect(selection.removeAllRanges).toHaveBeenCalledTimes(1);
        expect(selection.addRange).toHaveBeenCalledWith(savedRange);
        expect(focus).toHaveBeenCalled();
    });

    it('returns false when both clipboard paths fail', async () => {
        const writeText = vi.fn().mockRejectedValue(new Error('no clipboard'));
        const documentStub = {
            activeElement: null,
            body: {
                appendChild: vi.fn(),
                removeChild: vi.fn(),
            },
            createElement: vi.fn().mockReturnValue({
                value: '',
                style: {},
                setAttribute: vi.fn(),
                focus: vi.fn(),
                select: vi.fn(),
            }),
            execCommand: vi.fn().mockReturnValue(false),
            getSelection: vi.fn().mockReturnValue(null),
        };
        setNavigator({ clipboard: { writeText } } as unknown as Navigator);
        setDocument(documentStub as unknown as Document);

        await expect(copyToClipboard('fail-link')).resolves.toBe(false);
        expect(writeText).toHaveBeenCalledWith('fail-link');
        expect(documentStub.execCommand).toHaveBeenCalledWith('copy');
    });
});
