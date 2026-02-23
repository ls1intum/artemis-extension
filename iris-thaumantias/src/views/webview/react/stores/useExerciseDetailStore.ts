import { create } from 'zustand';
import type { VsCodeApi } from '../../../../shared/messageContracts';

interface ExerciseDetailState {
    exerciseData: any | null;
    hideDeveloperTools: boolean;
    isLoading: boolean;
    error: string | null;

    // Actions
    setExerciseData: (data: any, hideDeveloperTools: boolean) => void;
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
    loadExerciseDetail: (vscodeApi: VsCodeApi, exerciseId: number) => void;
    updateBuildStatus: (payload: any) => void;
    updateSubmission: (payload: any) => void;
    updateSubmissionProcessing: (payload: any) => void;
}

/**
 * Helper to find participation by result or submission ID.
 * Mimics the legacy resolveParticipationForResult logic.
 */
function findParticipationForResult(exerciseData: any, result: any): any {
    if (!exerciseData?.exercise?.studentParticipations) {
        return null;
    }

    for (const participation of exerciseData.exercise.studentParticipations) {
        if (participation.results) {
            const foundResult = participation.results.find((r: any) => r.id === result.id);
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
function getLatestSubmission(participation: any): any {
    if (!participation?.submissions || participation.submissions.length === 0) {
        return null;
    }

    return participation.submissions.reduce((latest: any, current: any) => {
        const latestDate = latest?.submissionDate ? new Date(latest.submissionDate).getTime() : 0;
        const currentDate = current?.submissionDate ? new Date(current.submissionDate).getTime() : 0;
        return currentDate > latestDate ? current : latest;
    }, participation.submissions[0]);
}

/**
 * Get the latest result from a participation.
 */
function getLatestResult(participation: any): any {
    if (!participation?.results || participation.results.length === 0) {
        return null;
    }

    return participation.results.reduce((latest: any, current: any) => {
        const latestDate = latest?.completionDate ? new Date(latest.completionDate).getTime() : 0;
        const currentDate = current?.completionDate ? new Date(current.completionDate).getTime() : 0;
        return currentDate > latestDate ? current : latest;
    }, participation.results[0]);
}

export const useExerciseDetailStore = create<ExerciseDetailState>((set, get) => ({
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
        });
    },

    setLoading: (loading) => {
        set({ isLoading: loading });
    },

    setError: (error) => {
        set({ error, isLoading: false });
    },

    loadExerciseDetail: (vscodeApi, exerciseId) => {
        set({ isLoading: true, error: null });
        vscodeApi.postMessage({
            type: 'command',
            command: 'reloadExerciseDetail',
            payload: { exerciseId },
        });
    },

    updateBuildStatus: (payload) => {
        const state = get();
        if (!state.exerciseData) {
            return;
        }

        // payload is the newResult data
        const result = payload;

        // Deep clone exerciseData
        const updatedData = JSON.parse(JSON.stringify(state.exerciseData));

        // Find participation for this result
        const participation = findParticipationForResult(updatedData, result);

        if (participation) {
            // Update or add result
            if (!participation.results) {
                participation.results = [];
            }

            const existingIndex = participation.results.findIndex((r: any) => r.id === result.id);
            if (existingIndex >= 0) {
                participation.results[existingIndex] = result;
            } else {
                participation.results.push(result);
            }

            // Update latest result reference
            updatedData.latestResult = getLatestResult(participation);
        }

        set({ exerciseData: updatedData });
    },

    updateSubmission: (payload) => {
        const state = get();
        if (!state.exerciseData) {
            return;
        }

        // payload is the newSubmission data
        const submission = payload;

        // Deep clone exerciseData
        const updatedData = JSON.parse(JSON.stringify(state.exerciseData));

        // Find participation by ID
        const participation = updatedData.exercise?.studentParticipations?.find(
            (p: any) => p.id === submission.participation?.id
        );

        if (participation) {
            // Update or add submission
            if (!participation.submissions) {
                participation.submissions = [];
            }

            const existingIndex = participation.submissions.findIndex((s: any) => s.id === submission.id);
            if (existingIndex >= 0) {
                participation.submissions[existingIndex] = submission;
            } else {
                participation.submissions.push(submission);
            }

            // Update latest submission reference
            updatedData.latestSubmission = getLatestSubmission(participation);
        }

        set({ exerciseData: updatedData });
    },

    updateSubmissionProcessing: (payload) => {
        const state = get();
        if (!state.exerciseData) {
            return;
        }

        // payload contains submission processing status
        // For now, just flag that a submission is processing

        // Deep clone exerciseData
        const updatedData = JSON.parse(JSON.stringify(state.exerciseData));

        // Mark pending submission
        updatedData.pendingSubmission = payload;

        set({ exerciseData: updatedData });
    },
}));
