/**
 * IME composition guards — R4C6 COR-R4C6-01.
 *
 * With a CJK IME (Korean is this product's second first-class locale),
 * pressing Enter to COMMIT the in-progress composition fires `keydown`
 * with `KeyboardEvent.isComposing === true` BEFORE the text is settled.
 * Handlers that treat Enter as "submit" therefore fire on the commit
 * keystroke: tags get added half-composed, search results get clicked
 * mid-query, dialogs submit truncated values. Arrow keys during
 * composition navigate the IME candidate list, so `preventDefault()`
 * on ArrowUp/ArrowDown breaks candidate selection too.
 *
 * Every Enter/Arrow handler attached to a text input MUST consult one
 * of these guards FIRST and return without acting while composing.
 *
 * `keyCode === 229` is the legacy signal some engines (notably Safari
 * on the composition-commit Enter, and older Chromium) report instead
 * of — or in addition to — `isComposing`. Both are checked.
 */

/** True when a NATIVE keydown belongs to an in-progress IME composition. */
export function isImeComposingNativeEvent(
    e: Pick<KeyboardEvent, 'isComposing' | 'keyCode'>,
): boolean {
    return e.isComposing || e.keyCode === 229;
}

/**
 * True when a React synthetic keydown belongs to an in-progress IME
 * composition. React does not surface `isComposing` on the synthetic
 * event itself; it lives on `nativeEvent`.
 */
export function isImeComposingReactEvent(e: {
    nativeEvent: Pick<KeyboardEvent, 'isComposing' | 'keyCode'>;
}): boolean {
    return isImeComposingNativeEvent(e.nativeEvent);
}
