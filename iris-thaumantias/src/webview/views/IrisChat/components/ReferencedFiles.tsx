import { useState } from 'react';
import clsx from 'clsx';
import type { ReferencedFilesData } from '../types';
import styles from './ReferencedFiles.module.css';

interface ReferencedFilesProps {
    files: ReferencedFilesData | null;
    onOpenFile: (path: string) => void;
}

export function ReferencedFiles({ files, onOpenFile }: ReferencedFilesProps) {
    const [isExpanded, setIsExpanded] = useState(false);

    if (!files || files.totalCount === 0) {
        return null;
    }

    const includedCount = files.includedFiles.length;
    const excludedCount = files.excludedFiles.length;

    return (
        <div className={styles.container}>
            <button
                className={styles.header}
                onClick={() => setIsExpanded(!isExpanded)}
                aria-expanded={isExpanded}
            >
                <div className={styles.headerContent}>
                    <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        className={styles.fileIcon}
                    >
                        <path
                            d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                        <polyline
                            points="13 2 13 9 20 9"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </svg>
                    <span className={styles.headerText}>
                        {includedCount}/{files.totalCount} files referenced
                    </span>
                </div>
                <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    className={clsx(styles.chevron, {
                        [styles.chevronExpanded]: isExpanded,
                    })}
                >
                    <polyline
                        points="6 9 12 15 18 9"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            </button>

            {isExpanded && (
                <div className={styles.fileList}>
                    {/* Included files */}
                    {files.includedFiles.map((path, index) => (
                        <button
                            key={`included-${index}`}
                            className={styles.fileItem}
                            onClick={() => onOpenFile(path)}
                        >
                            <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                className={styles.fileItemIcon}
                            >
                                <path
                                    d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                />
                                <polyline
                                    points="13 2 13 9 20 9"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                />
                            </svg>
                            <span className={styles.fileName}>{getFileName(path)}</span>
                            <span className={styles.fileStatus}>Will be sent</span>
                        </button>
                    ))}

                    {/* Divider if there are excluded files */}
                    {excludedCount > 0 && includedCount > 0 && (
                        <div className={styles.divider} />
                    )}

                    {/* Excluded files */}
                    {files.excludedFiles.map((file, index) => (
                        <button
                            key={`excluded-${index}`}
                            className={clsx(styles.fileItem, styles.fileItemExcluded)}
                            onClick={() => onOpenFile(file.path)}
                        >
                            <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                className={styles.fileItemIcon}
                            >
                                <circle
                                    cx="12"
                                    cy="12"
                                    r="10"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                />
                                <line
                                    x1="15"
                                    y1="9"
                                    x2="9"
                                    y2="15"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                />
                                <line
                                    x1="9"
                                    y1="9"
                                    x2="15"
                                    y2="15"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                />
                            </svg>
                            <span className={styles.fileName}>{getFileName(file.path)}</span>
                            <span className={styles.fileReason}>
                                {file.reason || 'Excluded'}
                            </span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

function getFileName(path: string): string {
    return path.split('/').pop() || path;
}
