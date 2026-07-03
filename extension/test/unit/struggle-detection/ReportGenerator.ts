/**
 * Comprehensive Report Generator — EQ-based
 *
 * Creates a detailed Markdown document after each test run.
 */

import * as fs from 'fs';

import { ScenarioResult, TestSuiteReport } from './types';

export class ReportGenerator {

    generateAndSave(report: TestSuiteReport, outputPath: string): void {
        const markdown = this.generateFullReport(report);
        fs.writeFileSync(outputPath, markdown, 'utf-8');
        console.log(`\n📄 Full report saved to: ${outputPath}`);
    }

    generateFullReport(report: TestSuiteReport): string {
        const sections: string[] = [];

        sections.push(this.generateHeader(report));
        sections.push(this.generateExecutiveSummary(report));
        sections.push(this.generateMethodologySection());
        sections.push(this.generateMetricsExplanation(report));
        sections.push(this.generateConfusionMatrixSection(report));
        sections.push(this.generateResultsByCategory(report));
        sections.push(this.generateDetailedScenarioResults(report));
        sections.push(this.generateRecommendations(report));
        sections.push(this.generateAppendix(report));

        return sections.join('\n\n---\n\n');
    }

    private generateHeader(report: TestSuiteReport): string {
        const passRate = (report.passed / report.totalScenarios * 100).toFixed(1);
        const statusEmoji = report.passed === report.totalScenarios ? '✅' :
                           report.passed >= report.totalScenarios * 0.8 ? '🟡' : '🔴';

        return `# Struggle Detection Algorithm (EQ) - Test Report

> **Generated:** ${report.timestamp.toISOString()}
> **Duration:** ${(report.duration / 1000).toFixed(2)} seconds
> **Status:** ${statusEmoji} ${passRate}% Pass Rate (${report.passed}/${report.totalScenarios} scenarios)

This document provides a comprehensive analysis of the EQ-based struggle detection algorithm's performance.`;
    }

    private generateExecutiveSummary(report: TestSuiteReport): string {
        const { precision, recall, f1Score, accuracy } = report;

        let assessment = '';
        if (precision === 1 && recall < 0.7) {
            assessment = '**Assessment:** The algorithm is **too conservative**. It rarely triggers false alarms but misses many real struggles. Consider lowering EQ thresholds.';
        } else if (precision < 0.8 && recall > 0.8) {
            assessment = '**Assessment:** The algorithm is **too aggressive**. It catches most struggles but also triggers false alarms. Consider raising EQ thresholds.';
        } else if (f1Score >= 0.8) {
            assessment = '**Assessment:** The algorithm is **well-balanced**.';
        } else {
            assessment = '**Assessment:** The algorithm needs improvement.';
        }

        return `## Executive Summary

### Key Metrics at a Glance

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| **Precision** | ${(precision * 100).toFixed(1)}% | > 85% | ${precision >= 0.85 ? '✅' : '⚠️'} |
| **Recall** | ${(recall * 100).toFixed(1)}% | > 70% | ${recall >= 0.70 ? '✅' : '⚠️'} |
| **F1 Score** | ${(f1Score * 100).toFixed(1)}% | > 75% | ${f1Score >= 0.75 ? '✅' : '⚠️'} |
| **Accuracy** | ${(accuracy * 100).toFixed(1)}% | > 80% | ${accuracy >= 0.80 ? '✅' : '⚠️'} |

${assessment}`;
    }

    private generateMethodologySection(): string {
        return `## Methodology

### What is Struggle Detection?

The algorithm monitors student behaviour during programming exercises to identify when they might be stuck.

### How the Algorithm Works (EQ System)

The **Error Quotient (EQ)** scores consecutive pairs of compile-equivalent events using the Jadud 2006 formula:

| Factor | Score | Description |
|--------|-------|-------------|
| **Both events have errors** | +8 | Both snapshots contain compiler errors |
| **Same error family** | +3 | The same error type appears in both |
| **Max per pair** | 11 | Normalized to 0.0-1.0 |

EQ = mean(pair_scores) / 11. Range: 0.0 (no struggle) to 1.0 (maximum struggle).

### EQ Thresholds

| EQ Range | Classification | Recommended Action |
|----------|----------------|-------------------|
| < 0.15 | No struggle | None |
| 0.15-0.34 | Mild struggle | Subtle hint |
| 0.35-0.59 | Moderate struggle | Notification |
| 0.60-1.0 | Severe struggle | Proactive intervention |

### How We Test

Each **scenario** simulates events (edits, saves, diagnostics, builds, time):
1. **Save events** create ErrorSnapshots from active diagnostics → fed to EQ engine
2. **Build events** create ErrorSnapshots from build classification → fed to EQ engine
3. The **final EQ** is compared against expected ranges
4. Results are aggregated into precision/recall metrics`;
    }

