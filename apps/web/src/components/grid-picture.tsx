type GridPictureSource = {
    type: string;
    srcSet: string;
    sizes: string;
};

type GridPictureProps = {
    sources: GridPictureSource[];
    src: string;
    alt: string;
    width: number;
    height: number;
    className: string;
    loading?: 'eager' | 'lazy';
    decoding?: 'async' | 'auto' | 'sync';
    fetchPriority?: 'high' | 'low' | 'auto';
};

export function GridPicture({
    sources,
    src,
    alt,
    width,
    height,
    className,
    loading = 'lazy',
    decoding = 'async',
    fetchPriority,
}: GridPictureProps) {
    return (
        <picture data-grid-picture data-fallback-src={src}>
            {sources.map((source) => (
                <source
                    key={`${source.type}:${source.srcSet}`}
                    type={source.type}
                    srcSet={source.srcSet}
                    sizes={source.sizes}
                />
            ))}
            <img
                src={src}
                alt={alt}
                width={width}
                height={height}
                className={className}
                loading={loading}
                decoding={decoding}
                fetchPriority={fetchPriority}
            />
        </picture>
    );
}
