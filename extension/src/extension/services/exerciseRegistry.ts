import type { ExerciseRef } from '@shared/types';

import type { CourseDashboardEntry } from '@extension/types';

import { logger } from './loggingService';
import { getEntryExercises, toExerciseSource } from './workspace';

export interface ExerciseRegistryEntry extends ExerciseRef {
    repositoryUri: string;
    participationId?: number;
}

type LegacyCourseEntry = CourseDashboardEntry & { id?: number };

function isLikelyCourseEntry(value: unknown): value is LegacyCourseEntry {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const candidate = value as { course?: unknown; id?: unknown; exercises?: unknown };
    return (
        (typeof candidate.course === 'object' && candidate.course !== null) ||
        typeof candidate.id === 'number' ||
        Array.isArray(candidate.exercises)
    );
}

export class ExerciseRegistry {
    private exercises: Map<number, ExerciseRegistryEntry> = new Map();
    /**
     * Reverse lookup from participationId to exerciseId.
     * Enables the StruggleCoordinator to filter WebSocket build results by the
     * currently-active exercise — the ResultDTO only carries a participationId,
     * not an exerciseId, so without this map a result from exercise A would
     * contaminate the struggle engine of the active exercise B.
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
     * Clears all exercises belonging to a course. Call it before re-registering
     * from fresh course data, so deleted exercises leave the registry.
     */
    public clearCourse(courseId: number): void {
        const toDelete: number[] = [];
        for (const [exerciseId, entry] of this.exercises) {
            if (entry.courseId === courseId) {
                toDelete.push(exerciseId);
            }
        }
        for (const id of toDelete) {
            const entry = this.exercises.get(id);
            if (entry?.participationId !== undefined) {
                this.participationToExercise.delete(entry.participationId);
            }
            this.exercises.delete(id);
        }
        if (toDelete.length > 0) {
            logger.exercise(`Cleared ${toDelete.length} exercises for course ${courseId}`);
        }
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

    public registerFromCourseData(courseData: unknown): void {
        // Accept anything that structurally looks like a CourseDashboardEntry
        // (a `course` property or a top-level `id`). Anything else is dropped
        // silently: every call site passes a server response or an internally
        // constructed entry shape.
        if (!isLikelyCourseEntry(courseData)) {
            return;
        }
        const entry = courseData;
        // Prefer nested `course.id`, fall back to a top-level `id` on the
        // legacy `{ id, exercises }` shape some callers still pass.
        const courseId = typeof entry.course?.id === 'number'
            ? entry.course.id
            : (typeof entry.id === 'number' ? entry.id : undefined);

        if (typeof courseId === 'number') {
            this.clearCourse(courseId);
        }

        const exercises = getEntryExercises(entry);
        let registeredCount = 0;
        const registered: string[] = [];
        const skipped: string[] = [];

        for (const exercise of exercises) {
            const source = toExerciseSource(exercise, courseId);
            if (!source) {
                continue;
            }
            const firstParticipation = source.studentParticipations?.[0];
            // `toExerciseSource` intentionally drops the participation id, so
            // read it from the raw exercise for the upstream wiring.
            const rawFirstParticipation = exercise.studentParticipations?.[0];
            const participationId = typeof rawFirstParticipation?.id === 'number'
                ? rawFirstParticipation.id
                : undefined;
            if (firstParticipation?.repositoryUri && source.title) {
                this.registerExercise(
                    source.id,
                    source.title,
                    firstParticipation.repositoryUri,
                    source.shortName,
                    courseId,
                    participationId,
                );
                registeredCount++;
                registered.push(`${source.id}: ${source.title}`);
            } else {
                skipped.push(`${source.id}: ${source.title} (no repo URI)`);
            }
        }

        logger.exercise(`Processed ${exercises.length} exercises: ${registeredCount} registered, ${skipped.length} skipped. Total in registry: ${this.exercises.size}`);
        if (registered.length > 0) {
            logger.exercise(`✅ Registered: ${registered.join(', ')}`);
        }
        if (skipped.length > 0 && skipped.length <= 3) {
            logger.exercise(`⏭️  Skipped: ${skipped.join(', ')}`);
        } else if (skipped.length > 3) {
            logger.exercise(`⏭️  Skipped ${skipped.length} exercises (no repository URIs)`);
        }
    }

    public getAllExercises(): ExerciseRegistryEntry[] {
        return Array.from(this.exercises.values());
    }

}
