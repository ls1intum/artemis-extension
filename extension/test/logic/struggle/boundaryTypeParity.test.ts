import { expect, test } from 'vitest';

import { BOUNDARY_TYPES } from '@shared/messageContracts';
import { BOUNDARY_PRIORITY } from '@extension/services/struggle/config';

test('shared BOUNDARY_TYPES matches the engine BOUNDARY_PRIORITY', () => {
    expect([...BOUNDARY_TYPES]).toEqual([...BOUNDARY_PRIORITY]);
});
