// extension/test/unit/services/struggle/scenarios/scenarios.ts
import type { Scenario } from './scenarioRunner';

export const SCENARIOS: Scenario[] = [
    {
        id: 'idle-reading-after-warmup',
        category: 'obvious',
        description: 'No typing at all: severity rises to 1.0; STATE boundary fires at the first warmup-free tick.',
        durationS: 740,
        events: [],
        // Derivation (v3 2-feature): idle S = (1 + 1)/2 = 1.0 >= theta(0.7) from
        // t=40 on; warmup blocks STATE until 480; first free tick 490 (armed),
        // then E6 every 120 s. (v2 was S=0.7 at theta 0.6; same alert timeline,
        // which is gated by warmup+cooldown, not by the exact V-crossing tick.)
        expected: { alertTimes: [490, 610, 730] },
    },
    {
        id: 'stuck-then-failing-build',
        category: 'obvious',
        description: 'Typing until 300 s, then stuck; bad build at 400 s breaks through warmup.',
        durationS: 540,
        events: [
            { at: 0, type: 'typing', durationS: 300, charsPerSecond: 2 },
            { at: 400, type: 'build', failed: [], buildFailed: true },
        ],
        // Derivation: V >= theta from 360 (idle since 300); build at EXACTLY 400
        // belongs to tick 400 (first tick >= ts). FM at tick 400 alerts (warmup
        // breakthrough, armed; grace 400-400=0 keeps FM itself). Cooldown 120 ->
        // next eligible 520; e6 (in_state_since=360, 520-360 >= 120) -> alert 520.
        expected: { alertTimes: [400, 520] },
    },
    {
        id: 'fluent-development',
        category: 'no-struggle',
        description: 'Continuous fluent typing, one improving build: no alerts, severity stays low.',
        durationS: 600,
        events: [
            { at: 0, type: 'typing', durationS: 600, charsPerSecond: 2 },
            { at: 200, type: 'build', failed: [] },
        ],
        // typing 120/min (v3 2-feature): fTyping 0; gap 0.5/40 ~ 0.0125 -> S ~ 0.006.
        expected: { noAlerts: true, finalSBaseBelow: 0.2 },
    },
    {
        id: 'warmup-quiet-session',
        category: 'no-struggle',
        description: 'Idle but the session ends inside warmup: STATE never becomes alert-eligible.',
        durationS: 470,
        events: [],
        expected: { noAlerts: true },
    },
    {
        id: 'first-build-is-not-improved',
        category: 'subtle',
        description: 'The FIRST build (delta=first) never starts fast decay; a terminal run inside cooldown stays silent.',
        durationS: 560,
        events: [
            { at: 490, type: 'build', failed: [] },        // improved (first build, 0 failures -> delta=first, NOT improved!)
            { at: 530, type: 'terminalRun' },
        ],
        // CAREFUL derivation: the FIRST build has delta='first' (improved=false).
        // To get an improved build, a worse baseline must exist: see next scenario.
        // Here delta='first' with 0 failures: no FM, non-improved -> hl stays 120.
        // Idle: alert already at 490 (armed, STATE). Terminal run at 530: tick 540,
        // cooldown (540-490=50 < 120) blocks. Expected: only the 490 alert by 560.
        expected: { alertTimes: [490] },
    },
    {
        id: 'improved-build-under-idle-support',
        category: 'subtle',
        description: 'Fast decay alone cannot drop V while S stays high (idle); the E4 after an e6 re-alert is cooldown-blocked.',
        durationS: 700,
        events: [
            { at: 485, type: 'build', failed: ['a', 'b'] },   // first (failed): FM boundary
            { at: 560, type: 'build', failed: [] },           // improved (2 -> 0)
            { at: 620, type: 'terminalRun' },
        ],
        // Derivation (v3 2-feature, idle S = 1.0): alert 490 (FM and STATE present,
        // armed; FM is primary). Improved at 560: fast decay (hl 30). V(560)~1.0
        // idle; ticks 570..620: S stays 1.0 (still idle!) -> V = max(S, decayed)
        // = 1.0. Fast decay does NOT drop V below theta while the user stays idle
        // (S support). E4 at 620: tick 620, cooldown since 490 ok (130 >= 120),
        // V 1.0 >= theta(0.7), not armed,
        // in_state_since=30/40 -> e6 fires at 610 already (STATE, 610-490=120).
        // EXPECTATION needs the full trace: alerts 490 (armed), 610 (e6), and the
        // E4 at 620 is cooldown-blocked (620-610=10). By 700: next e6 at 730 > end.
        expected: { alertTimes: [490, 610] },
    },
    {
        id: 'paste-respects-grace',
        category: 'edge',
        description: 'A paste right after a bad build is grace-suppressed; FM itself already alerted.',
        durationS: 560,
        events: [
            { at: 485, type: 'build', failed: ['x'] },     // first+failed: FM (bad build)
            { at: 500, type: 'paste', chars: 40, lines: 3 },
        ],
        // CORRECTED derivation (the original [490, 610] over-derived past the
        // session end): alert 490 (FM primary, armed; FM survives grace). Paste at
        // EXACTLY 500 -> first tick >= 500 is tick 500 (not 510). At tick 500 N1 +
        // STATE are present but grace (500-485=15 <= 32.94) keeps only FM, so
        // both N1 and STATE are filtered -> no alert. Tick 510 still in grace (25 <=
        // 32.94): STATE filtered -> no alert. Ticks 520-560: grace over, STATE
        // survives, V 1.0 >= theta(0.7), but cooldown blocks every tick (t-490 < 120 for
        // all t <= 560). The next e6 re-alert (STATE; cooldown 610-490=120, e6 since
        // in_state_since=40) would only fire at tick 610 -- BEYOND this 560 s session.
        // So the only alert within the session is 490.
        expected: { alertTimes: [490] },
    },
    {
        id: 'test-stagnation-while-typing',
        category: 'subtle',
        description: 'Steady typing keeps the edit path silent (B2 + low urgency), but three builds stuck at the same passing count fire a discrete Test-Stagnation alert (breaks warmup).',
        durationS: 220,
        events: [
            // 120/min typing -> fTyping 0, urgency ~ 0, and typing_rate >= 20 so B2
            // blocks every edit boundary. The failing builds raise FM, but the edit
            // path never alerts.
            { at: 0, type: 'typing', durationS: 220, charsPerSecond: 2 },
            // Builds land exactly on grid ticks AND share each timestamp with a
            // typing char — the harness must enqueue both before that tick runs.
            { at: 60, type: 'build', failed: ['a', 'b', 'c'], passed: 2, total: 5 },
            { at: 120, type: 'build', failed: ['a', 'b', 'c'], passed: 2, total: 5 },
            { at: 180, type: 'build', failed: ['a', 'b', 'c'], passed: 2, total: 5 }, // 3rd identical (2/5) plateau -> fires at tick 180
        ],
        // The discrete add-on is NOT B2-gated and breaks warmup, so it fires at the
        // 3rd stuck build's tick (180). No edit alert ever fires (B2 + urgency < θ).
        expected: { alertTimes: [180], alertKinds: ['discrete'] },
    },
];
