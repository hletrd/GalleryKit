/**
 * Client-side AVIF decode-support probe (Promise singleton).
 *
 * R4C8 COR-R4C8-02: the previous probe constant (which lived inside
 * histogram.tsx) was structurally invalid ISOBMFF — its meta box held a
 * bogus `pbal` child and there was no iloc / av1C / mdat at all, so it
 * failed to decode in EVERY browser and the probe permanently resolved
 * `false`, silently disabling the wide-gamut AVIF histogram path on
 * P3-capable browsers. The constant below is a real 1×1 AVIF generated
 * with sharp (ftyp/meta[hdlr,pitm,iloc,iinf,iprp[av1C,ispe,pixi],ipma]/
 * mdat) and is locked by `__tests__/avif-probe-data-url.test.ts`, which
 * base64-decodes this literal and round-trips it through sharp.
 *
 * Pure module: no fs / sharp imports — safe for client components.
 * The Promise-singleton shape (C3-A4) is preserved so concurrent
 * callers all await the same probe and the first-render flicker fix
 * keeps working.
 */

export const AVIF_PROBE_DATA_URL = 'data:image/avif;base64,AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAANZtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAAA5waXRtAAAAAAABAAAAImlsb2MAAAAAREAAAQABAAAAAAD6AAEAAAAAAAAAFgAAACNpaW5mAAAAAAABAAAAFWluZmUCAAAAAAEAAGF2MDEAAAAAVmlwcnAAAAA4aXBjbwAAAAxhdjFDgSACAAAAABRpc3BlAAAAAAAAAAEAAAABAAAAEHBpeGkAAAAAAwgICAAAABZpcG1hAAAAAAAAAAEAAQOBAgMAAAAebWRhdBIACgc4AAYQENBpMgkfkD///8QABUg=';

let _avifSupportPromise: Promise<boolean> | null = null;

function probeAvifSupport(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        if (typeof window === 'undefined' || typeof Image === 'undefined') {
            resolve(false);
            return;
        }
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = AVIF_PROBE_DATA_URL;
    });
}

export function getAvifSupportPromise(): Promise<boolean> {
    if (!_avifSupportPromise) {
        _avifSupportPromise = probeAvifSupport();
    }
    return _avifSupportPromise;
}
