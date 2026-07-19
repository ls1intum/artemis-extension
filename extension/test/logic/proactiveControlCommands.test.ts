import { describe, expect, it, vi } from 'vitest';

import { ExtensionMsg, WebviewCmd } from '@shared/messageContracts';

import { ProactiveControlCommandModule } from '@extension/controller/commands/proactiveControlCommands';

function harness(over: {
    level?: 'off' | 'less' | 'more';
    consentMissing?: boolean;
    serverUnavailable?: boolean;
    noAi?: boolean;
    settings?: unknown;
    profileActive?: boolean;
} = {}) {
    const pref = { getLevel: vi.fn(() => over.level ?? 'more'), setLevel: vi.fn() };
    const control = {
        setStudentProactive: vi.fn(),
        getProactiveGateState: vi.fn(() => ({
            consentMissing: over.consentMissing ?? false,
            serverUnavailable: over.serverUnavailable ?? false,
        })),
    };
    const artemisApi = {
        getProfileInfo: vi.fn(async () => ({})),
        isIrisProfileActive: vi.fn(() => over.profileActive ?? true),
        getIrisCourseChatSettings: vi.fn(async () =>
            over.settings ?? { settings: { enabled: true, proactiveStruggleEnabled: true } }),
    };
    const collapse = vi.fn();
    const providerRegistry = {
        getChatWebviewProvider: vi.fn(() => ({ isNoAiEnabled: () => over.noAi ?? false, whenNoAiReady: async () => {}, collapseProactiveEpisodes: collapse })),
    };
    const sent: any[] = [];
    const ctx = { proactivePreference: pref, proactiveControl: control, artemisApi, providerRegistry, sendMessage: (m: any) => sent.push(m) } as any;
    return { mod: new ProactiveControlCommandModule(ctx), pref, control, artemisApi, sent, collapse };
}
const cmd = (command: string, payload: any) => ({ command, payload } as any);

