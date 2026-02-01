/**
 * Scenario Loader
 * 
 * Loads scenario definitions from YAML files and validates them.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
    StruggleScenario,
    ScenarioEvent,
    ExpectedOutcome,
    DiagnosticEvent,
    EditEvent,
    BuildResultEvent,
    WaitEvent,
} from './types';

/**
 * Loads and parses YAML scenario files
 * 
 * Note: We use a simple custom parser instead of js-yaml to avoid
 * adding another dependency. For complex scenarios, consider adding js-yaml.
 */
export class ScenarioLoader {
    private scenariosDir: string;
    
    constructor(scenariosDir: string) {
        this.scenariosDir = scenariosDir;
    }
    
    /**
     * Load all scenarios from the scenarios directory
     */
    async loadAllScenarios(): Promise<StruggleScenario[]> {
        const scenarios: StruggleScenario[] = [];
        
        // Get all subdirectories (obvious, subtle, no-struggle, edge-cases)
        const categories = ['obvious', 'subtle', 'no-struggle', 'edge-cases'];
        
        for (const category of categories) {
            const categoryPath = path.join(this.scenariosDir, category);
            
            if (!fs.existsSync(categoryPath)) {
                continue;
            }
            
            const files = fs.readdirSync(categoryPath)
                .filter(f => f.endsWith('.json'));
            
            for (const file of files) {
                const filePath = path.join(categoryPath, file);
                const scenario = await this.loadScenario(filePath);
                if (scenario) {
                    scenarios.push(scenario);
                }
            }
        }
        
        return scenarios;
    }
    
    /**
     * Load scenarios by category
     */
    async loadByCategory(category: 'obvious' | 'subtle' | 'no-struggle' | 'edge-cases'): Promise<StruggleScenario[]> {
        const categoryPath = path.join(this.scenariosDir, category);
        
        if (!fs.existsSync(categoryPath)) {
            return [];
        }
        
        const files = fs.readdirSync(categoryPath)
            .filter(f => f.endsWith('.json'));
        
        const scenarios: StruggleScenario[] = [];
        
        for (const file of files) {
            const filePath = path.join(categoryPath, file);
            const scenario = await this.loadScenario(filePath);
            if (scenario) {
                scenarios.push(scenario);
            }
        }
        
        return scenarios;
    }
    
