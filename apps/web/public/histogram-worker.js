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
        const lum = Math.round(0.2126 * rv + 0.7152 * gv + 0.0722 * bv);
        l[lum]++;
    }

    self.postMessage({ requestId, histogram: { r, g, b, l } });
};
