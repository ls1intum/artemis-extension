// extension/test/unit/services/struggle/scenarios/scenarios.test.ts
import * as assert from 'assert';

import { runScenario } from './scenarioRunner';
import { SCENARIOS } from './scenarios';

suite('struggle engine v3 scenarios', () => {
    for (const scenario of SCENARIOS) {
        test(`[${scenario.category}] ${scenario.id}`, () => {
            const { alerts, ticks } = runScenario(scenario);
            const times = alerts.map(a => a.t);
            if (scenario.expected.noAlerts) {
                assert.deepStrictEqual(times, [], `expected no alerts, got ${times.join(', ')}`);
            }
            if (scenario.expected.alertTimes) {
                assert.deepStrictEqual(times, scenario.expected.alertTimes);
            }
            const finalV = ticks[ticks.length - 1]?.v ?? 0;
            if (scenario.expected.finalVBelow !== undefined) {
                assert.ok(finalV < scenario.expected.finalVBelow, `final V ${finalV} not < ${scenario.expected.finalVBelow}`);
            }
            if (scenario.expected.finalVAtLeast !== undefined) {
                assert.ok(finalV >= scenario.expected.finalVAtLeast, `final V ${finalV} not >= ${scenario.expected.finalVAtLeast}`);
            }
        });
    }
});
