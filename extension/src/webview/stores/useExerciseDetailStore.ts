import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { postCommand, type VsCodeApi } from '../../shared/messageContracts';
import type {
    ExerciseDetailsResponse,
    ParticipationSummary,
    ResultSummary,
    SubmissionSummary,
} from '../../shared/types/apiResponses';

interface RepoStatus {
    isConnected: boolean;
    hasChanges: boolean;
    isPracticeRepo: boolean;
}

interface DirtyPagesStatus {
    hasDirtyPages: boolean;
    dirtyFileCount: number;
    autoSaveEnabled: boolean;
}

export interface PendingSubmissionInfo {
    state: string;
    participationId: number;
    buildTimingInfo?: {
        buildStartDate?: string;
        estimatedCompletionDate?: string;
    };
}

interface ExerciseDetailState {
    exerciseData: ExerciseDetailsResponse | null;
    hideDeveloperTools: boolean;
    isLoading: boolean;
    error: string | null;

    // Submission processing
    pendingSubmission: PendingSubmissionInfo | null;

    // Extension→Webview response state
    repoStatus: RepoStatus | null;
    clonedNotice: string | null;
    dirtyPagesStatus: DirtyPagesStatus | null;

    // Actions
    setExerciseData: (data: ExerciseDetailsResponse, hideDeveloperTools: boolean, repoStatus?: RepoStatus) => void;
    setError: (error: string | null) => void;
    setLoading: (loading: boolean) => void;
    loadExerciseDetail: (vscodeApi: VsCodeApi, exerciseId: number) => void;
    updateBuildStatus: (payload: ResultSummary) => void;
    updateSubmission: (payload: SubmissionSummary) => void;
    updateSubmissionProcessing: (payload: PendingSubmissionInfo) => void;
    setRepoStatus: (status: RepoStatus) => void;
    setClonedNotice: (exerciseTitle: string) => void;
    setDirtyPagesStatus: (status: DirtyPagesStatus) => void;
    clearClonedNotice: () => void;
    clearPendingSubmission: () => void;
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
        // Results live on submission.results in Artemis
        for (const submission of participation.submissions ?? []) {
            if (submission.results?.some((r) => r.id === result.id)) {
                return participation;
            }
        }
    }

    return null;
}

export const useExerciseDetailStore = create<ExerciseDetailState>()(
    devtools(
        (set, get) => ({
            exerciseData: null,
            hideDeveloperTools: false,
            isLoading: true,
            error: null,
            pendingSubmission: null,
            repoStatus: null,
            clonedNotice: null,
            dirtyPagesStatus: null,

            setExerciseData: (data, hideDeveloperTools, repoStatus) => {
                set({
                    exerciseData: data,
                    hideDeveloperTools,
                    isLoading: false,
                    error: null,
                    pendingSubmission: (data.pendingSubmission as PendingSubmissionInfo) ?? null,
                    repoStatus: repoStatus ?? null,
                    clonedNotice: null,
                    dirtyPagesStatus: null,
                }, false, 'setExerciseData');
            },

            setError: (error) => {
                set({ error, isLoading: false }, false, 'setError');
            },

            setLoading: (loading) => {
                set({ isLoading: loading }, false, 'setLoading');
            },

            loadExerciseDetail: (vscodeApi, exerciseId) => {
                set({ isLoading: true }, false, 'loadExerciseDetail');
                postCommand(vscodeApi, 'reloadExerciseDetail', { exerciseId });
            },

            updateBuildStatus: (payload) => {
                const state = get();
                if (!state.exerciseData) {
                    return;
                }

                const updatedData = structuredClone(state.exerciseData);

                // Find participation: match by participationId first, then by result ID, then fallback
                let participation: ParticipationSummary | null = null;
                if (payload.participationId && updatedData.exercise?.studentParticipations) {
                    participation = updatedData.exercise.studentParticipations.find(
                        p => p.id === payload.participationId
                    ) ?? null;
                }
                if (!participation) {
                    participation = findParticipationForResult(updatedData, payload);
                }
                if (!participation) {
                    return;
                }

                // Results live on submission.results in Artemis
                // Find the latest submission (highest ID) and update its results
                const submissions = participation.submissions ?? [];
                const latestSubmission = [...submissions]
                    .sort((a, b) => (b.id ?? 0) - (a.id ?? 0))[0];

                if (latestSubmission) {
                    if (payload.buildFailed !== undefined) {
                        latestSubmission.buildFailed = payload.buildFailed;
                    }
                    if (!latestSubmission.results) {
                        latestSubmission.results = [];
                    }
                    if (payload.id !== null && payload.id !== undefined) {
                        const existingIndex = latestSubmission.results.findIndex((r) => r.id === payload.id);
                        if (existingIndex >= 0) {
                            latestSubmission.results[existingIndex] = payload;
                        } else {
                            latestSubmission.results.push(payload);
                        }
                    } else {
                        latestSubmission.results.push(payload);
                    }
                }

                set({ exerciseData: updatedData, pendingSubmission: null }, false, 'updateBuildStatus');
            },

            updateSubmission: (payload) => {
                const state = get();
                if (!state.exerciseData) {
                    return;
                }

                const updatedData = structuredClone(state.exerciseData);

                // Find participation by participationId first
                let participation: ParticipationSummary | undefined;
                if (payload.participationId && updatedData.exercise?.studentParticipations) {
                    participation = updatedData.exercise.studentParticipations.find(
                        (p: ParticipationSummary) => p.id === payload.participationId
                    );
                }
                if (!participation) {
                    return;
                }

                if (!participation.submissions) {
                    participation.submissions = [];
                }

                const existingIndex = participation.submissions.findIndex((s: SubmissionSummary) => s.id === payload.id);
                if (existingIndex >= 0) {
                    participation.submissions[existingIndex] = payload;
                } else {
                    participation.submissions.push(payload);
                }

                set({ exerciseData: updatedData }, false, 'updateSubmission');
            },

            updateSubmissionProcessing: (payload) => {
                const state = get();
                if (!state.exerciseData) {
                    return;
                }

                // Guard: only accept events for participations belonging to this exercise
                const match = state.exerciseData.exercise?.studentParticipations?.find(
                    (p) => p.id === payload.participationId
                );
                if (!match) {
                    return;
                }

                set({ pendingSubmission: payload }, false, 'updateSubmissionProcessing');
            },

            setRepoStatus: (status) => {
                set({ repoStatus: status }, false, 'setRepoStatus');
            },

            setClonedNotice: (exerciseTitle) => {
                set({ clonedNotice: exerciseTitle }, false, 'setClonedNotice');
            },

            setDirtyPagesStatus: (status) => {
                set({ dirtyPagesStatus: status }, false, 'setDirtyPagesStatus');
            },

            clearClonedNotice: () => {
                set({ clonedNotice: null }, false, 'clearClonedNotice');
            },

            clearPendingSubmission: () => {
                set({ pendingSubmission: null }, false, 'clearPendingSubmission');
            },
        }),
        {
            name: 'ExerciseDetailStore',
            enabled: process.env.NODE_ENV === 'development',
        }
    )
);
