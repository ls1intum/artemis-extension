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
            if (scenario.expected.alertKinds) {
                assert.deepStrictEqual(alerts.map(a => a.kind), scenario.expected.alertKinds);
            }
            const finalS = ticks[ticks.length - 1]?.s ?? 0;
            if (scenario.expected.finalSBelow !== undefined) {
                assert.ok(finalS < scenario.expected.finalSBelow, `final S ${finalS} not < ${scenario.expected.finalSBelow}`);
            }
        });
    }
});
