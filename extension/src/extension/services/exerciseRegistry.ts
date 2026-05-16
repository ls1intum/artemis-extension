import type { ExerciseRef } from '@shared/types';
import { logger } from './loggingService';

export interface ExerciseRegistryEntry extends ExerciseRef {
    repositoryUri: string;
    participationId?: number;
}

export class ExerciseRegistry {
    private exercises: Map<number, ExerciseRegistryEntry> = new Map();
    /**
     * Reverse lookup from participationId to exerciseId.
     * Enables TelemetryManager to filter WebSocket build results by the
     * currently-active exercise — the ResultDTO only carries a participationId,
     * not an exerciseId, so without this map a result from exercise A would
     * contaminate the EQ engine of the active exercise B.
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
     * Clears all exercises belonging to a specific course.
     * This should be called before re-registering exercises from fresh course data
     * to ensure deleted exercises are removed from the registry.
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

    public registerFromCourseData(courseData: unknown): void {
        const data = courseData as { course?: { id?: number; exercises?: unknown[] }; exercises?: unknown[]; id?: number };
        const exercises = data?.course?.exercises || data?.exercises || [];
        const courseId = data?.course?.id ?? data?.id;

        // Clear existing exercises for this course before registering fresh data
        // This ensures deleted exercises are properly removed from the registry
        if (courseId !== undefined && courseId !== null) {
            this.clearCourse(courseId);
        }

        let registeredCount = 0;
        const registered: string[] = [];
        const skipped: string[] = [];

        for (const exercise of exercises) {
            const ex = exercise as {
                id?: number;
                title?: string;
                shortName?: string;
                studentParticipations?: Array<{ id?: number; repositoryUri?: string }>
            };
            const participations = ex.studentParticipations || [];

            if (participations.length > 0 && participations[0].repositoryUri && ex.id && ex.title) {
                this.registerExercise(
                    ex.id,
                    ex.title,
                    participations[0].repositoryUri,
                    ex.shortName,
                    courseId,
                    typeof participations[0].id === 'number' ? participations[0].id : undefined,
                );
                registeredCount++;
                registered.push(`${ex.id}: ${ex.title}`);
            } else {
                skipped.push(`${ex.id ?? 'unknown'}: ${ex.title ?? 'unknown'} (no repo URI)`);
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
