/**
 * Public surface of the golden-replay harness, consumed by the dataset suite and
 * the tick/alert comparator.
 */
export type { CausalReport, ExactReport } from './goldenCompare';
export { compareExact, summarizeCausal } from './goldenCompare';
export type {
    GoldenAlert, GoldenInject, GoldenSession, GoldenTick,
} from './goldenTypes';
export { parseGoldenSession } from './goldenTypes';
export { assertSpecConstants } from './invariants';
export type { ReplayOpts, ReplayResult } from './struggleReplay';
export { replaySession } from './struggleReplay';
