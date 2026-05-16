import clsx from 'clsx';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import FileText from 'lucide-react/dist/esm/icons/file-text';
import XCircle from 'lucide-react/dist/esm/icons/x-circle';
import { useState } from 'react';

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
                    <FileText size={16} className={styles.fileIcon} />
                    <span className={styles.headerText}>
                        {includedCount}/{files.totalCount} files referenced
                    </span>
                </div>
                <ChevronDown
                    size={16}
                    className={clsx(styles.chevron, {
                        [styles.chevronExpanded]: isExpanded,
                    })}
                />
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
                            <FileText size={14} className={styles.fileItemIcon} />
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
                            <XCircle size={14} className={styles.fileItemIcon} />
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
