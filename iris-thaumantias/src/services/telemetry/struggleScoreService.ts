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

    /** Minimum duration for errors to be considered persistent (2 minutes) */
    private static readonly PERSISTENT_ERROR_THRESHOLD_MS = 2 * 60 * 1000;

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
     * Calculate score component from persistent errors
     */
    private _calculatePersistentErrorScore(local: LocalStruggleContext): number {
        const errorCount = local.persistentErrors.length;
        
        if (errorCount === 0) {
            return 0;
        }

        // Scale: 1 error = 30, 2 = 50, 3 = 70, 4+ = 85+
        return Math.min(100, 30 + (errorCount - 1) * 20);
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
