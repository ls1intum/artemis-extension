import * as vscode from 'vscode';
import {
    CombinedStruggleScore,
    LocalStruggleContext,
    ServerStruggleContext,
    RecommendedAction,
    InactivityPattern,
} from './types';
import { DiagnosticPersistenceService } from './diagnosticPersistenceService';
import { InactivityService } from './inactivityService';
import { ThrashingDetector } from './thrashingDetector';
import { BuildResultTracker } from './buildResultTracker';

/**
 * Service that calculates combined struggle scores from all telemetry sources.
 * Uses weighted combination of local and server-side metrics.
 */
export class StruggleScoreService implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];

    /** Weight configuration for score calculation */
    private static readonly WEIGHTS = {
        PERSISTENT_ERRORS: 0.35,
        INACTIVITY: 0.25,
        THRASHING: 0.20,
        BUILD_FAILURES: 0.20,
    };

    /** Thresholds for recommended actions */
    private static readonly ACTION_THRESHOLDS = {
        SUBTLE: 35,
        NOTIFICATION: 55,
        PROACTIVE: 75,
    };

    /**
     * Persistence levels for graduated error weighting.
     * Based on research showing that error persistence duration correlates
     * with struggle severity (Jadud 2006, Watson et al. 2013).
     */
    private static readonly PERSISTENCE_LEVELS = {
        MINOR: 30 * 1000,      // 30s - weight 0.3 (likely typos or quick fixes)
        MODERATE: 90 * 1000,   // 90s - weight 0.7 (needs more thought)
        SEVERE: 180 * 1000,    // 3min - weight 1.0 (persistent struggle)
    };

    /** Minimum threshold for any error to be considered (uses MINOR level) */
    private static readonly PERSISTENT_ERROR_THRESHOLD_MS = 30 * 1000;

    constructor(
        private readonly _diagnosticService: DiagnosticPersistenceService,
        private readonly _inactivityService: InactivityService,
        private readonly _thrashingDetector: ThrashingDetector,
        private readonly _buildTracker: BuildResultTracker,
    ) {}

    public dispose(): void {
        while (this._disposables.length > 0) {
            const disposable = this._disposables.pop();
            disposable?.dispose();
        }
    }

    /**
     * Calculate the combined struggle score from all sources
     */
    public calculateScore(): CombinedStruggleScore {
        const local = this._calculateLocalContext();
        const server = this._calculateServerContext();

        // Calculate component scores (0-100 each)
        const persistentErrorScore = this._calculatePersistentErrorScore(local);
        const inactivityScore = this._calculateInactivityScore(local.inactivityPattern);
        const thrashingScore = local.thrashingScore;
        const buildFailureScore = this._calculateBuildFailureScore(server);

        // Weighted combination
        const combined = Math.round(
            persistentErrorScore * StruggleScoreService.WEIGHTS.PERSISTENT_ERRORS +
            inactivityScore * StruggleScoreService.WEIGHTS.INACTIVITY +
            thrashingScore * StruggleScoreService.WEIGHTS.THRASHING +
            buildFailureScore * StruggleScoreService.WEIGHTS.BUILD_FAILURES
        );

        // Calculate confidence based on data availability
        const confidence = this._calculateConfidence(local, server);

        // Determine recommended action
        const recommendedAction = this._determineAction(combined);

        return {
            local,
            server,
            combined: Math.min(100, Math.max(0, combined)),
            confidence,
            recommendedAction,
        };
    }

    /**
     * Calculate local struggle context from VS Code data
     */
    private _calculateLocalContext(): LocalStruggleContext {
        const persistentDiagnostics = this._diagnosticService.getPersistentDiagnostics(
            StruggleScoreService.PERSISTENT_ERROR_THRESHOLD_MS
        );

        return {
            persistentErrors: persistentDiagnostics.map(d => d.message),
            inactivityPattern: this._inactivityService.getCurrentPattern(),
            timeSinceLastEdit: this._inactivityService.getTimeSinceLastEdit(),
            thrashingScore: this._thrashingDetector.getThrashingScore(),
        };
    }

    /**
     * Calculate server struggle context from Artemis data
     */
    private _calculateServerContext(): ServerStruggleContext {
        const buildPattern = this._buildTracker.getRecentBuildPattern();
        const lastBuild = this._buildTracker.getLastBuildResult();

        return {
            consecutiveBuildFailures: this._buildTracker.getConsecutiveFailures(),
            failingTestCases: buildPattern.commonFailingTests,
            lastBuildError: lastBuild && !lastBuild.success ? lastBuild.buildLog : undefined,
            lastSubmissionTime: lastBuild?.timestamp,
        };
    }

    /**
     * Calculate score component from persistent errors using graduated weighting.
     * 
     * Based on Jadud's Error Quotient (EQ) principle (Jadud 2006):
     * - Errors are weighted by their persistence duration
     * - Repeated same error types receive a bonus (indicating deeper confusion)
     * 
     * Linear scaling: 20 points per weighted error + 10 bonus for repeated types.
     */
    private _calculatePersistentErrorScore(local: LocalStruggleContext): number {
        const persistentDiagnostics = this._diagnosticService.getPersistentDiagnostics(
            StruggleScoreService.PERSISTENT_ERROR_THRESHOLD_MS
        );
        
        if (persistentDiagnostics.length === 0) {
            return 0;
        }

        // Calculate weighted error score based on persistence level
        let weightedScore = 0;
        const errorCodeCounts = new Map<string | number | undefined, number>();

        for (const diagnostic of persistentDiagnostics) {
            const persistenceDuration = Date.now() - diagnostic.firstSeen;
            
            // Determine weight based on persistence level
            let weight: number;
            if (persistenceDuration >= StruggleScoreService.PERSISTENCE_LEVELS.SEVERE) {
                weight = 1.0;
            } else if (persistenceDuration >= StruggleScoreService.PERSISTENCE_LEVELS.MODERATE) {
                weight = 0.7;
            } else {
                weight = 0.3;
            }

            // Base: 20 points per error, weighted by persistence
            weightedScore += 20 * weight;

            // Track error codes for repetition bonus (Jadud's EQ principle)
            const code = diagnostic.code;
            errorCodeCounts.set(code, (errorCodeCounts.get(code) ?? 0) + 1);
        }

        // Repetition bonus: +10 for each repeated error type (same diagnostic code)
        // This aligns with Jadud's finding that repeated same errors indicate deeper struggle
        let repetitionBonus = 0;
        for (const count of errorCodeCounts.values()) {
            if (count > 1) {
                // Each repetition beyond the first adds 10 points
                repetitionBonus += (count - 1) * 10;
            }
        }

        return Math.min(100, Math.round(weightedScore + repetitionBonus));
    }

    /**
     * Calculate score component from inactivity pattern
     */
    private _calculateInactivityScore(pattern: InactivityPattern): number {
        switch (pattern) {
            case 'active':
                return 0;
            case 'thinking':
                return 20;
            case 'confusion':
                return 60;
            case 'giving-up':
                return 100;
        }
    }

    /**
     * Calculate score component from build failures
     */
    private _calculateBuildFailureScore(server: ServerStruggleContext): number {
        const failures = server.consecutiveBuildFailures;

        if (failures === 0) {
            return 0;
        }

        // Scale: 1 failure = 25, 2 = 50, 3 = 75, 4+ = 90+
        return Math.min(100, 25 * failures);
    }

    /**
     * Calculate confidence level based on available data
     */
    private _calculateConfidence(local: LocalStruggleContext, server: ServerStruggleContext): number {
        let confidence = 0.5; // Base confidence

        // Higher confidence if we have diagnostic data
        if (local.persistentErrors.length > 0 || this._diagnosticService.getActiveErrorCount() > 0) {
            confidence += 0.2;
        }

        // Higher confidence if we have build data
        if (server.lastSubmissionTime !== undefined) {
            confidence += 0.2;
        }

        // Higher confidence if user is not idle
        if (local.inactivityPattern !== 'giving-up') {
            confidence += 0.1;
        }

        return Math.min(1, confidence);
    }

    /**
     * Determine recommended action based on combined score
     */
    private _determineAction(score: number): RecommendedAction {
        if (score >= StruggleScoreService.ACTION_THRESHOLDS.PROACTIVE) {
            return 'proactive';
        } else if (score >= StruggleScoreService.ACTION_THRESHOLDS.NOTIFICATION) {
            return 'notification';
        } else if (score >= StruggleScoreService.ACTION_THRESHOLDS.SUBTLE) {
            return 'subtle';
        } else {
            return 'none';
        }
    }
}
