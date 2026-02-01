/**
 * Evaluation Engine
 * 
 * Aggregates results from multiple scenarios into a comprehensive report
 * with confusion matrix and ML metrics.
 */

import {
    ScenarioResult,
    TestSuiteReport,
    CategoryResult,
} from './types';

/**
 * Aggregates individual scenario results into a test suite report
 */
export class EvaluationEngine {
    
    /**
     * Generate a full test suite report from scenario results
     */
    generateReport(results: ScenarioResult[], startTime: Date): TestSuiteReport {
        const endTime = new Date();
        
        // Calculate confusion matrix
        const confusionMatrix = this.calculateConfusionMatrix(results);
        
        // Calculate ML metrics
        const metrics = this.calculateMLMetrics(confusionMatrix);
        
        // Group by difficulty
        const byDifficulty = this.groupByDifficulty(results);
        
        return {
            timestamp: startTime,
            duration: endTime.getTime() - startTime.getTime(),
            
            totalScenarios: results.length,
            passed: results.filter(r => r.passed).length,
            failed: results.filter(r => !r.passed).length,
            
            confusionMatrix,
            
            precision: metrics.precision,
            recall: metrics.recall,
            f1Score: metrics.f1Score,
            accuracy: metrics.accuracy,
            
            byDifficulty,
            
            results,
        };
    }
    
    /**
     * Calculate confusion matrix from results
     */
    private calculateConfusionMatrix(results: ScenarioResult[]): {
        truePositive: number;
        trueNegative: number;
        falsePositive: number;
        falseNegative: number;
    } {
        let tp = 0, tn = 0, fp = 0, fn = 0;
        
        for (const result of results) {
            const expected = result.scenario.expectedOutcome.shouldDetectStruggle;
            const detected = result.metrics.detectedStruggle;
            
            if (expected && detected) {
                tp++;
            } else if (!expected && !detected) {
                tn++;
            } else if (!expected && detected) {
                fp++;
            } else if (expected && !detected) {
                fn++;
            }
        }
        
        return { truePositive: tp, trueNegative: tn, falsePositive: fp, falseNegative: fn };
    }
    
    /**
     * Calculate precision, recall, F1 score, and accuracy
     */
    private calculateMLMetrics(cm: {
        truePositive: number;
        trueNegative: number;
        falsePositive: number;
        falseNegative: number;
    }): {
        precision: number;
        recall: number;
        f1Score: number;
        accuracy: number;
    } {
        const { truePositive, trueNegative, falsePositive, falseNegative } = cm;
        
        // Precision = TP / (TP + FP)
        const precision = truePositive + falsePositive > 0
            ? truePositive / (truePositive + falsePositive)
            : 0;
        
        // Recall = TP / (TP + FN)
        const recall = truePositive + falseNegative > 0
            ? truePositive / (truePositive + falseNegative)
            : 0;
        
        // F1 = 2 * (precision * recall) / (precision + recall)
        const f1Score = precision + recall > 0
            ? 2 * (precision * recall) / (precision + recall)
            : 0;
        
        // Accuracy = (TP + TN) / total
        const total = truePositive + trueNegative + falsePositive + falseNegative;
        const accuracy = total > 0
            ? (truePositive + trueNegative) / total
            : 0;
        
        return { precision, recall, f1Score, accuracy };
    }
    
    /**
     * Group results by difficulty category
     */
    private groupByDifficulty(results: ScenarioResult[]): {
        obvious: CategoryResult;
        subtle: CategoryResult;
        'edge-case': CategoryResult;
    } {
        const categories: Record<string, ScenarioResult[]> = {
            obvious: [],
            subtle: [],
            'edge-case': [],
        };
        
        for (const result of results) {
            const difficulty = result.scenario.difficulty;
            if (categories[difficulty]) {
                categories[difficulty].push(result);
            } else {
                categories['obvious'].push(result);
            }
        }
        
        return {
            obvious: this.calculateCategoryResult(categories['obvious']),
            subtle: this.calculateCategoryResult(categories['subtle']),
            'edge-case': this.calculateCategoryResult(categories['edge-case']),
        };
    }
    
