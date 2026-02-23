import styles from './Breadcrumbs.module.css';

export interface BreadcrumbSegment {
    label: string;
    onClick: () => void;
}

export interface BreadcrumbsProps {
    segments: BreadcrumbSegment[];
}

export function Breadcrumbs({ segments }: BreadcrumbsProps) {
    if (!segments || segments.length === 0) {
        return null;
    }

    return (
        <nav className={styles.breadcrumbs} aria-label="Breadcrumb navigation">
            <div className={styles.breadcrumbsContainer}>
                {segments.map((segment, index) => {
                    const isLast = index === segments.length - 1;

                    return (
                        <span key={index} className={styles.breadcrumbSegment}>
                            {isLast ? (
                                <span
                                    className={styles.breadcrumbCurrent}
                                    aria-current="page"
                                >
                                    {segment.label}
                                </span>
                            ) : (
                                <>
                                    <button
                                        type="button"
                                        className={styles.breadcrumbLink}
                                        onClick={segment.onClick}
                                    >
                                        {segment.label}
                                    </button>
                                    <span
                                        className={styles.breadcrumbSeparator}
                                        aria-hidden="true"
                                    >
                                        {' / '}
                                    </span>
                                </>
                            )}
                        </span>
                    );
                })}
            </div>
        </nav>
    );
}
