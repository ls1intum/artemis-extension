import type { ExerciseRef } from '@shared/types';

import { logger } from './loggingService';

export interface ExerciseRegistryEntry extends ExerciseRef {
    repositoryUri: string;
    participationId?: number;
}

export class ExerciseRegistry {
    private exercises: Map<number, ExerciseRegistryEntry> = new Map();
    /**
     * Reverse lookup from participationId to exerciseId. A ResultDTO carries
     * only a participationId, so without this map TelemetryManager cannot tell
     * a build result for exercise A from one for the active exercise B.
     */
    private participationToExercise: Map<number, number> = new Map();

    public registerExercise(id: number, title: string, repositoryUri: string, shortName?: string, courseId?: number, participationId?: number): void {
        // If this exercise already had a different participationId, drop the old
        // reverse mapping so it doesn't linger and match stale results.
        const existing = this.exercises.get(id);
        if (existing?.participationId !== undefined && existing.participationId !== participationId) {
            this.participationToExercise.delete(existing.participationId);
        }
        this.exercises.set(id, { id, title, repositoryUri, shortName, courseId, participationId });
        if (participationId !== undefined) {
            this.participationToExercise.set(participationId, id);
        }
    }

    /**
     * Resolve a participationId to the exerciseId it belongs to.
     * Returns undefined if the mapping is unknown (e.g. exercise was never
     * registered, or course data did not contain a participation).
     */
    public getExerciseIdByParticipation(participationId: number): number | undefined {
        return this.participationToExercise.get(participationId);
    }

    /**
     * Empties the whole index. The registry is memory-only but outlives a
     * logout, and workspace detection only fetches when it is EMPTY
     * (workspaceDetectionService.ts), so without this the next account's
     * detection reads the previous account's exercises and can resolve their
     * ids for this folder's remote.
     */
    public reset(): void {
        this.exercises.clear();
        this.participationToExercise.clear();
    }

    /**
     * Installs exactly entries, dropping everything else. The registry is an
     * index over the catalog, not a second source of truth: an exercise the
     * catalog no longer projects must not keep answering repository matches.
     */
    public replaceAll(entries: ExerciseRegistryEntry[]): void {
        this.reset();
        for (const entry of entries) {
            this.registerExercise(
                entry.id, entry.title, entry.repositoryUri,
                entry.shortName, entry.courseId, entry.participationId,
            );
        }
        logger.exercise(`Registry rebuilt with ${this.exercises.size} exercises`);
    }

    public getAllExercises(): ExerciseRegistryEntry[] {
        return Array.from(this.exercises.values());
    }
}
