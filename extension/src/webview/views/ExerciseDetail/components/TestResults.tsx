import clsx from 'clsx';

import type { TestResultsProps } from '../types';
import styles from './TestResults.module.css';

/**
 * Extracted TestResults component for Phase 5 reuse.
 * Renders list of test cases grouped by pass/fail status.
 */
export function TestResults({ testCases }: TestResultsProps) {
    const passedTests = testCases.filter(tc => tc.passed);
    const failedTests = testCases.filter(tc => !tc.passed);

    if (testCases.length === 0) {
        return (
            <div className={styles.emptyState}>
                No test results available.
            </div>
        );
    }

    return (
        <div className={styles.testResults}>
            {failedTests.length > 0 && (
                <div className={styles.testGroup}>
                    <div className={styles.testGroupHeader}>
                        Failed Tests ({failedTests.length})
                    </div>
                    <div className={styles.testList}>
                        {failedTests.map((testCase, index) => (
                            <div
                                key={index}
                                className={clsx(styles.testCase, styles.testCaseFailed)}
                            >
                                <div className={styles.testIcon}>✗</div>
                                <div className={styles.testContent}>
                                    <div className={styles.testName}>{testCase.name}</div>
                                    {testCase.message && (
                                        <div className={styles.testMessage}>
                                            {testCase.message}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {passedTests.length > 0 && (
                <div className={styles.testGroup}>
                    <div className={styles.testGroupHeader}>
                        Passed Tests ({passedTests.length})
                    </div>
                    <div className={styles.testList}>
                        {passedTests.map((testCase, index) => (
                            <div
                                key={index}
                                className={clsx(styles.testCase, styles.testCasePassed)}
                            >
                                <div className={styles.testIcon}>✓</div>
                                <div className={styles.testContent}>
                                    <div className={styles.testName}>{testCase.name}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
