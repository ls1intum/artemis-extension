import { create } from 'zustand';

export interface BreadcrumbSegment {
    label: string;
    view: string;
    onClick: () => void;
}

interface NavigationState {
    breadcrumbs: BreadcrumbSegment[];
    pushBreadcrumb: (label: string, view: string, navigateFn: () => void) => void;
    popToBreadcrumb: (index: number) => void;
    clearBreadcrumbs: () => void;
}

/**
 * Abbreviate label if too long (truncate to 17 chars + '...')
 */
function abbreviateLabel(label: string): string {
    if (label.length > 20) {
        return label.substring(0, 17) + '...';
    }
    return label;
}

export const useNavigationStore = create<NavigationState>((set, get) => ({
    breadcrumbs: [],

    pushBreadcrumb: (label: string, view: string, navigateFn: () => void) => {
        const abbreviatedLabel = abbreviateLabel(label);
        set((state) => ({
            breadcrumbs: [
                ...state.breadcrumbs,
                {
                    label: abbreviatedLabel,
                    view,
                    onClick: navigateFn,
                },
            ],
        }));
    },

    popToBreadcrumb: (index: number) => {
        const state = get();
        const targetSegment = state.breadcrumbs[index];

        if (targetSegment) {
            // Slice to target index + 1
            set({ breadcrumbs: state.breadcrumbs.slice(0, index + 1) });
            // Call the onClick handler to navigate
            targetSegment.onClick();
        }
    },

    clearBreadcrumbs: () => {
        set({ breadcrumbs: [] });
    },
}));