describe('ProactiveControlCommandModule', () => {
    it('request pushes the current level', async () => {
        const h = harness({ level: 'less' });
        await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42 }));
        expect(h.sent[0]).toMatchObject({ type: ExtensionMsg.UpdateProactiveControl, exerciseId: 42, level: 'less' });
    });

    it('setLevel(off) persists + applies + re-pushes', async () => {
        const h = harness({ level: 'off' });
        await h.mod.getHandlers()[WebviewCmd.SetProactiveLevel](cmd('setProactiveLevel', { exerciseId: 42, level: 'off' }));
        expect(h.pref.setLevel).toHaveBeenCalledWith(42, 'off');
        expect(h.control.setStudentProactive).toHaveBeenCalledWith(42, false);
        expect(h.sent[0]).toMatchObject({ level: 'off' });
    });

    it('setLevel(less/more) applies proactive=true (only "off" disables)', async () => {
        const h = harness({ level: 'more' });
        await h.mod.getHandlers()[WebviewCmd.SetProactiveLevel](cmd('setProactiveLevel', { exerciseId: 42, level: 'less' }));
        expect(h.pref.setLevel).toHaveBeenCalledWith(42, 'less');
        expect(h.control.setStudentProactive).toHaveBeenCalledWith(42, true);
    });

    it('setLevel(off) collapses the proactive episodes in the chat', async () => {
        const h = harness({ level: 'off' });
        await h.mod.getHandlers()[WebviewCmd.SetProactiveLevel](cmd('setProactiveLevel', { exerciseId: 42, level: 'off' }));
        expect(h.collapse).toHaveBeenCalledTimes(1);
    });

    it('setLevel(less/more) does NOT collapse the chat episodes', async () => {
        const h = harness({ level: 'more' });
        await h.mod.getHandlers()[WebviewCmd.SetProactiveLevel](cmd('setProactiveLevel', { exerciseId: 42, level: 'more' }));
        expect(h.collapse).not.toHaveBeenCalled();
    });

    it('pushes nothing when there is no proactive engine (clean build → switch stays hidden)', async () => {
        const sent: any[] = [];
        const pref = { getLevel: vi.fn(() => 'more'), setLevel: vi.fn() };
        const ctx = { proactivePreference: pref, proactiveControl: undefined, sendMessage: (m: any) => sent.push(m) } as any;
        const mod = new ProactiveControlCommandModule(ctx);
        await mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42 }));
        expect(sent).toHaveLength(0);
    });

    // ── Slice 5c: card-state derivation ────────────────────────────────────
    it('all signals ok (with courseId) → available', async () => {
        const h = harness({});
        await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42, courseId: 7 }));
        expect(h.sent.at(-1)).toMatchObject({ exerciseId: 42, cardState: 'available' });
    });

    it('.noai → unavailable/noai', async () => {
        const h = harness({ noAi: true });
        await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42, courseId: 7 }));
        expect(h.sent.at(-1)).toMatchObject({ cardState: 'unavailable', cardReason: 'noai' });
    });

    it('course proactive off → off-course (level masked to Off: proactive cannot run)', async () => {
        const h = harness({ level: 'more', settings: { settings: { enabled: true, proactiveStruggleEnabled: false } } });
        await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42, courseId: 7 }));
        expect(h.sent.at(-1)).toMatchObject({ cardState: 'off-course', cardReason: 'course-off', level: 'off' });
    });

    it('iris disabled (settings.enabled=false) → unavailable/iris-off', async () => {
        const h = harness({ settings: { settings: { enabled: false } } });
        await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42, courseId: 7 }));
        expect(h.sent.at(-1)).toMatchObject({ cardState: 'unavailable', cardReason: 'iris-off' });
    });

    it('404-latched server → degraded/limited (level masked to Off: proactive cannot run)', async () => {
        const h = harness({ level: 'more', serverUnavailable: true });
        await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42, courseId: 7 }));
        expect(h.sent.at(-1)).toMatchObject({ cardState: 'degraded', cardReason: 'limited', level: 'off' });
    });

    it('no courseId → optimistic available (availability fetch skipped, self-heals next push)', async () => {
        const h = harness({});
        await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42 }));
        expect(h.artemisApi.getIrisCourseChatSettings).not.toHaveBeenCalled();
        expect(h.sent.at(-1)).toMatchObject({ cardState: 'available' });
    });

    it('missing consent → forced Off + consent-missing reason (stored preference untouched)', async () => {
        const h = harness({ level: 'more', consentMissing: true });
        await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42, courseId: 7 }));
        expect(h.sent.at(-1)).toMatchObject({ level: 'off', cardState: 'degraded', cardReason: 'consent-missing' });
        expect(h.pref.setLevel).not.toHaveBeenCalled();
    });

    it('missing consent + 404 latch → limited reason wins, mask still forces Off (orthogonality end-to-end)', async () => {
        const h = harness({ level: 'more', consentMissing: true, serverUnavailable: true });
        await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42, courseId: 7 }));
        expect(h.sent.at(-1)).toMatchObject({ level: 'off', cardState: 'degraded', cardReason: 'limited' });
    });

    it('course-off + missing consent → course reason wins, mask still forces Off', async () => {
        const h = harness({ level: 'more', consentMissing: true, settings: { settings: { enabled: true, proactiveStruggleEnabled: false } } });
        await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42, courseId: 7 }));
        expect(h.sent.at(-1)).toMatchObject({ level: 'off', cardState: 'off-course', cardReason: 'course-off' });
    });

    for (const level of ['off', 'less', 'more'] as const) {
        it(`setLevel(${level}) while consent missing: dropped (no store write, no engine call, no collapse) but re-pushed`, async () => {
            const h = harness({ level: 'more', consentMissing: true });
            await h.mod.getHandlers()[WebviewCmd.SetProactiveLevel](cmd('setProactiveLevel', { exerciseId: 42, level, courseId: 7 }));
            expect(h.pref.setLevel).not.toHaveBeenCalled();
            expect(h.control.setStudentProactive).not.toHaveBeenCalled();
            expect(h.collapse).not.toHaveBeenCalled();
            expect(h.sent.at(-1)).toMatchObject({ level: 'off', cardReason: 'consent-missing' });
        });
    }

    it('grant restores the remembered level (store was never overwritten)', async () => {
        const h = harness({ level: 'more', consentMissing: true });
        await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42, courseId: 7 }));
        expect(h.sent.at(-1)).toMatchObject({ level: 'off' });
        h.control.getProactiveGateState.mockReturnValue({ consentMissing: false, serverUnavailable: false });
        await h.mod.getHandlers()[WebviewCmd.RequestProactiveControl](cmd('requestProactiveControl', { exerciseId: 42, courseId: 7 }));
        expect(h.sent.at(-1)).toMatchObject({ level: 'more', cardState: 'available' });
    });
});
