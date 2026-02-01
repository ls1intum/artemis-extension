/**
 * Comprehensive Report Generator
 * 
 * Creates a detailed Markdown document after each test run that:
 * - Explains the framework and methodology
 * - Documents all scenarios and their purpose
 * - Shows detailed results with interpretation
 * - Is self-explanatory for newcomers
 */

import * as fs from 'fs';
import * as path from 'path';
import { TestSuiteReport, ScenarioResult, StruggleScenario } from './types';

export class ReportGenerator {
    
    /**
     * Generate a comprehensive report and save to file
     */
    generateAndSave(report: TestSuiteReport, outputPath: string): void {
        const markdown = this.generateFullReport(report);
        fs.writeFileSync(outputPath, markdown, 'utf-8');
        console.log(`\n📄 Full report saved to: ${outputPath}`);
    }
    
    /**
     * Generate the complete Markdown report
     */
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
        
        return `# Struggle Detection Algorithm - Test Report

> **Generated:** ${report.timestamp.toISOString()}  
> **Duration:** ${(report.duration / 1000).toFixed(2)} seconds  
> **Status:** ${statusEmoji} ${passRate}% Pass Rate (${report.passed}/${report.totalScenarios} scenarios)

This document provides a comprehensive analysis of the struggle detection algorithm's performance.
It is designed to be self-explanatory for anyone reviewing the test results.`;
    }
    
    private generateExecutiveSummary(report: TestSuiteReport): string {
        const passRate = report.passed / report.totalScenarios;
        const { precision, recall, f1Score, accuracy } = report;
        
        let assessment = '';
        if (precision === 1 && recall < 0.7) {
            assessment = '**Assessment:** The algorithm is **too conservative**. It rarely triggers false alarms (good!), but misses many real struggles (bad). Consider lowering thresholds or increasing signal weights.';
        } else if (precision < 0.8 && recall > 0.8) {
            assessment = '**Assessment:** The algorithm is **too aggressive**. It catches most struggles (good!), but also triggers many false alarms (bad). Consider raising thresholds.';
        } else if (f1Score >= 0.8) {
            assessment = '**Assessment:** The algorithm is **well-balanced**. It achieves a good trade-off between catching struggles and avoiding false alarms.';
        } else {
            assessment = '**Assessment:** The algorithm needs improvement. Review the failed scenarios below for specific issues.';
        }
        
        return `## Executive Summary

### Key Metrics at a Glance

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| **Precision** | ${(precision * 100).toFixed(1)}% | > 85% | ${precision >= 0.85 ? '✅' : '⚠️'} |
| **Recall** | ${(recall * 100).toFixed(1)}% | > 70% | ${recall >= 0.70 ? '✅' : '⚠️'} |
| **F1 Score** | ${(f1Score * 100).toFixed(1)}% | > 75% | ${f1Score >= 0.75 ? '✅' : '⚠️'} |
| **Accuracy** | ${(accuracy * 100).toFixed(1)}% | > 80% | ${accuracy >= 0.80 ? '✅' : '⚠️'} |
| **False Positives** | ${report.confusionMatrix.falsePositive} | 0 | ${report.confusionMatrix.falsePositive === 0 ? '✅' : '❌'} |
| **False Negatives** | ${report.confusionMatrix.falseNegative} | 0 | ${report.confusionMatrix.falseNegative === 0 ? '✅' : '⚠️'} |

${assessment}

### What These Metrics Mean

- **Precision (${(precision * 100).toFixed(1)}%)**: When the algorithm detects struggle, it is correct ${(precision * 100).toFixed(0)}% of the time.
- **Recall (${(recall * 100).toFixed(1)}%)**: The algorithm catches ${(recall * 100).toFixed(0)}% of all actual struggles.
- **F1 Score (${(f1Score * 100).toFixed(1)}%)**: The harmonic mean of precision and recall - our primary success metric.`;
    }
    
    private generateMethodologySection(): string {
        return `## Methodology

### What is Struggle Detection?

Struggle detection is an algorithm that monitors student behavior during programming exercises to identify when they might be stuck or confused. The goal is to offer timely assistance (like hints from Iris, the AI tutor) before frustration sets in.

### How the Algorithm Works

The algorithm combines multiple **signals** to calculate a **struggle score** (0-100):

| Signal | Weight | Description |
|--------|--------|-------------|
| **Persistent Errors** | ~35% | Compiler/linter errors that remain unfixed for extended periods |
| **Inactivity Pattern** | ~25% | Time without code edits, classified as: active → thinking → confusion → giving-up |
| **Thrashing** | ~15% | Repeated similar edits without progress (undo/redo cycles) |
| **Build Failures** | ~25% | Consecutive failed build/submission attempts |

### Score Thresholds

| Score Range | Classification | Recommended Action |
|-------------|----------------|-------------------|
| 0-34 | No struggle | None |
| 35-54 | Mild struggle | Subtle hint (icon change) |
| 55-74 | Moderate struggle | Notification offer |
| 75-100 | Severe struggle | Proactive intervention |

### How We Test

Each **scenario** simulates a specific student behavior pattern:

1. **Events** are fed to the real algorithm (edits, errors, builds, time passing)
2. The **struggle score** is recorded after each event
3. The **final score** is compared against expected ranges
4. Results are aggregated into precision/recall metrics

**Key Principle:** We use the **real algorithm code** (not mocks). Time is simulated via Sinon.js fake timers, allowing us to test 5-minute scenarios in milliseconds.`;
    }
    
    private generateMetricsExplanation(report: TestSuiteReport): string {
        const { truePositive, trueNegative, falsePositive, falseNegative } = report.confusionMatrix;
        
        return `## Understanding the Results

### The Confusion Matrix

A confusion matrix shows how the algorithm's predictions compare to reality:

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

### What Each Cell Means

| Cell | Count | Meaning | Impact |
|------|-------|---------|--------|
| **True Positive (TP)** | ${truePositive} | Correctly detected struggle | ✅ Student gets help when needed |
| **True Negative (TN)** | ${trueNegative} | Correctly detected no struggle | ✅ Student not interrupted unnecessarily |
| **False Positive (FP)** | ${falsePositive} | Wrongly detected struggle | ❌ Student interrupted when working fine (annoying!) |
| **False Negative (FN)** | ${falseNegative} | Missed real struggle | ⚠️ Student left struggling without help |

### Why Precision Matters More Than Recall

For a tutoring system, **false positives are worse than false negatives**:

- A false positive interrupts a student who is doing fine → annoying, reduces trust
- A false negative leaves a struggling student without help → bad, but student can still ask for help

**Target:** Precision > 85%, Recall > 70%`;
    }
    
    private generateConfusionMatrixSection(report: TestSuiteReport): string {
        const { precision, recall, f1Score, accuracy } = report;
        const { truePositive, trueNegative, falsePositive, falseNegative } = report.confusionMatrix;
        
        return `## Detailed Metrics

### Classification Metrics

| Metric | Formula | Value | Interpretation |
|--------|---------|-------|----------------|
| **Precision** | TP / (TP + FP) | ${(precision * 100).toFixed(1)}% | ${precision >= 0.9 ? 'Excellent' : precision >= 0.8 ? 'Good' : precision >= 0.7 ? 'Acceptable' : 'Needs improvement'} - ${precision === 1 ? 'No false alarms!' : `${falsePositive} false alarm(s)`} |
| **Recall** | TP / (TP + FN) | ${(recall * 100).toFixed(1)}% | ${recall >= 0.9 ? 'Excellent' : recall >= 0.8 ? 'Good' : recall >= 0.7 ? 'Acceptable' : 'Needs improvement'} - ${falseNegative === 0 ? 'Catches all struggles!' : `Misses ${falseNegative} struggle(s)`} |
| **F1 Score** | 2 × (P × R) / (P + R) | ${(f1Score * 100).toFixed(1)}% | ${f1Score >= 0.8 ? 'Well-balanced' : 'Imbalanced precision/recall'} |
| **Accuracy** | (TP + TN) / Total | ${(accuracy * 100).toFixed(1)}% | Overall correctness |

### By Difficulty Category

| Category | Purpose | Passed | Failed | Avg Score |
|----------|---------|--------|--------|-----------|
| **Obvious** | Must always be detected | ${report.byDifficulty.obvious.passed}/${report.byDifficulty.obvious.total} | ${report.byDifficulty.obvious.failed} | ${report.byDifficulty.obvious.avgScore.toFixed(1)} |
| **Subtle** | Should be detected | ${report.byDifficulty.subtle.passed}/${report.byDifficulty.subtle.total} | ${report.byDifficulty.subtle.failed} | ${report.byDifficulty.subtle.avgScore.toFixed(1)} |
| **Edge-case** | Tricky scenarios | ${report.byDifficulty['edge-case'].passed}/${report.byDifficulty['edge-case'].total} | ${report.byDifficulty['edge-case'].failed} | ${report.byDifficulty['edge-case'].avgScore.toFixed(1)} |`;
    }
    
    private generateResultsByCategory(report: TestSuiteReport): string {
        const obvious = report.results.filter(r => r.scenario.difficulty === 'obvious');
        const subtle = report.results.filter(r => r.scenario.difficulty === 'subtle');
        const edgeCases = report.results.filter(r => r.scenario.difficulty === 'edge-case');
        const noStruggle = report.results.filter(r => !r.scenario.expectedOutcome.shouldDetectStruggle);
        
        let section = `## Results by Category\n\n`;
        
        // Obvious struggles
        section += `### 🔴 Obvious Struggle Scenarios\n\n`;
        section += `These scenarios represent clear cases where students are struggling. The algorithm **must** detect these.\n\n`;
        section += this.formatCategoryTable(obvious);
        
        // Subtle struggles
        section += `\n### 🟡 Subtle Struggle Scenarios\n\n`;
        section += `These scenarios represent less obvious struggles. The algorithm **should** detect these.\n\n`;
        section += this.formatCategoryTable(subtle);
        
        // No struggle
        section += `\n### 🟢 No-Struggle Scenarios (False Positive Prevention)\n\n`;
        section += `These scenarios represent normal development. The algorithm **must NOT** detect struggle.\n\n`;
        section += this.formatCategoryTable(noStruggle);
        
        // Edge cases
        section += `\n### ⚪ Edge Case Scenarios\n\n`;
        section += `These scenarios test tricky situations and boundary conditions.\n\n`;
        section += this.formatCategoryTable(edgeCases);
        
        return section;
    }
    
    private formatCategoryTable(results: ScenarioResult[]): string {
        if (results.length === 0) {
            return '*No scenarios in this category.*\n';
        }
        
        let table = `| Status | Scenario | Expected | Actual | Gap |\n`;
        table += `|--------|----------|----------|--------|-----|\n`;
        
        for (const result of results) {
            const status = result.passed ? '✅' : '❌';
            const expected = `${result.scenario.expectedOutcome.expectedScore.min}-${result.scenario.expectedOutcome.expectedScore.max}`;
            const actual = result.metrics.finalScore.toFixed(0);
            const gap = result.passed ? '-' : 
                       result.metrics.finalScore < result.scenario.expectedOutcome.expectedScore.min ?
                       `↓ ${(result.scenario.expectedOutcome.expectedScore.min - result.metrics.finalScore).toFixed(0)}` :
                       `↑ ${(result.metrics.finalScore - result.scenario.expectedOutcome.expectedScore.max).toFixed(0)}`;
            
            table += `| ${status} | ${result.scenario.name} | ${expected} | ${actual} | ${gap} |\n`;
        }
        
        return table;
    }
    
    private generateDetailedScenarioResults(report: TestSuiteReport): string {
        let section = `## Detailed Scenario Analysis\n\n`;
        section += `This section provides detailed information about each scenario and its results.\n\n`;
        
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
        
        // Description
        detail += `**ID:** \`${s.id}\`  \n`;
        detail += `**Difficulty:** ${s.difficulty}  \n`;
        detail += `**Tags:** ${s.tags.map(t => `\`${t}\``).join(', ') || '*none*'}  \n\n`;
        
        detail += `**Description:**  \n${s.description || '*No description provided.*'}\n\n`;
        
        // Expected vs Actual
        detail += `#### Expected vs Actual\n\n`;
        detail += `| Metric | Expected | Actual | Status |\n`;
        detail += `|--------|----------|--------|--------|\n`;
        detail += `| Should Detect Struggle | ${s.expectedOutcome.shouldDetectStruggle ? 'Yes' : 'No'} | ${m.detectedStruggle ? 'Yes' : 'No'} | ${m.detectedStruggle === s.expectedOutcome.shouldDetectStruggle ? '✅' : '❌'} |\n`;
        detail += `| Score Range | ${s.expectedOutcome.expectedScore.min}-${s.expectedOutcome.expectedScore.max} | ${m.finalScore.toFixed(1)} | ${m.finalScoreInRange ? '✅' : '❌'} |\n`;
        detail += `| Recommended Action | ${s.expectedOutcome.expectedAction} | ${result.scoreTimeline[result.scoreTimeline.length - 1]?.score.recommendedAction ?? 'unknown'} | ${m.correctAction ? '✅' : '❌'} |\n`;
        
        // Score statistics
        detail += `\n#### Score Statistics\n\n`;
        detail += `- **Min Score:** ${m.minScore.toFixed(1)}\n`;
        detail += `- **Max Score:** ${m.maxScore.toFixed(1)}\n`;
        detail += `- **Avg Score:** ${m.avgScore.toFixed(1)}\n`;
        detail += `- **Final Score:** ${m.finalScore.toFixed(1)}\n`;
        if (m.timeToDetection !== null) {
            detail += `- **Time to Detection:** ${(m.timeToDetection / 1000).toFixed(1)}s\n`;
        }
        
        // Event timeline
        detail += `\n#### Event Timeline\n\n`;
        detail += `| Time | Event | Score | Pattern |\n`;
        detail += `|------|-------|-------|----------|\n`;
        
        for (const snapshot of result.scoreTimeline.slice(0, 15)) { // Limit to first 15
            const timeStr = `${(snapshot.timestamp / 1000).toFixed(0)}s`;
            const pattern = snapshot.score.local?.inactivityPattern ?? '-';
            detail += `| ${timeStr} | ${snapshot.eventType} | ${snapshot.score.combined.toFixed(0)} | ${pattern} |\n`;
        }
        
        if (result.scoreTimeline.length > 15) {
            detail += `| ... | *${result.scoreTimeline.length - 15} more events* | ... | ... |\n`;
        }
        
        // Errors
        if (result.errors.length > 0) {
            detail += `\n#### Errors\n\n`;
            for (const error of result.errors) {
                detail += `- ⚠️ ${error}\n`;
            }
        }
        
        return detail;
    }
    
    private generateRecommendations(report: TestSuiteReport): string {
        const recommendations: string[] = [];
        const { precision, recall } = report;
        const { falsePositive, falseNegative } = report.confusionMatrix;
        
        // Analyze patterns
        const failedObvious = report.results.filter(r => 
            r.scenario.difficulty === 'obvious' && !r.passed
        );
        const failedSubtle = report.results.filter(r => 
            r.scenario.difficulty === 'subtle' && !r.passed
        );
        
        // Generate recommendations
        if (precision === 1 && recall < 0.7) {
            recommendations.push(`
### 🎯 Increase Sensitivity

The algorithm has **perfect precision** (no false positives) but **low recall** (misses ${falseNegative} struggles).

**Suggested actions:**
1. Lower the struggle detection threshold from 35 to 30
2. Increase weights for persistent errors and build failures
3. Make inactivity classification more aggressive (shorter time to "confusion")`);
        }
        
        if (falsePositive > 0) {
            recommendations.push(`
### ⚠️ Reduce False Positives

The algorithm triggered ${falsePositive} false alarm(s). This will annoy students.

**Suggested actions:**
1. Raise the struggle detection threshold
2. Require multiple signals before triggering
3. Add a "cooldown" period after recent activity`);
        }
        
        if (failedObvious.length > 0) {
            const avgScore = failedObvious.reduce((sum, r) => sum + r.metrics.finalScore, 0) / failedObvious.length;
            recommendations.push(`
### 🔴 Fix Obvious Struggle Detection

${failedObvious.length} obvious struggle scenarios failed. Average score: ${avgScore.toFixed(1)} (needs ~60+).

**Failed scenarios:**
${failedObvious.map(r => `- ${r.scenario.name}: score ${r.metrics.finalScore.toFixed(0)}`).join('\n')}

**Suggested actions:**
1. Increase the weight of persistent errors
2. Make the inactivity signal contribute more after 2+ minutes
3. Ensure consecutive build failures compound quickly`);
        }
        
        if (failedSubtle.length > 0 && failedObvious.length === 0) {
            recommendations.push(`
### 🟡 Improve Subtle Struggle Detection

Obvious struggles are detected, but ${failedSubtle.length} subtle scenarios failed.

**Suggested actions:**
1. Fine-tune thrashing detection sensitivity
2. Consider adding pattern combinations (e.g., slow progress + errors)`);
        }
        
        if (recommendations.length === 0) {
            recommendations.push(`
### ✅ Algorithm Performance is Good

All key metrics are within acceptable ranges. Consider:
1. Adding more edge case scenarios
2. Testing with real student data
3. A/B testing different threshold configurations`);
        }
        
        return `## Recommendations\n\nBased on the test results, here are specific suggestions for improvement:\n${recommendations.join('\n')}`;
    }
    
    private generateAppendix(report: TestSuiteReport): string {
        return `## Appendix

### A. How to Run These Tests

\`\`\`bash
cd iris-thaumantias
npm run test:struggle
\`\`\`

### B. How to Add New Scenarios

1. Create a JSON file in \`test/struggle-detection/scenarios/<category>/\`
2. Follow this structure:

\`\`\`json
{
    "id": "unique-id",
    "name": "Human Readable Name",
    "description": "What this scenario tests",
    "difficulty": "obvious|subtle|edge-case",
    "tags": ["tag1", "tag2"],
    "expectedOutcome": {
        "shouldDetectStruggle": true,
        "expectedScore": { "min": 50, "max": 80 },
        "expectedAction": "notification"
    },
    "events": [
        { "type": "edit", "timestamp": 0, "file": "Main.java", "content": "..." },
        { "type": "diagnostic", "timestamp": 100, "action": "add", "diagnostics": [...] },
        { "type": "wait", "duration": 60000 },
        { "type": "build", "timestamp": 60000, "success": false, "errors": [...] }
    ]
}
\`\`\`

### C. Understanding Event Types

| Event Type | Purpose | Key Fields |
|------------|---------|------------|
| \`edit\` | Simulate typing/code changes | \`file\`, \`content\` |
| \`diagnostic\` | Add/remove compiler errors | \`action\`, \`diagnostics[]\` |
| \`build\` | Simulate Artemis build result | \`success\`, \`errors\`, \`failedTests\` |
| \`wait\` | Advance simulated time | \`duration\` (milliseconds) |

### D. Test Framework Architecture

\`\`\`
StruggleTestRunner
    │
    ├── Sinon.js Fake Timers (time control)
    │
    ├── REAL Services (not mocked!)
    │   ├── DiagnosticPersistenceService
    │   ├── InactivityService
    │   ├── ThrashingDetector
    │   ├── BuildResultTracker
    │   └── StruggleScoreService
    │
    └── ScenarioLoader (JSON → Events)
            │
            └── EvaluationEngine (Results → Metrics)
\`\`\`

### E. Report Generation

This report was automatically generated by the test framework.
Location: \`test/struggle-detection/reports/\`

---

*Report generated at ${report.timestamp.toISOString()}*`;
    }
}
