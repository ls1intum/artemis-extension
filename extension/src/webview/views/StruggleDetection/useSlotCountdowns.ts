import type { SlotDebugSnapshot } from '@shared/messageContracts';

import { useEngineNow } from './useEngineCountdowns';

/** Per-second interpolated countdowns for the slot panel, anchored on snapshot.nowMs. */
export function useSlotCountdowns(snapshot: SlotDebugSnapshot): { staleLeft: number | null; abandonLeft: number | null } {
    const now = useEngineNow(snapshot.nowMs);
    const sd = snapshot.watchdog.staleDeadlineMs;
    const ad = snapshot.abandon.deadlineMs;
    const staleLeft = sd === null ? null : Math.max(0, (sd - now) / 1000);
    const abandonLeft = ad === null ? null : Math.max(0, (ad - now) / 1000);
    return { staleLeft, abandonLeft };
}