    private generateMetricsExplanation(report: TestSuiteReport): string {
        const { truePositive, trueNegative, falsePositive, falseNegative } = report.confusionMatrix;

        return `## Understanding the Results

### The Confusion Matrix

\`\`\`
                        ALGORITHM PREDICTION
                    ┌─────────────┬─────────────┐
                    │  Struggle   │  No Struggle │
        ┌───────────┼─────────────┼─────────────┤
ACTUAL  │ Struggle  │ TP: ${String(truePositive).padStart(2)}      │ FN: ${String(falseNegative).padStart(2)}       │
REALITY │───────────┼─────────────┼─────────────│
        │No Struggle│ FP: ${String(falsePositive).padStart(2)}      │ TN: ${String(trueNegative).padStart(2)}       │
        └───────────┴─────────────┴─────────────┘
\`\`\`

| Cell | Count | Meaning |
|------|-------|---------|
| **True Positive (TP)** | ${truePositive} | Correctly detected struggle |
| **True Negative (TN)** | ${trueNegative} | Correctly detected no struggle |
| **False Positive (FP)** | ${falsePositive} | Wrongly detected struggle |
| **False Negative (FN)** | ${falseNegative} | Missed real struggle |`;
    }

    private generateConfusionMatrixSection(report: TestSuiteReport): string {
        const { precision, recall, f1Score, accuracy } = report;
        const { falsePositive, falseNegative } = report.confusionMatrix;

        return `## Detailed Metrics

### Classification Metrics

| Metric | Value | Interpretation |
|--------|-------|----------------|
| **Precision** | ${(precision * 100).toFixed(1)}% | ${precision === 1 ? 'No false alarms!' : `${falsePositive} false alarm(s)`} |
| **Recall** | ${(recall * 100).toFixed(1)}% | ${falseNegative === 0 ? 'Catches all struggles!' : `Misses ${falseNegative} struggle(s)`} |
| **F1 Score** | ${(f1Score * 100).toFixed(1)}% | ${f1Score >= 0.8 ? 'Well-balanced' : 'Imbalanced'} |
| **Accuracy** | ${(accuracy * 100).toFixed(1)}% | Overall correctness |

### By Difficulty Category

| Category | Passed | Failed | Avg EQ |
|----------|--------|--------|--------|
| **Obvious** | ${report.byDifficulty.obvious.passed}/${report.byDifficulty.obvious.total} | ${report.byDifficulty.obvious.failed} | ${report.byDifficulty.obvious.avgScore.toFixed(3)} |
| **Subtle** | ${report.byDifficulty.subtle.passed}/${report.byDifficulty.subtle.total} | ${report.byDifficulty.subtle.failed} | ${report.byDifficulty.subtle.avgScore.toFixed(3)} |
| **Edge-case** | ${report.byDifficulty['edge-case'].passed}/${report.byDifficulty['edge-case'].total} | ${report.byDifficulty['edge-case'].failed} | ${report.byDifficulty['edge-case'].avgScore.toFixed(3)} |`;
    }

    private generateResultsByCategory(report: TestSuiteReport): string {
        const obvious = report.results.filter(r => r.scenario.difficulty === 'obvious');
        const subtle = report.results.filter(r => r.scenario.difficulty === 'subtle');
        const edgeCases = report.results.filter(r => r.scenario.difficulty === 'edge-case');
        const noStruggle = report.results.filter(r => !r.scenario.expectedOutcome.shouldDetectStruggle);

        let section = `## Results by Category\n\n`;

        section += `### Obvious Struggle Scenarios\n\n`;
        section += this.formatCategoryTable(obvious);

        section += `\n### Subtle Struggle Scenarios\n\n`;
        section += this.formatCategoryTable(subtle);

        section += `\n### No-Struggle Scenarios\n\n`;
        section += this.formatCategoryTable(noStruggle);

        section += `\n### Edge Case Scenarios\n\n`;
        section += this.formatCategoryTable(edgeCases);

        return section;
    }

    private formatCategoryTable(results: ScenarioResult[]): string {
        if (results.length === 0) {
            return '*No scenarios in this category.*\n';
        }

        let table = `| Status | Scenario | Expected EQ | Actual EQ | Gap |\n`;
        table += `|--------|----------|-------------|-----------|-----|\n`;

        for (const result of results) {
            const status = result.passed ? '✅' : '❌';
            const expected = `${result.scenario.expectedOutcome.expectedEQ.min}-${result.scenario.expectedOutcome.expectedEQ.max}`;
            const actual = result.metrics.finalScore.toFixed(3);
            const gap = result.passed ? '-' :
                       result.metrics.finalScore < result.scenario.expectedOutcome.expectedEQ.min ?
                       `↓ ${(result.scenario.expectedOutcome.expectedEQ.min - result.metrics.finalScore).toFixed(3)}` :
                       `↑ ${(result.metrics.finalScore - result.scenario.expectedOutcome.expectedEQ.max).toFixed(3)}`;

            table += `| ${status} | ${result.scenario.name} | ${expected} | ${actual} | ${gap} |\n`;
        }

        return table;
    }

