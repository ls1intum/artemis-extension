// Type-only: this module is value-imported by the replay parser, which also
// runs in a plain Node process (scripts/validate-recording.ts). Keeping vscode
// type-only guarantees no runtime 'vscode' resolution leaks into that path.
import type * as vscode from 'vscode';

import type { EQConfidence } from '@extension/services/eq/types';

// ── Session lifecycle (interim re-export — declarations moved to sessionLifecycle.ts in PR 2c) ──
export type { SessionResettable, SessionStartContext } from '@extension/services/sessionLifecycle';

// ── Diagnostics ─────────────────────────────────────────────────────

/**
 * Represents a tracked VS Code diagnostic with persistence information
 */
export interface TrackedDiagnostic {
    /** Unique identifier generated from file:line:code hash */
    id: string;
    /** URI of the file containing the diagnostic */
    uri: string;
    /** Range where the diagnostic appears */
    range: {
        startLine: number;
        startCharacter: number;
        endLine: number;
        endCharacter: number;
    };
    /** Diagnostic code (e.g., 'ts2304') */
    code: string | number | undefined;
    /** Diagnostic message */
    message: string;
    /** Severity level */
    severity: vscode.DiagnosticSeverity;
    /** Timestamp when first seen */
    firstSeen: number;
    /** Timestamp when last seen */
    lastSeen: number;
    /** Number of times this diagnostic has appeared */
    occurrences: number;
    /** Whether this diagnostic has been resolved */
    resolved: boolean;
}

/**
 * Inactivity pattern classification
 */
export type InactivityPattern = 'active' | 'thinking' | 'confusion' | 'giving-up';

/**
 * Active intervention levels (excludes 'none'). Single source for the level
 * vocabulary shared by the decision engine and the recording schema.
 */
export const INTERVENTION_LEVELS = ['subtle', 'notification', 'proactive'] as const;
export type InterventionLevel = typeof INTERVENTION_LEVELS[number];

/**
 * Recommended intervention action: an active level or 'none'.
 */
export type RecommendedAction = 'none' | InterventionLevel;

/**
 * Struggle context for Iris chat integration.
 * EQ-based — replaces old weighted score.
 */
export interface StruggleContext {
    /** Whether student is currently struggling */
    isStruggling: boolean;
    /** Error Quotient (0.0-1.0), replaces old 0-100 score */
    eq: number;
    /** EQ confidence level */
    eqConfidence: EQConfidence;
    /** Which trigger caused the evaluation (if any) */
    triggerType?: TriggerType;
    /** Recommended action */
    recommendedAction: RecommendedAction;
}

/**
 * Build result from Artemis server
 */
export interface BuildResult {
    /** Timestamp of the build */
    timestamp: number;
    /** Whether the build succeeded */
    success: boolean;
    /** Number of errors in the build */
    errorCount: number;
    /** Names of failed test cases */
    failedTests: string[];
    /** Raw build log content */
    buildLog: string | undefined;
    /** Submission ID from Artemis */
    submissionId: number | undefined;
    /** Whether the build itself failed (compiler error), from result.submission?.buildFailed */
    rawBuildFailed?: boolean;
}

/**
 * Intervention state tracking
 */
export interface InterventionState {
    /** Last intervention timestamp */
    lastInterventionTime: number;
    /** Number of interventions in current session */
    sessionInterventionCount: number;
    /** Whether the last intervention was dismissed */
    lastDismissed: boolean;
    /** Whether the last intervention was accepted */
    lastAccepted: boolean;
}

// ============================================================================
// Trigger and Intervention Decision Types (Pu et al. 2025)
// ============================================================================

/**
 * Trigger types from Pu et al. 2025 [P11, Section 4, Figure 4]
 */
export const TRIGGER_TYPES = ['execution-error', 'multiline-paste', 'idle', 'selection-maintained'] as const;
export type TriggerType = typeof TRIGGER_TYPES[number];

/**
 * Trigger configuration — paper-validated thresholds [P11, Section 4]
 */
export interface TriggerConfig {
    /** Idle initial threshold: 30s [P11, Section 4] */
    readonly IDLE_INITIAL_MS: number;
    /** Idle increment per ignore: +30s [P11, Section 4] */
    readonly IDLE_INCREMENT_MS: number;
    /** Selection initial threshold: 15s [P11, Section 4] */
    readonly SELECTION_INITIAL_MS: number;
    /** Selection increment per ignore: +15s [P11, Section 4] */
    readonly SELECTION_INCREMENT_MS: number;
    /** Min lines for multi-line paste: >1 line [P11, Section 4] */
    readonly MULTILINE_PASTE_MIN_LINES: number;
    /** Idle threshold cap [Engineering choice] */
    readonly IDLE_MAX_THRESHOLD_MS: number;
    /** Selection threshold cap [Engineering choice] */
    readonly SELECTION_MAX_THRESHOLD_MS: number;
    /** Cooldown between trigger evaluations [Engineering choice].
     *  Applies to execution-error, multiline-paste, selection-maintained.
     *  Idle uses a one-shot state machine and does not use cooldown. */
    readonly TRIGGER_COOLDOWN_MS: number;
}