    /**
     * Calculate stats for a category
     */
    private calculateCategoryResult(results: ScenarioResult[]): CategoryResult {
        if (results.length === 0) {
            return { total: 0, passed: 0, failed: 0, avgScore: 0 };
        }
        
        const passed = results.filter(r => r.passed).length;
        const avgScore = results.reduce((sum, r) => sum + r.metrics.finalScore, 0) / results.length;
        
        return {
            total: results.length,
            passed,
            failed: results.length - passed,
            avgScore,
        };
    }
    
    /**
     * Format report as console output
     */
    formatConsoleReport(report: TestSuiteReport): string {
        const lines: string[] = [];
        
        lines.push('');
        lines.push('╔══════════════════════════════════════════════════════════════╗');
        lines.push('║           STRUGGLE DETECTION TEST REPORT                     ║');
        lines.push('╠══════════════════════════════════════════════════════════════╣');
        lines.push(`║ Timestamp: ${report.timestamp.toISOString().padEnd(47)}║`);
        lines.push(`║ Duration:  ${(report.duration / 1000).toFixed(2)}s${' '.repeat(45)}║`);
        lines.push('╠══════════════════════════════════════════════════════════════╣');
        lines.push('║ SUMMARY                                                      ║');
        lines.push('╠══════════════════════════════════════════════════════════════╣');
        lines.push(`║ Total:     ${String(report.totalScenarios).padEnd(6)} Passed: ${String(report.passed).padEnd(6)} Failed: ${String(report.failed).padEnd(6)}   ║`);
        lines.push('╠══════════════════════════════════════════════════════════════╣');
        lines.push('║ CONFUSION MATRIX                                             ║');
        lines.push('╠══════════════════════════════════════════════════════════════╣');
        lines.push(`║                    │ Predicted Struggle │ Predicted OK       ║`);
        lines.push(`║ ───────────────────┼────────────────────┼─────────────────── ║`);
        lines.push(`║ Actual Struggle    │ TP: ${String(report.confusionMatrix.truePositive).padEnd(14)} │ FN: ${String(report.confusionMatrix.falseNegative).padEnd(13)} ║`);
        lines.push(`║ Actual OK          │ FP: ${String(report.confusionMatrix.falsePositive).padEnd(14)} │ TN: ${String(report.confusionMatrix.trueNegative).padEnd(13)} ║`);
        lines.push('╠══════════════════════════════════════════════════════════════╣');
        lines.push('║ ML METRICS                                                   ║');
        lines.push('╠══════════════════════════════════════════════════════════════╣');
        lines.push(`║ Precision: ${(report.precision * 100).toFixed(1).padStart(5)}%    Recall: ${(report.recall * 100).toFixed(1).padStart(5)}%                      ║`);
        lines.push(`║ F1 Score:  ${(report.f1Score * 100).toFixed(1).padStart(5)}%    Accuracy: ${(report.accuracy * 100).toFixed(1).padStart(5)}%                    ║`);
        lines.push('╠══════════════════════════════════════════════════════════════╣');
        lines.push('║ BY DIFFICULTY                                                ║');
        lines.push('╠══════════════════════════════════════════════════════════════╣');
        lines.push(`║ Obvious:   ${report.byDifficulty.obvious.passed}/${report.byDifficulty.obvious.total} passed (avg score: ${report.byDifficulty.obvious.avgScore.toFixed(1)})`.padEnd(63) + '║');
        lines.push(`║ Subtle:    ${report.byDifficulty.subtle.passed}/${report.byDifficulty.subtle.total} passed (avg score: ${report.byDifficulty.subtle.avgScore.toFixed(1)})`.padEnd(63) + '║');
        lines.push(`║ Edge-case: ${report.byDifficulty['edge-case'].passed}/${report.byDifficulty['edge-case'].total} passed (avg score: ${report.byDifficulty['edge-case'].avgScore.toFixed(1)})`.padEnd(63) + '║');
        lines.push('╚══════════════════════════════════════════════════════════════╝');
        
        // Failed scenarios
        const failed = report.results.filter(r => !r.passed);
        if (failed.length > 0) {
            lines.push('');
            lines.push('FAILED SCENARIOS:');
            lines.push('─'.repeat(64));
            for (const result of failed) {
                lines.push(`  ✗ ${result.scenario.id}`);
                lines.push(`    Expected: score ${result.scenario.expectedOutcome.expectedScore.min}-${result.scenario.expectedOutcome.expectedScore.max}, action: ${result.scenario.expectedOutcome.expectedAction}`);
                lines.push(`    Got:      score ${result.metrics.finalScore.toFixed(1)}, action: ${result.scoreTimeline[result.scoreTimeline.length - 1]?.score.recommendedAction ?? 'unknown'}`);
                if (result.errors.length > 0) {
                    lines.push(`    Errors:   ${result.errors.join(', ')}`);
                }
            }
        }
        
        lines.push('');
        
        return lines.join('\n');
    }
    
