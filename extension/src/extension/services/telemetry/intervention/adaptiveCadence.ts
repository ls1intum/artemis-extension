import {
    AdaptiveState,
    DEFAULT_TRIGGER_CONFIG,
    SessionResettable,
    SessionStartContext,
    TriggerConfig,
    TriggerType,
} from '@extension/services/telemetry/types';

/**
 * Adaptive Cadence: escalating thresholds for idle/selection triggers.
 *
 * Paper reference: Pu et al. (2025). "Assistance or Disruption?" CHI '25. [P11, Section 4]
 *   - Idle: 30s initial, +30s per ignore, cap at 180s
 *   - Selection: 15s initial, +15s per ignore, cap at 120s
 */
export class AdaptiveCadence implements SessionResettable {
    private readonly _config: TriggerConfig;
    private _state: AdaptiveState;

    constructor(config: TriggerConfig = DEFAULT_TRIGGER_CONFIG) {
        this._config = config;
        this._state = {
            ignoreCounts: {
                'execution-error': 0,
                'multiline-paste': 0,
                'idle': 0,
                'selection-maintained': 0,
            },
        };
    }

    /**
     * Get the current idle threshold in ms.
     * Formula: 30000 + k * 30000, cap 180000 [P11, Section 4]
     */
    public getIdleThreshold(): number {
        const threshold = this._config.IDLE_INITIAL_MS +
            this._state.ignoreCounts['idle'] * this._config.IDLE_INCREMENT_MS;
        return Math.min(threshold, this._config.IDLE_MAX_THRESHOLD_MS);
    }

    /**
     * Get the current selection-maintained threshold in ms.
     * Formula: 15000 + k * 15000, cap 120000 [P11, Section 4]
     */
    public getSelectionThreshold(): number {
        const threshold = this._config.SELECTION_INITIAL_MS +
            this._state.ignoreCounts['selection-maintained'] * this._config.SELECTION_INCREMENT_MS;
        return Math.min(threshold, this._config.SELECTION_MAX_THRESHOLD_MS);
    }

    /** Counts one dismissed or ignored intervention for a trigger type. */
    public incrementIgnoreCount(type: TriggerType): void {
        this._state.ignoreCounts[type]++;
    }

    /** Resets all ignore counts, e.g. after the user accepted help. */
    public resetAll(): void {
        for (const key of Object.keys(this._state.ignoreCounts) as TriggerType[]) {
            this._state.ignoreCounts[key] = 0;
        }
    }

    public onSessionStart(_context: SessionStartContext): void {
        this.resetAll();
    }

    /** Current adaptive state, for debugging. */
    public getState(): AdaptiveState {
        return { ignoreCounts: { ...this._state.ignoreCounts } };
    }
}
