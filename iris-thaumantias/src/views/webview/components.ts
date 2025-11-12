// Webview-compatible component exports
// This file is bundled separately for use in the webview runtime

import { BadgeComponent, BadgeOptions } from '../components/badge/badgeComponent';
import { ButtonComponent, ButtonOptions } from '../components/button/buttonComponent';
import { CloseButton, FullscreenButton } from '../components/button/iconButtons';

// Make components available globally in webview
declare global {
    interface Window {
        BadgeComponent: typeof BadgeComponent;
        ButtonComponent: typeof ButtonComponent;
        CloseButton: typeof CloseButton;
        FullscreenButton: typeof FullscreenButton;
    }
}

// Export to window for webview access (using globalThis for type safety)
(globalThis as any).BadgeComponent = BadgeComponent;
(globalThis as any).ButtonComponent = ButtonComponent;
(globalThis as any).CloseButton = CloseButton;
(globalThis as any).FullscreenButton = FullscreenButton;

// Also export for module usage
export { BadgeComponent, ButtonComponent, CloseButton, FullscreenButton };
export type { BadgeOptions, ButtonOptions };
