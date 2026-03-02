import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { postCommand, type VsCodeApi } from '../../../../shared/messageContracts';
import type {
    ExerciseDetailsResponse,
    ParticipationSummary,
    ResultSummary,
    SubmissionSummary,
} from '../../../../types/apiResponses';

interface ExerciseDetailState {
    exerciseData: ExerciseDetailsResponse | null;
    hideDeveloperTools: boolean;
    isLoading: boolean;
    error: string | null;

    // Actions
    setExerciseData: (data: ExerciseDetailsResponse, hideDeveloperTools: boolean) => void;
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
    loadExerciseDetail: (vscodeApi: VsCodeApi, exerciseId: number) => void;
    updateBuildStatus: (payload: ResultSummary) => void;
    updateSubmission: (payload: SubmissionSummary) => void;
    updateSubmissionProcessing: (payload: { state: string; participationId: number; buildTimingInfo?: unknown }) => void;
}

/**
 * Helper to find participation by result or submission ID.
 * Mimics the legacy resolveParticipationForResult logic.
 */
function findParticipationForResult(
    exerciseData: ExerciseDetailsResponse,
    result: ResultSummary
): ParticipationSummary | null {
    if (!exerciseData?.exercise?.studentParticipations) {
        return null;
    }

    for (const participation of exerciseData.exercise.studentParticipations) {
        if (participation.results) {
            const foundResult = participation.results.find((r) => r.id === result.id);
            if (foundResult) {
                return participation;
            }
        }
    }

    return null;
}

/**
 * Get the latest submission from a participation.
 */
function getLatestSubmission(participation: ParticipationSummary): SubmissionSummary | null {
    if (!participation?.submissions || participation.submissions.length === 0) {
        return null;
    }

    return participation.submissions.reduce((latest, current) => {
        const latestDate = latest?.submissionDate ? new Date(latest.submissionDate).getTime() : 0;
        const currentDate = current?.submissionDate ? new Date(current.submissionDate).getTime() : 0;
        return currentDate > latestDate ? current : latest;
    }, participation.submissions[0]);
}

/**
 * Get the latest result from a participation.
 */
function getLatestResult(participation: ParticipationSummary): ResultSummary | null {
    if (!participation?.results || participation.results.length === 0) {
        return null;
    }

    return participation.results.reduce((latest, current) => {
        const latestDate = latest?.completionDate ? new Date(latest.completionDate).getTime() : 0;
        const currentDate = current?.completionDate ? new Date(current.completionDate).getTime() : 0;
        return currentDate > latestDate ? current : latest;
    }, participation.results[0]);
}

export const useExerciseDetailStore = create<ExerciseDetailState>()(
    devtools(
        (set, get) => ({
            exerciseData: null,
            hideDeveloperTools: false,
            isLoading: false,
            error: null,

            setExerciseData: (data, hideDeveloperTools) => {
                set({
                    exerciseData: data,
                    hideDeveloperTools,
                    isLoading: false,
                    error: null,
                }, false, 'setExerciseData');
            },

            setLoading: (loading) => {
                set({ isLoading: loading }, false, 'setLoading');
            },

            setError: (error) => {
                set({ error, isLoading: false }, false, 'setError');
            },

            loadExerciseDetail: (vscodeApi, exerciseId) => {
                set({ isLoading: true, error: null }, false, 'loadExerciseDetail');
                postCommand(vscodeApi, 'reloadExerciseDetail', { exerciseId });
            },

            updateBuildStatus: (payload) => {
                const state = get();
                if (!state.exerciseData) {
                    return;
                }

                // payload is the newResult data
                const result = payload;

                // Deep clone exerciseData
                const updatedData = JSON.parse(JSON.stringify(state.exerciseData)) as ExerciseDetailsResponse;

                // Find participation for this result
                const participation = findParticipationForResult(updatedData, result);

                if (participation) {
                    // Update or add result
                    if (!participation.results) {
                        participation.results = [];
                    }

                    const existingIndex = participation.results.findIndex((r) => r.id === result.id);
                    if (existingIndex >= 0) {
                        participation.results[existingIndex] = result;
                    } else {
                        participation.results.push(result);
                    }

                    // Update latest result reference - updatedData may have latestResult field via index signature
                    const updatedDataWithLatest = updatedData as ExerciseDetailsResponse & { latestResult?: ResultSummary | null };
                    updatedDataWithLatest.latestResult = getLatestResult(participation);
                }

                set({ exerciseData: updatedData }, false, 'updateBuildStatus');
            },

            updateSubmission: (payload) => {
                const state = get();
                if (!state.exerciseData) {
                    return;
                }

                // payload is the newSubmission data
                const submission = payload;
                // Submission may have a participation reference (not in type but present at runtime via index signature)
                const submissionWithParticipation = submission as SubmissionSummary & { participation?: ParticipationSummary };
                const submissionParticipation = submissionWithParticipation.participation;

                // Deep clone exerciseData
                const updatedData = JSON.parse(JSON.stringify(state.exerciseData)) as ExerciseDetailsResponse;

                // Find participation by ID
                const participation = updatedData.exercise?.studentParticipations?.find(
                    (p: ParticipationSummary) => p.id === submissionParticipation?.id
                );

                if (participation) {
                    // Update or add submission
                    if (!participation.submissions) {
                        participation.submissions = [];
                    }

                    const existingIndex = participation.submissions.findIndex((s: SubmissionSummary) => s.id === submission.id);
                    if (existingIndex >= 0) {
                        participation.submissions[existingIndex] = submission;
                    } else {
                        participation.submissions.push(submission);
                    }

                    // Update latest submission reference - updatedData may have latestSubmission field via index signature
                    const updatedDataWithLatest = updatedData as ExerciseDetailsResponse & { latestSubmission?: SubmissionSummary | null };
                    updatedDataWithLatest.latestSubmission = getLatestSubmission(participation);
                }

                set({ exerciseData: updatedData }, false, 'updateSubmission');
            },

            updateSubmissionProcessing: (payload) => {
                const state = get();
                if (!state.exerciseData) {
                    return;
                }

                // payload contains submission processing status
                // For now, just flag that a submission is processing

                // Deep clone exerciseData
                const updatedData = JSON.parse(JSON.stringify(state.exerciseData)) as ExerciseDetailsResponse;

                // Mark pending submission - updatedData may have pendingSubmission field via index signature
                const updatedDataWithPending = updatedData as ExerciseDetailsResponse & { pendingSubmission?: typeof payload };
                updatedDataWithPending.pendingSubmission = payload;

                set({ exerciseData: updatedData }, false, 'updateSubmissionProcessing');
            },
        }),
        {
            name: 'ExerciseDetailStore',
            enabled: process.env.NODE_ENV === 'development',
        }
    )
);