    /**
     * Load a single scenario from a JSON file
     */
    async loadScenario(filePath: string): Promise<StruggleScenario | null> {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const raw = JSON.parse(content);
            
            const scenario = this.parseScenario(raw);
            this.validateScenario(scenario);
            
            return scenario;
        } catch (err) {
            console.error(`Failed to load scenario from ${filePath}:`, err);
            return null;
        }
    }
    
    /**
     * Parse raw JSON into typed scenario
     */
    private parseScenario(raw: unknown): StruggleScenario {
        const obj = raw as Record<string, unknown>;
        
        return {
            id: String(obj.id ?? ''),
            name: String(obj.name ?? ''),
            description: String(obj.description ?? ''),
            expectedOutcome: this.parseExpectedOutcome(obj.expectedOutcome),
            events: this.parseEvents(obj.events as unknown[]),
            tags: Array.isArray(obj.tags) ? obj.tags.map(String) : [],
            difficulty: this.parseDifficulty(obj.difficulty),
        };
    }
    
    /**
     * Parse expected outcome
     */
    private parseExpectedOutcome(raw: unknown): ExpectedOutcome {
        const obj = raw as Record<string, unknown> ?? {};
        const scoreObj = obj.expectedScore as Record<string, number> ?? {};
        
        return {
            shouldDetectStruggle: Boolean(obj.shouldDetectStruggle),
            expectedScore: {
                min: Number(scoreObj.min ?? 0),
                max: Number(scoreObj.max ?? 100),
            },
            expectedAction: this.parseAction(obj.expectedAction),
            expectedTimeToDetection: obj.expectedTimeToDetection 
                ? Number(obj.expectedTimeToDetection) 
                : undefined,
        };
    }
    
    /**
     * Parse events array
     */
    private parseEvents(raw: unknown[]): ScenarioEvent[] {
        if (!Array.isArray(raw)) {
            return [];
        }
        
        return raw.map(e => this.parseEvent(e)).filter((e): e is ScenarioEvent => e !== null);
    }
    
    /**
     * Parse a single event
     */
    private parseEvent(raw: unknown): ScenarioEvent | null {
        const obj = raw as Record<string, unknown>;
        const type = String(obj.type ?? '');
        
        switch (type) {
            case 'diagnostic':
                return this.parseDiagnosticEvent(obj);
            case 'edit':
                return this.parseEditEvent(obj);
            case 'build':
                return this.parseBuildEvent(obj);
            case 'wait':
                return this.parseWaitEvent(obj);
            default:
                console.warn(`Unknown event type: ${type}`);
                return null;
        }
    }
    
    private parseDiagnosticEvent(obj: Record<string, unknown>): DiagnosticEvent {
        const diagnosticsRaw = obj.diagnostics as unknown[];
        
        return {
            type: 'diagnostic',
            timestamp: Number(obj.timestamp ?? 0),
            action: this.parseDiagnosticAction(obj.action),
            diagnostics: Array.isArray(diagnosticsRaw)
                ? diagnosticsRaw.map(d => {
                    const diag = d as Record<string, unknown>;
                    return {
                        file: String(diag.file ?? 'test.java'),
                        line: Number(diag.line ?? 0),
                        severity: diag.severity === 'warning' ? 'warning' as const : 'error' as const,
                        code: String(diag.code ?? ''),
                        message: String(diag.message ?? ''),
                    };
                })
                : undefined,
        };
    }
    
    private parseEditEvent(obj: Record<string, unknown>): EditEvent {
        return {
            type: 'edit',
            timestamp: Number(obj.timestamp ?? 0),
            file: String(obj.file ?? 'test.java'),
            content: String(obj.content ?? ''),
        };
    }
    
    private parseBuildEvent(obj: Record<string, unknown>): BuildResultEvent {
        return {
            type: 'build',
            timestamp: Number(obj.timestamp ?? 0),
            success: Boolean(obj.success),
            errors: Array.isArray(obj.errors) ? obj.errors.map(String) : undefined,
            failedTests: Array.isArray(obj.failedTests) ? obj.failedTests.map(String) : undefined,
        };
    }
    
    private parseWaitEvent(obj: Record<string, unknown>): WaitEvent {
        return {
            type: 'wait',
            duration: Number(obj.duration ?? 0),
        };
    }
    
    private parseDiagnosticAction(raw: unknown): 'add' | 'remove' | 'clear' {
        const action = String(raw ?? 'add');
        if (action === 'remove' || action === 'clear') {
            return action;
        }
        return 'add';
    }
    
    private parseAction(raw: unknown): 'none' | 'subtle' | 'notification' | 'proactive' {
        const action = String(raw ?? 'none');
        if (action === 'subtle' || action === 'notification' || action === 'proactive') {
            return action;
        }
        return 'none';
    }
    
    private parseDifficulty(raw: unknown): 'obvious' | 'subtle' | 'edge-case' {
        const difficulty = String(raw ?? 'obvious');
        if (difficulty === 'subtle' || difficulty === 'edge-case') {
            return difficulty;
        }
        return 'obvious';
    }
    
    /**
     * Validate scenario structure
     */
    private validateScenario(scenario: StruggleScenario): void {
        if (!scenario.id) {
            throw new Error('Scenario must have an id');
        }
        if (!scenario.name) {
            throw new Error('Scenario must have a name');
        }
        if (scenario.events.length === 0) {
            throw new Error('Scenario must have at least one event');
        }
    }
}

/**
 * Create a scenario programmatically (for inline test definitions)
 */
export function createScenario(partial: Partial<StruggleScenario> & {
    id: string;
    name: string;
    events: ScenarioEvent[];
    expectedOutcome: ExpectedOutcome;
}): StruggleScenario {
    return {
        description: '',
        tags: [],
        difficulty: 'obvious',
        ...partial,
    };
}
