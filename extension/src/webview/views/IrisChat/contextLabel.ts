/**
 * Display label for a topic. Mirrors the host's `labelFor`
 * (`contextMarkers.ts`), which answers the same question for the marker rows.
 *
 * A mode-aware fallback rather than one constant, because `name` is genuinely
 * absent on most load paths: only the overview endpoint carries `entityName`,
 * so a conversation loaded from the detail endpoint has nothing to show. A
 * single fallback would then either call every conversation "Topic" or, worse,
 * label an exercise conversation "Course chat".
 */
export function contextLabel(context: { mode: string; entityId: number; name?: string }): string {
    if (context.name) { return context.name; }
    switch (context.mode) {
        case 'COURSE_CHAT': return 'Course chat';
        case 'LECTURE_CHAT': return `Lecture ${context.entityId}`;
        case 'PROGRAMMING_EXERCISE_CHAT':
        case 'TEXT_EXERCISE_CHAT': return `Exercise ${context.entityId}`;
        default: return `Topic ${context.entityId}`;
    }
}