    private generateDetailedScenarioResults(report: TestSuiteReport): string {
        let section = `## Detailed Scenario Analysis\n\n`;

        for (const result of report.results) {
            section += this.formatScenarioDetail(result);
            section += '\n';
        }

        return section;
    }

    private formatScenarioDetail(result: ScenarioResult): string {
        const s = result.scenario;
        const m = result.metrics;
        const status = result.passed ? '✅ PASSED' : '❌ FAILED';

        let detail = `### ${status}: ${s.name}\n\n`;

        detail += `**ID:** \`${s.id}\`  \n`;
        detail += `**Difficulty:** ${s.difficulty}  \n`;
        detail += `**Tags:** ${s.tags.map(t => `\`${t}\``).join(', ') || '*none*'}  \n\n`;

        detail += `#### Expected vs Actual\n\n`;
        detail += `| Metric | Expected | Actual | Status |\n`;
        detail += `|--------|----------|--------|--------|\n`;
        detail += `| Should Detect Struggle | ${s.expectedOutcome.shouldDetectStruggle ? 'Yes' : 'No'} | ${m.detectedStruggle ? 'Yes' : 'No'} | ${m.detectedStruggle === s.expectedOutcome.shouldDetectStruggle ? '✅' : '❌'} |\n`;
        detail += `| EQ Range | ${s.expectedOutcome.expectedEQ.min}-${s.expectedOutcome.expectedEQ.max} | ${m.finalScore.toFixed(3)} | ${m.finalScoreInRange ? '✅' : '❌'} |\n`;
        const lastSnapshot = result.scoreTimeline[result.scoreTimeline.length - 1];
        detail += `| Recommended Action | ${s.expectedOutcome.expectedAction} | ${lastSnapshot?.recommendedAction ?? 'unknown'} | ${m.correctAction ? '✅' : '❌'} |\n`;

        detail += `\n#### EQ Statistics\n\n`;
        detail += `- **Min EQ:** ${m.minScore.toFixed(3)}\n`;
        detail += `- **Max EQ:** ${m.maxScore.toFixed(3)}\n`;
        detail += `- **Avg EQ:** ${m.avgScore.toFixed(3)}\n`;
        detail += `- **Final EQ:** ${m.finalScore.toFixed(3)}\n`;
        if (m.timeToDetection !== null) {
            detail += `- **Time to Detection:** ${(m.timeToDetection / 1000).toFixed(1)}s\n`;
        }

        detail += `\n#### Event Timeline\n\n`;
        detail += `| Time | Event | EQ | Confidence | Action |\n`;
        detail += `|------|-------|----|------------|--------|\n`;

        for (const snapshot of result.scoreTimeline.slice(0, 15)) {
            const timeStr = `${(snapshot.timestamp / 1000).toFixed(0)}s`;
            detail += `| ${timeStr} | ${snapshot.eventType} | ${snapshot.eq.toFixed(3)} | ${snapshot.confidence} | ${snapshot.recommendedAction} |\n`;
        }

        if (result.scoreTimeline.length > 15) {
            detail += `| ... | *${result.scoreTimeline.length - 15} more events* | ... | ... | ... |\n`;
        }

        if (result.errors.length > 0) {
            detail += `\n#### Errors\n\n`;
            for (const error of result.errors) {
                detail += `- ${error}\n`;
            }
        }

        return detail;
    }

    private generateRecommendations(report: TestSuiteReport): string {
        const recommendations: string[] = [];
        const { precision, recall } = report;
        const { falsePositive, falseNegative } = report.confusionMatrix;

        if (precision === 1 && recall < 0.7) {
            recommendations.push(`### Increase Sensitivity\nPerfect precision but low recall (misses ${falseNegative} struggles). Consider lowering EQ thresholds.`);
        }

        if (falsePositive > 0) {
            recommendations.push(`### Reduce False Positives\n${falsePositive} false alarm(s). Consider raising EQ thresholds or requiring higher confidence.`);
        }

        if (recommendations.length === 0) {
            recommendations.push(`### Algorithm Performance is Good\nAll key metrics are within acceptable ranges.`);
        }

        return `## Recommendations\n\n${recommendations.join('\n\n')}`;
    }

    private generateAppendix(report: TestSuiteReport): string {
        return `## Appendix

### How to Run These Tests

\`\`\`bash
cd extension
npm run test:struggle
\`\`\`

### Test Framework Architecture (EQ)

\`\`\`
StruggleTestRunner
    │
    ├── Sinon.js Fake Timers (time control)
    │
    ├── ErrorQuotientEngine (real, not mocked)
    │
    ├── Active Diagnostics State (simulated)
    │
    └── ScenarioLoader (JSON → Events)
            │
            └── EvaluationEngine (Results → Metrics)
\`\`\`

---

*Report generated at ${report.timestamp.toISOString()}*`;
    }
}
