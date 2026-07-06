import { useRef, useState } from 'react';

import type { VsCodeApi } from '@shared/messageContracts';
import { ExtensionMsg, postCommand, WebviewCmd } from '@shared/messageContracts';

import { useExtensionMessage } from '@webview/hooks/useExtensionMessage';

import styles from './NudgeBanner.module.css';

interface NudgeBannerProps {
    vscodeApi: VsCodeApi;
}

interface BannerState {
    title: string;
    sub: string;
    episodeId?: string;
    timerMs: number;
}

type BannerAction = 'showMe' | 'dismiss' | 'timeout';

/**
 * Bottom-fixed "glass" overlay nudging a struggling student towards Iris. Hidden until a
 * `showNudgeBanner` message arrives; a CSS countdown bar auto-closes it after `timerMs`.
 */
export function NudgeBanner({ vscodeApi }: NudgeBannerProps) {
    const [banner, setBanner] = useState<BannerState | null>(null);
    // Read once: the extension injects this on the root element at webview-html build time.
    const [logoUri] = useState(() => document.getElementById('root')?.getAttribute('data-iris-logo-uri') ?? '');
    // Restarts the countdown-bar animation on every show, even a re-show of the same episode.
    const showCounter = useRef(0);

    useExtensionMessage((msg) => {
        switch (msg.type) {
            case ExtensionMsg.ShowNudgeBanner: {
                showCounter.current += 1;
                setBanner({ title: msg.title, sub: msg.sub, episodeId: msg.episodeId, timerMs: msg.timerMs });
                break;
            }
            case ExtensionMsg.HideNudgeBanner: {
                setBanner(null);
                break;
            }
        }
    }, []);

    if (!banner) {
        return null;
    }

    const act = (action: BannerAction) => {
        setBanner(null);
        postCommand(vscodeApi, WebviewCmd.NudgeBannerAction, { action, episodeId: banner.episodeId });
    };

    return (
        <div className={styles.banner}>
            <button type="button" className={styles.closeBtn} aria-label="Dismiss nudge" onClick={() => act('dismiss')}>
                &times;
            </button>
            <div className={styles.row}>
                <img className={styles.logo} src={logoUri} alt="" />
                <div className={styles.textCol}>
                    <div className={styles.title}>{banner.title}</div>
                    <div className={styles.sub}>{banner.sub}</div>
                </div>
            </div>
            <div className={styles.actions}>
                <button type="button" className={styles.ghostBtn} onClick={() => act('dismiss')}>Not now</button>
                <button type="button" className={styles.primaryBtn} onClick={() => act('showMe')}>Show me</button>
            </div>
            <div
                key={`${banner.episodeId ?? 'none'}-${showCounter.current}`}
                className={styles.countdown}
                data-testid="nudge-countdown"
                style={{ animationDuration: `${banner.timerMs}ms` }}
                onAnimationEnd={() => act('timeout')}
            />
        </div>
    );
}
