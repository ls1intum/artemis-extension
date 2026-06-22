import * as assert from 'assert';

import { ObservationRegistry } from '@extension/services/recording/observation/observationRegistry';
import { SELECTION_DEBOUNCE_MS } from '@extension/services/struggle/config';

suite('struggle intake debounce parity with the recorder', () => {
    // v3 no longer consumes the visibleRange stream (dropped N4 scroll feature),
    // so only the selection debounce must still mirror the recorder's.
    test('selection debounce constant matches observationRegistry', () => {
        assert.strictEqual(SELECTION_DEBOUNCE_MS, ObservationRegistry.SELECTION_DEBOUNCE_MS);
    });
});
