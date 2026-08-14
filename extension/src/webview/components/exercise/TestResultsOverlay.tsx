import clsx from 'clsx';
import CircleCheck from 'lucide-react/dist/esm/icons/circle-check';
import CircleX from 'lucide-react/dist/esm/icons/circle-x';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

import { IconButton } from '@webview/components/Button';
import type { TaskTestState } from '@webview/utils/exerciseStatus';

import type { TestCase } from './SubmissionStatus';
import styles from './TestResultsOverlay.module.css';

type TestResultsOverlayCloseReason = 'button' | 'escape';

/** Per-task: classified state from {@link classifyTaskTests}. */
interface TestResultsOverlayTaskProps {
    open: boolean;
    onClose: (reason: TestResultsOverlayCloseReason) => void;
    state: TaskTestState;
    taskName: string;
    loading?: boolean;
    buildRunning?: boolean;
}

/** Global overview: unfiltered list of all test cases for the latest result. */
interface TestResultsOverlayOverviewProps {
    open: boolean;
    onClose: (reason: TestResultsOverlayCloseReason) => void;
    state: { kind: 'all'; testCases: TestCase[] };
    loading?: boolean;
    buildRunning?: boolean;
}

type TestResultsOverlayProps = TestResultsOverlayTaskProps | TestResultsOverlayOverviewProps;

export function TestResultsOverlay(props: TestResultsOverlayProps) {
    const { open, onClose, loading = false, buildRunning = false } = props;

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

    const isTask = 'taskName' in props;
    const title = isTask ? `Feedback for task: ${props.taskName}` : 'Test Results';

    return createPortal(
        <div className={styles.backdrop}>
            <div className={styles.modal}>
                <div className={styles.header}>
                    <div className={styles.title}>{title}</div>
                    <IconButton.Close onClick={() => onClose('button')} />
                </div>

                {buildRunning && (
                    <div className={styles.rebuildBanner} role="status">
                        A new build is running. Showing feedback from your previous submission. This will update automatically.
                    </div>
                )}

                {loading ? (
                    <div className={styles.testList}>
                        <div className={styles.loading}>Loading test results...</div>
                    </div>
                ) : isTask ? (
                    <TaskBody state={props.state} />
                ) : (
                    <OverviewBody testCases={props.state.testCases} />
                )}
            </div>
        </div>,
        document.body
    );
}

function OverviewBody({ testCases }: { testCases: TestCase[] }) {
    const passed = testCases.filter((t) => t.passed);
    const failed = testCases.filter((t) => !t.passed);
    const total = testCases.length;

    return (
        <>
            {total > 0 && <Summary passedCount={passed.length} total={total} />}
            <div className={styles.testList}>
                {total === 0 ? (
                    <div className={styles.empty}>No test results available.</div>
                ) : (
                    <>
                        {failed.length > 0 && (
                            <Section label="Failed" count={failed.length} variant="failed">
                                {failed.map((tc, i) => (
                                    <TestResultItem key={`fail-${i}`} testCase={tc} />
                                ))}
                            </Section>
                        )}
                        {passed.length > 0 && (
                            <Section label="Passed" count={passed.length} variant="passed">
                                {passed.map((tc, i) => (
                                    <TestResultItem key={`pass-${i}`} testCase={tc} />
                                ))}
                            </Section>
                        )}
                    </>
                )}
            </div>
        </>
    );
}

function TaskBody({ state }: { state: TaskTestState }) {
    switch (state.kind) {
        case 'no-result':
            return <Empty>No build results yet for this exercise. Submit your code to see test feedback.</Empty>;

        case 'no-feedbacks':
            return <Empty>The latest build produced no test feedback for this task.</Empty>;

        case 'no-tests-in-task':
            return <Empty>This task has no associated tests.</Empty>;

        case 'legacy-success': {
            const n = state.testIds.length;
            return (
                <>
                    <Summary passedCount={n} total={n} />
                    <div className={styles.testList}>
                        <div className={styles.empty}>All {n} test{n !== 1 ? 's' : ''} passed. Detailed feedback isn&apos;t available for this result.</div>
                    </div>
                </>
            );
        }

        case 'success': {
            const n = state.passed.length;
            return (
                <>
                    <Summary passedCount={n} total={n} />
                    <div className={styles.testList}>
                        <Section label="Passed" count={n} variant="passed">
                            {state.passed.map((tc, i) => (
                                <TestResultItem key={`pass-${i}`} testCase={tc} />
                            ))}
                        </Section>
                    </div>
                </>
            );
        }

        case 'fail': {
            const matched = state.passed.length + state.failed.length;
            return (
                <>
                    {matched > 0 && <Summary passedCount={state.passed.length} total={matched} />}
                    <div className={styles.testList}>
                        <Section label="Failed" count={state.failed.length} variant="failed">
                            {state.failed.map((tc, i) => (
                                <TestResultItem key={`fail-${i}`} testCase={tc} />
                            ))}
                        </Section>
                        {state.passed.length > 0 && (
                            <Section label="Passed" count={state.passed.length} variant="passed">
                                {state.passed.map((tc, i) => (
                                    <TestResultItem key={`pass-${i}`} testCase={tc} />
                                ))}
                            </Section>
                        )}
                        {state.notExecutedIds.length > 0 && (
                            <NotExecutedNote count={state.notExecutedIds.length} />
                        )}
                    </div>
                </>
            );
        }

        case 'not-executed': {
            const passedCount = state.passed.length;
            const notRunCount = state.notExecutedIds.length;
            if (passedCount === 0) {
                return <Empty>{notRunCount === 1 ? '1 test in this task did not run' : `${notRunCount} tests in this task did not run`} in the latest build.</Empty>;
            }
            return (
                <>
                    <Summary passedCount={passedCount} total={passedCount + notRunCount} />
                    <div className={styles.testList}>
                        <Section label="Passed" count={passedCount} variant="passed">
                            {state.passed.map((tc, i) => (
                                <TestResultItem key={`pass-${i}`} testCase={tc} />
                            ))}
                        </Section>
                        {notRunCount > 0 && <NotExecutedNote count={notRunCount} />}
                    </div>
                </>
            );
        }
    }
}

function Summary({ passedCount, total }: { passedCount: number; total: number }) {
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

    return (
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
    );
}

function Section({ label, count, variant, children }: {
    label: string;
    count: number;
    variant: 'passed' | 'failed';
    children: React.ReactNode;
}) {
    const labelClass = variant === 'passed' ? styles.sectionLabelPassed : styles.sectionLabelFailed;
    return (
        <>
            <div className={clsx(styles.sectionLabel, labelClass)}>
                {label} ({count})
            </div>
            {children}
        </>
    );
}

function Empty({ children }: { children: React.ReactNode }) {
    return (
        <div className={styles.testList}>
            <div className={styles.empty}>{children}</div>
        </div>
    );
}

function NotExecutedNote({ count }: { count: number }) {
    return (
        <div className={styles.empty}>
            {count === 1 ? '1 test in this task did not run' : `${count} tests in this task did not run`} in the latest build.
        </div>
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
