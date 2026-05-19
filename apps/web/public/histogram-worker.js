// Histogram pixel computation Web Worker.
// Receives raw ImageData pixel buffer and computes RGB + luminance histograms
// off the main thread.
self.onmessage = function (e) {
    const { requestId, imageData, width, height, colorSpace } = e.data;
    const data = new Uint8ClampedArray(imageData);

    const r = new Array(256).fill(0);
    const g = new Array(256).fill(0);
    const b = new Array(256).fill(0);
    const l = new Array(256).fill(0);

    // R10-M2: branch luminance coefficients on canvas colorSpace.
    // Display-P3 uses P3 coefficients; sRGB (default) uses BT.709.
    // R5-L-BUNDLE: luminance is computed on gamma-encoded (display-referred)
    // values, not linearized scene-referred values. This matches Adobe
    // Lightroom / Capture One / most RAW processors. True CIE luminance Y
    // would require inverse transfer-function linearization first.
    const isP3 = colorSpace === 'display-p3';
    const lr = isP3 ? 0.22897 : 0.2126;
    const lg = isP3 ? 0.69174 : 0.7152;
    const lb = isP3 ? 0.07929 : 0.0722;

    const len = width * height * 4;
    for (let i = 0; i < len; i += 4) {
        const rv = data[i];
        const gv = data[i + 1];
        const bv = data[i + 2];
        r[rv]++;
        g[gv]++;
        b[bv]++;
        const lum = Math.round(lr * rv + lg * gv + lb * bv);
        l[lum]++;
    }

    self.postMessage({ requestId, histogram: { r, g, b, l } });
};
