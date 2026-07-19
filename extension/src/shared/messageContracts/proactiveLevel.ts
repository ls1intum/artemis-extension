/**
 * Proactivity level for the "Ask Iris" Off/Less/More control (spec §12.2), a single remembered
 * level (issue #341). `off` disables proactive help; `less` and `more` both mean enabled (the
 * split in how proactive help behaves at each enabled level is wired downstream). Default is `more`.
 *
 * Canonical, single definition: imported by both the webview (AskIris) and the extension
 * host (ProactivePreferenceService). Zero runtime imports so it stays out of the Open VSX
 * "clean" bundle's forbidden subtrees.
 */
export type ProactiveLevel = 'off' | 'less' | 'more';
