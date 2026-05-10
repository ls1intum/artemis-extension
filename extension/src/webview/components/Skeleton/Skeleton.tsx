import styles from './Skeleton.module.css';

interface SkeletonProps {
    width?: string;
    height?: string;
    variant?: 'text' | 'circular' | 'rectangular';
    className?: string;
}

export function Skeleton({
    width,
    height = '16px',
    variant = 'text',
    className = '',
}: SkeletonProps) {
    const variantClass = variant === 'circular'
        ? styles.skeletonCircular
        : variant === 'rectangular'
            ? styles.skeletonRectangular
            : styles.skeletonText;

    return (
        <div
            className={`${styles.skeleton} ${variantClass} ${className}`}
            style={{ width, height }}
            aria-busy="true"
            aria-live="polite"
        />
    );
}
