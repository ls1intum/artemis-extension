import { createPortal } from 'react-dom';
import { useEffect } from 'react';
import clsx from 'clsx';
import CircleCheck from 'lucide-react/dist/esm/icons/circle-check';
import CircleX from 'lucide-react/dist/esm/icons/circle-x';
import { IconButton } from '../Button';
import type { TestCase } from './SubmissionStatus';
import styles from './TestResultsOverlay.module.css';

export type TestResultsOverlayCloseReason = 'button' | 'escape';

interface TestResultsOverlayProps {
    open: boolean;
    onClose: (reason: TestResultsOverlayCloseReason) => void;
    testCases: TestCase[];
    loading?: boolean;
    taskName?: string;
}

export function TestResultsOverlay({ open, onClose, testCases, loading = false, taskName }: TestResultsOverlayProps) {
    useEffect(() => {
        if (!open) { return; }
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose('escape');
            }
        };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [open, onClose]);

    useEffect(() => {
        if (!open) { return; }
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, [open]);

    if (!open) { return null; }

    const passed = testCases.filter((t) => t.passed);
    const failed = testCases.filter((t) => !t.passed);
    const total = testCases.length;
    const passedCount = passed.length;
    const percentage = total > 0 ? (passedCount / total) * 100 : 0;

    let summaryColorClass = styles.summaryFail;
    let progressFillClass = styles.progressFillDanger;
    if (percentage >= 80) {
        summaryColorClass = styles.summarySuccess;
        progressFillClass = styles.progressFillSuccess;
    } else if (percentage >= 40) {
        summaryColorClass = styles.summaryPartial;
        progressFillClass = styles.progressFillWarning;
    }

    const title = taskName ? `Feedback for task: ${taskName}` : 'Test Results';
    const emptyMessage = taskName ? 'No tests in this task.' : 'No test results available.';

    return createPortal(
        <div className={styles.backdrop}>
            <div className={styles.modal}>
                <div className={styles.header}>
                    <div className={styles.title}>{title}</div>
                    <IconButton.Close onClick={() => onClose('button')} />
                </div>

                {!loading && total > 0 && (
                    <div className={styles.summary}>
                        <div className={clsx(styles.summaryText, summaryColorClass)}>
                            {passedCount} of {total} test{total !== 1 ? 's' : ''} passed ({percentage.toFixed(0)}%)
                        </div>
                        <div className={styles.progressTrack}>
                            <div
                                className={clsx(styles.progressFill, progressFillClass)}
                                style={{ width: `${percentage}%` }}
                            />
                        </div>
                    </div>
                )}

                <div className={styles.testList}>
                    {loading ? (
                        <div className={styles.loading}>Loading test results...</div>
                    ) : total === 0 ? (
                        <div className={styles.empty}>{emptyMessage}</div>
                    ) : (
                        <>
                            {failed.length > 0 && (
                                <>
                                    <div className={clsx(styles.sectionLabel, styles.sectionLabelFailed)}>
                                        Failed ({failed.length})
                                    </div>
                                    {failed.map((tc, i) => (
                                        <TestResultItem key={`fail-${i}`} testCase={tc} />
                                    ))}
                                </>
                            )}
                            {passed.length > 0 && (
                                <>
                                    <div className={clsx(styles.sectionLabel, styles.sectionLabelPassed)}>
                                        Passed ({passed.length})
                                    </div>
                                    {passed.map((tc, i) => (
                                        <TestResultItem key={`pass-${i}`} testCase={tc} />
                                    ))}
                                </>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
}

function TestResultItem({ testCase }: { testCase: TestCase }) {
    return (
        <div
            className={clsx(styles.testItem, {
                [styles.testItemPassed]: testCase.passed,
                [styles.testItemFailed]: !testCase.passed,
            })}
        >
            <div
                className={clsx(styles.testIcon, {
                    [styles.testIconPassed]: testCase.passed,
                    [styles.testIconFailed]: !testCase.passed,
                })}
            >
                {testCase.passed ? <CircleCheck size={16} /> : <CircleX size={16} />}
            </div>
            <div className={styles.testContent}>
                <div className={styles.testHeader}>
                    <div className={styles.testName}>{testCase.name}</div>
                    {testCase.type && (
                        <span
                            className={clsx(
                                styles.typeBadge,
                                testCase.type === 'structural' ? styles.typeBadgeStructural : styles.typeBadgeBehavioral
                            )}
                        >
                            {testCase.type}
                        </span>
                    )}
                </div>
                {testCase.message && <div className={styles.testMessage}>{testCase.message}</div>}
            </div>
        </div>
    );
}
