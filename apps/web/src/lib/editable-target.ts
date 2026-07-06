/**
 * C1-29 (ARCH-01): extracted from photo-viewer.tsx into this zero-import leaf
 * module so photo-viewer.tsx and lightbox.tsx no longer form a value-level
 * import cycle (photo-viewer imported Lightbox while lightbox imported this
 * helper back from photo-viewer). Pure DOM predicate, client-safe.
 */

/** Check if a keyboard event target belongs to an interactive element. */
export function isEditableTarget(e: KeyboardEvent): boolean {
    const target = e.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    if (target.closest([
        'a',
        'button',
        'select',
        'textarea',
        'summary',
        '[contenteditable="true"]',
        '[role="button"]',
        '[role="link"]',
        '[role="menuitem"]',
        '[role="option"]',
        '[role="textbox"]',
        '[role="switch"]',
        '[data-radix-popper-content-wrapper]',
    ].join(','))) return true;
    return false;
}
