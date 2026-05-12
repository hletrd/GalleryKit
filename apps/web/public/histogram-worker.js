// Histogram pixel computation Web Worker.
// Receives raw ImageData pixel buffer and computes RGB + luminance histograms
// off the main thread.
self.onmessage = function (e) {
    const { requestId, imageData, width, height } = e.data;
    const data = new Uint8ClampedArray(imageData);

    const r = new Array(256).fill(0);
    const g = new Array(256).fill(0);
    const b = new Array(256).fill(0);
    const l = new Array(256).fill(0);

    const len = width * height * 4;
    for (let i = 0; i < len; i += 4) {
        const rv = data[i];
        const gv = data[i + 1];
        const bv = data[i + 2];
        r[rv]++;
        g[gv]++;
        b[bv]++;
        // R7-L1: BT.709 luminance coefficients are an approximation for all
        // primaries. P3 images decoded into a P3 canvas would ideally use
        // P3 coefficients (0.22897/0.69174/0.07929), but the difference is
        // ~2–3 % in luminance bins — acceptable for a compact histogram.
        const lum = Math.round(0.2126 * rv + 0.7152 * gv + 0.0722 * bv);
        l[lum]++;
    }

    self.postMessage({ requestId, histogram: { r, g, b, l } });
};
