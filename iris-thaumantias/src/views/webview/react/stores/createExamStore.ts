import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

interface ExamBaseState {
    isLoading: boolean;
    error: string | null;
}

interface ExamBaseActions {
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
    reset: () => void;
}

type StateSetter<S> = (partial: S | Partial<S> | ((state: S) => S | Partial<S>), replace?: false, action?: string) => void;

/**
 * Creates a Zustand exam store with shared isLoading/error state and devtools.
 *
 * @param name - DevTools store name
 * @param initialExtra - Domain-specific initial state (merged with isLoading/error)
 * @param extraActions - Factory receiving `set` that returns domain-specific actions
 */
export function createExamStore<
    TExtra extends Record<string, unknown>,
    TActions extends Record<string, (...args: never[]) => void>,
>(
    name: string,
    initialExtra: TExtra,
    extraActions: (
        set: StateSetter<ExamBaseState & TExtra>,
    ) => TActions,
) {
    type FullState = ExamBaseState & TExtra & ExamBaseActions & TActions;

    const initialState: ExamBaseState & TExtra = {
        isLoading: true,
        error: null,
        ...initialExtra,
    };

    return create<FullState>()(
        devtools(
            (rawSet) => {
                // Narrow `set` so callers only need to supply state fields
                const set = rawSet as unknown as StateSetter<ExamBaseState & TExtra>;

                return {
                    ...initialState,

                    setLoading: (loading: boolean) => set({ isLoading: loading } as Partial<ExamBaseState & TExtra>, false, 'setLoading'),
                    setError: (error: string | null) => set({ error, isLoading: false } as Partial<ExamBaseState & TExtra>, false, 'setError'),
                    reset: () => set(initialState, false, 'reset'),

                    ...extraActions(set),
                } as FullState;
            },
            {
                name,
                enabled: process.env.NODE_ENV === 'development',
            },
        ),
    );
}
