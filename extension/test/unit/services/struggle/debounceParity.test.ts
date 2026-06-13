import * as assert from 'assert';

import { ObservationRegistry } from '@extension/services/recording/observation/observationRegistry';
import { SELECTION_DEBOUNCE_MS, VISIBLE_RANGE_DEBOUNCE_MS } from '@extension/services/struggle/constants';

suite('struggle intake debounce parity with the recorder', () => {
    test('selection and visibleRange debounce constants match observationRegistry', () => {
        assert.strictEqual(SELECTION_DEBOUNCE_MS, ObservationRegistry.SELECTION_DEBOUNCE_MS);
        assert.strictEqual(VISIBLE_RANGE_DEBOUNCE_MS, ObservationRegistry.VISIBLE_RANGE_DEBOUNCE_MS);
    });
});
