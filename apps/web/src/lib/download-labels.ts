export type JpegDownloadCopy = {
    labelKey: 'viewer.downloadP3Jpeg' | 'viewer.downloadSrgbJpeg';
    descriptionKey: 'viewer.downloadP3JpegDesc' | 'viewer.downloadSrgbJpegDesc';
};

export function getJpegDownloadCopy(options: {
    isWideGamutSource: boolean;
    forceSrgbDerivatives: boolean;
}): JpegDownloadCopy {
    if (options.isWideGamutSource && !options.forceSrgbDerivatives) {
        return {
            labelKey: 'viewer.downloadP3Jpeg',
            descriptionKey: 'viewer.downloadP3JpegDesc',
        };
    }

    return {
        labelKey: 'viewer.downloadSrgbJpeg',
        descriptionKey: 'viewer.downloadSrgbJpegDesc',
    };
}
