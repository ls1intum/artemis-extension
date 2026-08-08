import type { IrisActivityDTO } from '@shared/types/apiResponses';

/**
 * Ported from the Artemis web client's `iris.json` activity keys (16 entries).
 * The extension has no i18n framework, so this is a plain constant. Pyris can
 * add tools without an Artemis release, hence the prettify fallback.
 */
const ACTIVITY_LABELS: Readonly<Record<string, string>> = {
    lecture_content_retrieval: 'Reading lecture',
    faq_content_retrieval: 'Reading FAQs',
    get_course_details: 'Looking up course info',
    get_exercise_list: 'Looking up exercises',
    get_exercise_problem_statement: 'Reading problem statement',
    get_student_exercise_metrics: 'Checking your progress',
    get_competency_list: 'Looking up competencies',
    get_submission_details: 'Reading your submission',
    get_additional_exercise_details: 'Looking up exercise info',
    get_build_logs_analysis_tool: 'Checking build logs',
    get_feedbacks: 'Reading feedback',
    repository_files: 'Browsing your code',
    file_lookup: 'Reading a file',
    memiris_search_for_memories: 'Recalling memories',
    memiris_find_similar_memories: 'Finding related memories',
    generate_mcq_questions: 'Creating quiz questions',
};

export function prettifyActivityName(name: string): string {
    const label = name.replace(/_/g, ' ').trim();
    if (!label) { return ''; }
    return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

export function activityLabel(name: string): string {
    return ACTIVITY_LABELS[name] ?? prettifyActivityName(name);
}

/** Sub-100ms durations render as a meaningless "0.0s", so they are dropped. */
export function formatActivityDuration(activity: IrisActivityDTO): string | undefined {
    if (activity.state !== 'FINISHED' || activity.durationMillis === undefined) { return undefined; }
    if (activity.durationMillis < 100) { return undefined; }
    return `${(activity.durationMillis / 1000).toFixed(1)}s`;
}

export function activityTrailSummary(activities: IrisActivityDTO[]): string {
    return `Tools used: ${activities.length}`;
}
