import { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import { ContextStore } from '@extension/services/iris/context/contextStore';

export class ChatDiagnosticsService {
    constructor(
        private readonly _contextStore: ContextStore,
        private readonly _exerciseRegistry: ExerciseRegistry,
    ) { }

    public generateDiagnosticsReport(): string {
        const snapshot = this._contextStore.snapshot();
        let report = '='.repeat(80) + '\n';
        report += '🐛 IRIS CHAT DIAGNOSTICS\n';
        report += 'Generated at: ' + new Date().toISOString() + '\n';
        report += '='.repeat(80) + '\n\n';

        report += `💻 EXERCISES (${snapshot.exercises.length}):\n`;
        if (snapshot.exercises.length > 0) {
            snapshot.exercises.forEach((exercise, idx) => {
                report += `  ${idx + 1}. [${exercise.id}] ${exercise.title}${exercise.isWorkspace ? ' ⭐' : ''}\n`;
                report += `     Short Name: ${exercise.shortName ?? '—'}\n`;
                report += `     Course ID: ${exercise.courseId ?? '—'}\n`;
                if (exercise.releaseDate) {
                    report += `     Release: ${exercise.releaseDate}\n`;
                }
                if (exercise.dueDate) {
                    report += `     Due: ${exercise.dueDate}\n`;
                }
                if (exercise.lastViewed) {
                    report += `     Last Viewed: ${new Date(exercise.lastViewed).toISOString()}\n`;
                }
            });
        } else {
            report += '  No exercises tracked\n';
        }

        report += `\n📚 COURSES (${snapshot.courses.length}):\n`;
        if (snapshot.courses.length > 0) {
            snapshot.courses.forEach((course, idx) => {
                report += `  ${idx + 1}. [${course.id}] ${course.title}\n`;
                report += `     Short Name: ${course.shortName ?? '—'}\n`;
                if (course.lastViewed) {
                    report += `     Last Viewed: ${new Date(course.lastViewed).toISOString()}\n`;
                }
            });
        } else {
            report += '  No courses tracked\n';
        }

        const registry = this._exerciseRegistry;
        const registeredExercises = registry.getAllExercises();
        report += `\n📘 EXERCISE REGISTRY (${registeredExercises.length} total):\n`;
        if (registeredExercises.length > 0) {
            registeredExercises.forEach((exercise, idx) => {
                report += `  ${idx + 1}. [${exercise.id}] ${exercise.title}\n`;
                report += `     Repository: ${exercise.repositoryUri}\n`;
            });
        } else {
            report += '  Registry is empty\n';
        }

        return report;
    }
}
