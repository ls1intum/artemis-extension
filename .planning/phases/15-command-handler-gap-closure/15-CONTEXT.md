# Phase 15: Command Handler Gap Closure - Context

**Gathered:** 2026-02-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement missing `openExternalLink` and `openImagePreview` extension-side command handlers so that clicking links and images in problem statements works end-to-end. The webview already sends both commands, and the message contracts are defined in messageContracts.ts. This phase wires up the handlers that receive those messages.

</domain>

<decisions>
## Implementation Decisions

### Link opening behavior
- Open links in the system's **default browser** via `vscode.env.openExternal`
- **Protocol validation**: only allow `http://` and `https://` protocols; block `javascript:`, `data:`, `file:`, etc. (defense-in-depth on top of DOMPurify)
- **Confirmation dialog**: show a **modal** `vscode.window.showInformationMessage` before opening, with the URL **truncated with ellipsis** (~80 chars)
- **"Trust this domain" option**: dialog includes a "Trust this domain" button alongside Open/Cancel
- **Trusted domain persistence**: stored in **VS Code globalState**, persists across sessions
- **No auto-trust**: all domains treated equally — Artemis server domain is NOT auto-trusted
- **Clear trusted domains**: register an `Artemis: Clear Trusted Domains` command in the command palette

### Image preview behavior
- **Data URI images**: decode to a temp file and open in **VS Code's built-in image viewer** (`vscode.commands.executeCommand('vscode.open', uri)`)
- **Remote URL images**: open in the **default browser** (avoids download complexity)
- **No confirmation dialog** for images — open immediately on click (images are content, not navigation)
- **Temp file storage**: use `context.globalStorageUri` (extension-managed, standard VS Code pattern)

### Error feedback
- **Both handlers**: show errors via `vscode.window.showErrorMessage` notification
- **Action button**: include a "Copy URL" button on link error notifications as a fallback
- **Logging**: log all errors to an Artemis output channel for debugging

### Claude's Discretion
- Exact temp file naming and cleanup strategy for image previews
- Error message wording
- Whether to add the handlers to existing UtilityCommandModule or create a new module
- Implementation of the trusted domains data structure

</decisions>

<specifics>
## Specific Ideas

- Confirmation dialog pattern is similar to VS Code's own "Do you want to open external website?" prompt
- "Trust this domain" should extract just the domain from the URL for matching (not full URL)
- Copy URL action on error notifications gives users a graceful fallback when validation blocks a link

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 15-command-handler-gap-closure*
*Context gathered: 2026-02-25*
