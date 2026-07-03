# Struggle Detection Test Framework

A scenario-based testing framework for evaluating the struggle detection algorithm.

## Overview

This framework allows you to:
- Define student behavior scenarios in JSON files
- Simulate events (diagnostics, edits, builds, time passage)
- Measure detection accuracy with precision/recall metrics
- Get detailed reports with confusion matrix

## Quick Start

```bash
# Run all struggle detection tests
npm run pretest && npm test

# Or run only the struggle detection suite
npm run pretest && npx vscode-test --label unit --grep "Struggle Detection"
```

## Architecture

```
test/struggle-detection/
├── types.ts              # TypeScript interfaces
├── StruggleTestRunner.ts # Main test runner (uses real services!)
├── ScenarioLoader.ts     # Loads JSON scenarios
├── EvaluationEngine.ts   # Calculates metrics
├── struggleDetection.test.ts  # Mocha test entry point
├── index.ts              # Exports
└── scenarios/            # Scenario definitions
    ├── obvious/          # Should always detect struggle
    ├── subtle/           # Should detect struggle
    ├── no-struggle/      # Should NOT detect struggle
    └── edge-cases/       # Tricky scenarios
```

## How It Works

1. **Sinon.js Fake Timers** - We fake `Date.now()` and `setInterval` BEFORE creating services
2. **Real Services** - DiagnosticPersistenceService, InactivityService, BuildResultTracker, StruggleScoreService are all REAL
3. **Event Simulation** - We trigger VS Code events to feed data to services
4. **Time Control** - `clock.tick(300000)` advances time by 5 minutes instantly
5. **Score Recording** - We record the score after each event

## Creating Scenarios

Scenarios are JSON files with this structure:

```json
{
    "id": "my-scenario",
    "name": "Human Readable Name",
    "description": "What this tests",
    "difficulty": "obvious",
    "tags": ["tag1", "tag2"],
    
    "expectedOutcome": {
        "shouldDetectStruggle": true,
        "expectedScore": { "min": 60, "max": 90 },
        "expectedAction": "notification"
    },
    
    "events": [
        { "type": "edit", "timestamp": 0, "file": "Main.java", "content": "..." },
        { "type": "diagnostic", "timestamp": 100, "action": "add", "diagnostics": [...] },
        { "type": "wait", "duration": 120000 },
        { "type": "build", "timestamp": 120000, "success": false, "errors": [...] }
    ]
}
```

### Event Types

| Type | Description | Key Fields |
|------|-------------|------------|
| `edit` | Simulates typing | `file`, `content` |
| `diagnostic` | Add/remove VS Code diagnostics | `action`, `diagnostics[]` |
| `build` | Artemis build result | `success`, `errors`, `failedTests` |
| `wait` | Advance time | `duration` (ms) |

## Metrics

The framework calculates:

- **Confusion Matrix**: TP, TN, FP, FN
- **Precision**: TP / (TP + FP) - "When we detect struggle, how often is it real?"
- **Recall**: TP / (TP + FN) - "How much of the real struggle do we catch?"
- **F1 Score**: Harmonic mean of precision and recall
- **Time to Detection**: How long until struggle is detected

## Adding New Scenarios

1. Create a JSON file in the appropriate category folder
2. Define events that simulate the behavior
3. Set `expectedOutcome` with your expectations
4. Run tests to verify

## Inline Scenarios

For quick testing, you can define scenarios directly in code:

```typescript
const scenario = createScenario({
    id: 'inline-test',
    name: 'Quick Test',
    events: [
        { type: 'diagnostic', timestamp: 0, action: 'add', diagnostics: [...] },
        { type: 'wait', duration: 180000 },
    ],
    expectedOutcome: {
        shouldDetectStruggle: true,
        expectedScore: { min: 50, max: 100 },
        expectedAction: 'notification',
    },
});

const result = await runner.runScenario(scenario);
```

## Interpreting Results

```
╔══════════════════════════════════════════════════════════════╗
║           STRUGGLE DETECTION TEST REPORT                     ║
╠══════════════════════════════════════════════════════════════╣
║ Total:     10     Passed: 8      Failed: 2                   ║
╠══════════════════════════════════════════════════════════════╣
║ CONFUSION MATRIX                                             ║
║                    │ Predicted Struggle │ Predicted OK       ║
║ Actual Struggle    │ TP: 5              │ FN: 1              ║
║ Actual OK          │ FP: 1              │ TN: 3              ║
╠══════════════════════════════════════════════════════════════╣
║ Precision: 83.3%    Recall: 83.3%                            ║
║ F1 Score:  83.3%    Accuracy: 80.0%                          ║
╚══════════════════════════════════════════════════════════════╝
```

- **High FP (False Positives)**: Algorithm too aggressive, annoying users
- **High FN (False Negatives)**: Algorithm too passive, missing struggles
- **Target**: F1 Score > 80%, Precision > 85% (avoid annoying users)
