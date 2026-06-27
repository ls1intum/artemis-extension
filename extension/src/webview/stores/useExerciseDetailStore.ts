import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

import { postCommand, type VsCodeApi } from '@shared/messageContracts';
import type {
    ExerciseDetailsResponse,
    ParticipationSummary,
    PendingSubmissionStatus,
    ResultSummary,
    SubmissionSummary,
} from '@shared/types/apiResponses';

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

// Re-export so existing webview callers that already import this name keep
// working. The canonical source of truth is now @shared/types/apiResponses.
export type PendingSubmissionInfo = PendingSubmissionStatus;

interface ExerciseDetailState {
    exerciseData: ExerciseDetailsResponse | null;
    hideDeveloperTools: boolean;
    isLoading: boolean;
    error: string | null;

    /**
     * Pending build statuses keyed by `participation.id`. The view picks the
     * entry that matches the participation it has selected (graded vs.
     * practice). Replaces a singleton `pendingSubmission` field that was
     * silently overwritten per participation by the loader — see #168.
     */
    pendingSubmissionsByParticipationId: Record<number, PendingSubmissionStatus>;

    // Extension→Webview response state
    repoStatus: RepoStatus | null;
    clonedNotice: { exerciseTitle: string; participationId: number } | null;
    dirtyPagesStatus: DirtyPagesStatus | null;
    /** AskIris proactive on/off control (spec §12.2), tagged with its exercise so a late update can't paint the wrong card. */
    proactiveControl: { exerciseId: number; preference: 'on' | 'off'; autoPaused: boolean } | null;

    // Actions
    setExerciseData: (data: ExerciseDetailsResponse, hideDeveloperTools: boolean, repoStatus?: RepoStatus) => void;
    setError: (error: string | null) => void;
    setLoading: (loading: boolean) => void;
    loadExerciseDetail: (vscodeApi: VsCodeApi, exerciseId: number) => void;
    updateBuildStatus: (payload: ResultSummary) => void;
    updateSubmission: (payload: SubmissionSummary) => void;
    updateSubmissionProcessing: (payload: PendingSubmissionStatus) => void;
    setRepoStatus: (status: RepoStatus) => void;
    setClonedNotice: (exerciseTitle: string, participationId: number) => void;
    setDirtyPagesStatus: (status: DirtyPagesStatus) => void;
    setProactiveControl: (control: { exerciseId: number; preference: 'on' | 'off'; autoPaused: boolean } | null) => void;
    clearClonedNotice: () => void;
    /** Clear all pending entries (e.g. on result arrival without per-participation context). */
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
            pendingSubmissionsByParticipationId: {},
            repoStatus: null,
            clonedNotice: null,
            dirtyPagesStatus: null,
            proactiveControl: null,

            setExerciseData: (data, hideDeveloperTools, repoStatus) => {
                set({
                    exerciseData: data,
                    hideDeveloperTools,
                    isLoading: false,
                    error: null,
                    // Reset the proactive control on every exercise load so the next exercise never shows the
                    // previous one's badge while its fresh state is re-requested (spec §12.2).
                    proactiveControl: null,
                    // Always reset to the freshly-loaded map (or `{}` if the
                    // server didn't supply one). Keeping stale entries across
                    // a reload would let an already-finished build keep
                    // displaying "in progress" on the next exercise open.
                    pendingSubmissionsByParticipationId:
                        data.pendingSubmissionsByParticipationId ?? {},
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

                // Clear the pending entry for the participation we actually
                // mutated. We use `participation.id` (the resolved owner)
                // rather than `payload.participationId` so a malformed or
                // mismatched payload never deletes an unrelated key.
                // Other participations' pending builds are preserved — they
                // were unaffected by this result.
                const clearedParticipationId = participation.id;
                const nextPending = { ...state.pendingSubmissionsByParticipationId };
                if (clearedParticipationId !== undefined) {
                    delete nextPending[clearedParticipationId];
                }

                set({
                    exerciseData: updatedData,
                    pendingSubmissionsByParticipationId: nextPending,
                }, false, 'updateBuildStatus');
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

                set({
                    pendingSubmissionsByParticipationId: {
                        ...state.pendingSubmissionsByParticipationId,
                        [payload.participationId]: payload,
                    },
                }, false, 'updateSubmissionProcessing');
            },

            setRepoStatus: (status) => {
                set({ repoStatus: status }, false, 'setRepoStatus');
            },

            setClonedNotice: (exerciseTitle, participationId) => {
                set({ clonedNotice: { exerciseTitle, participationId } }, false, 'setClonedNotice');
            },

            setDirtyPagesStatus: (status) => {
                set({ dirtyPagesStatus: status }, false, 'setDirtyPagesStatus');
            },

            setProactiveControl: (control) => {
                set({ proactiveControl: control }, false, 'setProactiveControl');
            },

            clearClonedNotice: () => {
                set({ clonedNotice: null }, false, 'clearClonedNotice');
            },

            clearPendingSubmission: () => {
                set({ pendingSubmissionsByParticipationId: {} }, false, 'clearPendingSubmission');
            },
        }),
        {
            name: 'ExerciseDetailStore',
            enabled: process.env.NODE_ENV === 'development',
        }
    )
);
