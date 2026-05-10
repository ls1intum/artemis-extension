import { Skeleton } from './Skeleton';
import styles from './Skeleton.module.css';

interface SkeletonListProps {
    count?: number;
}

export function SkeletonList({ count = 5 }: SkeletonListProps) {
    return (
        <div className={styles.skeletonList}>
            {Array.from({ length: count }).map((_, index) => (
                <div key={index} className={styles.skeletonListItem}>
                    <Skeleton
                        variant="circular"
                        width="40px"
                        height="40px"
                    />
                    <div className={styles.skeletonListContent}>
                        <Skeleton width="60%" height="16px" />
                        <Skeleton width="40%" height="14px" />
                    </div>
                </div>
            ))}
        </div>
    );
}
