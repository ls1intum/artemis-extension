import type { SlotDebugSnapshot } from '@shared/messageContracts';

import { useEngineNow } from './useEngineCountdowns';

/** Per-second interpolated countdown to the idle silent-free, anchored on snapshot.nowMs. */
export function useSlotCountdowns(snapshot: SlotDebugSnapshot): { staleLeft: number | null } {
    const now = useEngineNow(snapshot.nowMs);
    const sd = snapshot.watchdog.staleDeadlineMs;
    const staleLeft = sd === null ? null : Math.max(0, (sd - now) / 1000);
    return { staleLeft };
}