    /**
     * Format report as Markdown
     */
    formatMarkdownReport(report: TestSuiteReport): string {
        const lines: string[] = [];
        
        lines.push('# Struggle Detection Test Report');
        lines.push('');
        lines.push(`**Date:** ${report.timestamp.toISOString()}`);
        lines.push(`**Duration:** ${(report.duration / 1000).toFixed(2)}s`);
        lines.push('');
        
        lines.push('## Summary');
        lines.push('');
        lines.push(`| Metric | Value |`);
        lines.push(`|--------|-------|`);
        lines.push(`| Total Scenarios | ${report.totalScenarios} |`);
        lines.push(`| Passed | ${report.passed} |`);
        lines.push(`| Failed | ${report.failed} |`);
        lines.push(`| Pass Rate | ${((report.passed / report.totalScenarios) * 100).toFixed(1)}% |`);
        lines.push('');
        
        lines.push('## Confusion Matrix');
        lines.push('');
        lines.push('|  | Predicted Struggle | Predicted OK |');
        lines.push('|--|-------------------|--------------|');
        lines.push(`| **Actual Struggle** | TP: ${report.confusionMatrix.truePositive} | FN: ${report.confusionMatrix.falseNegative} |`);
        lines.push(`| **Actual OK** | FP: ${report.confusionMatrix.falsePositive} | TN: ${report.confusionMatrix.trueNegative} |`);
        lines.push('');
        
        lines.push('## ML Metrics');
        lines.push('');
        lines.push(`| Metric | Value |`);
        lines.push(`|--------|-------|`);
        lines.push(`| Precision | ${(report.precision * 100).toFixed(1)}% |`);
        lines.push(`| Recall | ${(report.recall * 100).toFixed(1)}% |`);
        lines.push(`| F1 Score | ${(report.f1Score * 100).toFixed(1)}% |`);
        lines.push(`| Accuracy | ${(report.accuracy * 100).toFixed(1)}% |`);
        lines.push('');
        
        lines.push('## Results by Difficulty');
        lines.push('');
        lines.push(`| Difficulty | Passed | Failed | Avg Score |`);
        lines.push(`|------------|--------|--------|-----------|`);
        lines.push(`| Obvious | ${report.byDifficulty.obvious.passed}/${report.byDifficulty.obvious.total} | ${report.byDifficulty.obvious.failed} | ${report.byDifficulty.obvious.avgScore.toFixed(1)} |`);
        lines.push(`| Subtle | ${report.byDifficulty.subtle.passed}/${report.byDifficulty.subtle.total} | ${report.byDifficulty.subtle.failed} | ${report.byDifficulty.subtle.avgScore.toFixed(1)} |`);
        lines.push(`| Edge-case | ${report.byDifficulty['edge-case'].passed}/${report.byDifficulty['edge-case'].total} | ${report.byDifficulty['edge-case'].failed} | ${report.byDifficulty['edge-case'].avgScore.toFixed(1)} |`);
        lines.push('');
        
        // Failed scenarios
        const failed = report.results.filter(r => !r.passed);
        if (failed.length > 0) {
            lines.push('## Failed Scenarios');
            lines.push('');
            for (const result of failed) {
                lines.push(`### ✗ ${result.scenario.id}`);
                lines.push('');
                lines.push(`- **Expected:** score ${result.scenario.expectedOutcome.expectedScore.min}-${result.scenario.expectedOutcome.expectedScore.max}, action: ${result.scenario.expectedOutcome.expectedAction}`);
                lines.push(`- **Got:** score ${result.metrics.finalScore.toFixed(1)}`);
                if (result.errors.length > 0) {
                    lines.push(`- **Errors:** ${result.errors.join(', ')}`);
                }
                lines.push('');
            }
        }
        
        return lines.join('\n');
    }
}