/** Default trigger configuration with paper-validated values */
export const DEFAULT_TRIGGER_CONFIG: TriggerConfig = {
    IDLE_INITIAL_MS: 30_000,
    IDLE_INCREMENT_MS: 30_000,
    SELECTION_INITIAL_MS: 15_000,
    SELECTION_INCREMENT_MS: 15_000,
    MULTILINE_PASTE_MIN_LINES: 2,
    IDLE_MAX_THRESHOLD_MS: 180_000,
    SELECTION_MAX_THRESHOLD_MS: 120_000,
    TRIGGER_COOLDOWN_MS: 60_000,
};

/**
 * Adaptive state for trigger threshold escalation [P11, Section 4]
 */
export interface AdaptiveState {
    /** Ignore count per trigger type */
    ignoreCounts: Record<TriggerType, number>;
}

/**
 * Reason why an intervention was blocked (i.e. rawWanted=true but shouldIntervene=false).
 *
 * - 'cooldown'        — InterventionService internal cooldown (notification/proactive only)
 * - 'warmup'          — Exercise hasn't reached the 5-minute warmup yet
 * - 'recent-progress' — Student made progress within the 2-minute grace period
 * - 'session-limit'   — Max interventions per session exceeded
 * - 'last-dismissed'  — Previous intervention was dismissed (non-proactive blocked)
 * - 'low-confidence'  — EQ above threshold but confidence gate is 'insufficient'
 */
export const INTERVENTION_BLOCKED_REASONS = [
    'cooldown',
    'warmup',
    'session-limit',
    'low-confidence',
    'recent-progress',
    'last-dismissed',
] as const;
export type InterventionBlockedReason = typeof INTERVENTION_BLOCKED_REASONS[number];

/**
 * Reason why an intervention was dismissed.
 *
 * - 'user-action'  — User explicitly clicked "Not now" / "Later"
 * - 'hidden'       — Hint was hidden implicitly (e.g. build succeeded, session ended)
 * - 'replaced'     — A newer intervention replaced the current one
 * - 'session-end'  — Session ended while intervention was pending
 */
export const INTERVENTION_DISMISS_REASONS = ['user-action', 'hidden', 'replaced', 'session-end'] as const;
export type InterventionDismissReason = typeof INTERVENTION_DISMISS_REASONS[number];

/**
 * Reason a wanted intervention was suppressed without being delivered to the user.
 * Currently only one reason exists; left as a union so future suppression sources
 * (e.g. per-condition study mode) can extend it cleanly.
 *
 * Note: this is a SEPARATE concept from `InterventionBlockedReason`. Blocks come
 * from engine-internal gates (cooldown, warmup, session-limit, low-confidence)
 * and are rate-limited. Suppression comes from explicit user/config choice and
 * is NOT rate-limited so the per-opportunity signal stays intact.
 */
export const INTERVENTION_SUPPRESSION_REASONS = ['user-disabled'] as const;
export type InterventionSuppressionReason = typeof INTERVENTION_SUPPRESSION_REASONS[number];

/**
 * Payload of `TelemetryManager.onDidSuppressIntervention`.
 *
 * `decision` is the original eligible decision with `shouldIntervene === true`.
 * It must NOT be mutated to `false` — the recording must retain the per-opportunity
 * eligibility signal for later analysis.
 */
export interface SuppressedInterventionPayload {
    decision: InterventionDecision;
    reason: InterventionSuppressionReason;
}

/**
 * Decision output from the intervention decision engine
 */
export interface InterventionDecision {
    /**
     * True when EQ is above the severity threshold, ignoring confidence and
     * guardrails. This is the "raw" want signal — the engine wanted to show
     * something based on severity alone.
     *
     * Example: EQ=0.5 (above notification threshold), confidence=insufficient
     *   → rawWanted=true, shouldIntervene=false, blockedReason='low-confidence'
     */
    rawWanted: boolean;
    /** Whether to actually show an intervention (rawWanted AND confidence AND guardrails pass) */
    shouldIntervene: boolean;
    /** Intervention level */
    level: RecommendedAction;
    /** Which trigger caused evaluation */
    triggerType?: TriggerType;
    /** Current EQ value */
    eq: number;
    /** Current EQ confidence */
    confidence: EQConfidence;
    /**
     * Populated when rawWanted=true and shouldIntervene=false.
     * Identifies why the intervention was blocked.
     */
    blockedReason?: InterventionBlockedReason;
}
