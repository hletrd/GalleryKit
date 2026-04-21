/** Copy text to clipboard. Requires a secure context (HTTPS or localhost). */
export async function copyToClipboard(text: string): Promise<boolean> {
    if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // Fall through to the legacy execCommand path below.
        }
    }

    if (typeof document === 'undefined') {
        return false;
    }

    const textarea = document.createElement('textarea');
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const selection = document.getSelection?.() ?? null;
    const savedRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    textarea.style.inset = '0';
    document.body.appendChild(textarea);

    try {
        textarea.focus();
        textarea.select();
        return document.execCommand('copy');
    } catch {
        return false;
    } finally {
        document.body.removeChild(textarea);
        selection?.removeAllRanges?.();
        if (savedRange) {
            selection?.addRange?.(savedRange);
        }
        activeElement?.focus?.();
    }
}
