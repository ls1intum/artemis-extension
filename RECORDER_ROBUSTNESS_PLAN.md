# Recorder Robustness Fix Plan

Status: Draft v3.3 for review. Do not start implementation before approval.

## Context

Smell-Test plus Cross-Review mit Codex hat rund 15 echte Lücken im Session-Recording-Modul aufgedeckt. Der Recorder ist aktuell ein best-effort Event-Log, kein belastbares Session-Recording. Dieser Plan strukturiert die Fixes in atomare Blöcke (jeder = eine PR), gruppiert nach Severity und so geschnitten, dass jeder Block einzeln reviewbar und revertbar ist.

Dieser Plan ist v3.3. Review-Historie:
- v1 verworfen: Lifecycle-Races, EQ-Seeding-Heuristik.
- v2 verworfen: disable-Mutex-Blockierung, EventEmitter-EQ-Seed, Sync-Fallback-Duplikate, Guard-Duplication.
- v3 verworfen: Startup-Events durch eigene Guards blockiert, disable-vs-ending-Inkonsistenz, rawWanted-vs-low-confidence-Widerspruch, TelemetryManager-Routing.
- v3.1 verworfen: disable()+_doEnd-Guard-Konflikt, Start-Abort überschreibt disabled.
- v3.2 verworfen: keine Commit-Grenze zwischen "sessionStart geschrieben" und "nicht geschrieben".
- v3.3 fixt Commit-Grenze mit `_sessionStartWritten`-Flag und definiert pre- vs. post-commit Abort-Semantik.

Grundlegende Konzepte:
- Blocks A und B fusioniert zu **Block AB (Lifecycle-FSM)**. Start/End/Disable/Cancel gehören zusammen.
- **Recorder-Phase-FSM**: `idle | starting | recording | ending | disabling | disabled`. Pro Phase sind unterschiedliche Event-Schreibpfade erlaubt. Phase `disabling` erlaubt `consentChange`/`sessionEnd`-Finalize während Consent-Disable, **blockiert aber öffentliche Record-Methoden**. Phase `disabled` ist Endzustand — keine Events mehr, kein Finalize.
- **Commit-Grenze `_sessionStartWritten`**: Vor dem Schreiben von `sessionStart` ist die Session nicht committed — Abort darf `writer.abort()` aufrufen und löscht das halb-initialisierte Verzeichnis. **Nach** `sessionStart` ist die Session committed — kein `writer.abort()` mehr, sondern sauberes `sessionEnd` via Finalize-Pfad. Die Commit-Grenze bestimmt, ob Cleanup oder Finalize läuft.
- **Session-Generation-Token** für alle async In-flight-Operationen.
- **Nicht-blockierendes Disable**: `_isEnabled=false` wird **synchron** im öffentlichen `disable()`-Call gesetzt, **bevor** der Mutex greift. Cleanup läuft dann gemutexed. Consent-Entzug ist damit sofort wirksam.
- **Startup-Contributors** statt EventEmitter für EQ-Seeding: Wiring registriert synchron eine Contributor-Funktion, die der Recorder im `_doStart` aufruft. Kein Race mit subscribe-timing.
- **`_recordInternal`** mit Options-Objekt `{ allowDuringStartup?, allowDuringEnding? }`: erlaubt gezielt Events in den Phasen `starting` bzw. `ending`. Öffentliche `_record`-Methoden bleiben auf `phase === 'recording'` beschränkt.
- **Consent-Downgrade → Option A (GDPR-strikt)**: Bei `disable()` werden pending Debounce-Payloads **nicht** mehr geschrieben. Nur `consentChange` + `sessionEnd` gehen raus. Bei regulärem `endSession()`/`deactivate()` werden pending Debounces geflusht (User-Intent, kein Consent-Entzug).
- **Shared-Guard-Helper** `shouldAcceptBuildResult()` — keine Duplikation der TelemetryManager-Guards.
- **Raw-vs-Final-Decision** in Interventions: `rawWanted` = nur EQ-Threshold (ohne Confidence). `shouldIntervene` = nach Confidence + Guardrails. `blocked`-Event nur wenn `rawWanted && !shouldIntervene`, mit `blockedReason` (Confidence ist **ein** möglicher Reason).
- **TelemetryManager-Routing**: Bei `rawWanted && !shouldIntervene` wird **nicht** `showXxxEQ` aufgerufen, sondern `interventionService.recordBlockedDecision(decision)`. Nur bei `shouldIntervene=true` geht es in den Show-Pfad.
- Durability klar: Block D fixt **graceful-shutdown-Verlust**, nicht Extension-Host-Crashes. Residual-Risiko explizit.
- Sync-Fallback NICHT auf aktiven async Flushes — vermeidet Duplikate. Details in Block D.5.
- JSONL-Format-Version (`schemaVersion: 2` in `metadata.json` und im `sessionStart`-Event). Precedence-Regel definiert. Viewer normalisiert.
- Alle Schema-Änderungen sind additiv; kein Bruch für bestehende Recordings.
- Viewer-Fixtures unter `recording-viewer/test/fixtures/recordings/`. Vitest wird neu eingeführt.

Referenz-Dateien:
- `extension/src/extension/services/telemetry/recording/sessionRecorder.ts`
- `extension/src/extension/services/telemetry/recording/storageWriter.ts`
- `extension/src/extension/services/telemetry/recording/eventCollectors.ts`
- `extension/src/extension/services/telemetry/recording/types.ts`
- `extension/src/extension/activation/sessionRecorderWiring.ts`
- `extension/src/extension/services/telemetry/interventionService.ts`
- `extension/src/extension/services/telemetry/telemetryManager.ts`
- `extension/src/extension/services/telemetry/eventPipeline/compileEquivalentEmitter.ts`
- `extension/src/extension/services/telemetry/replay/snapshotReconstructor.ts`
- `extension/src/extension.ts` (deactivate-Hook)
- `recording-viewer/src/parseSession.ts` (Viewer-Parser)
- `recording-viewer/src/generated/recordingTypes.ts` (Viewer-Typen, generiert)
- `recording-viewer/src/components/EventStream.tsx`, `TrackingTimeline.tsx`, `RecordingInfo.tsx`

## Scope dieser PR

Diese PR enthält **nur diesen Plan**. Nach Freigabe werden die Fixes blockweise implementiert (separate PRs vom `dev`-Branch).

## JSONL-Schema-Versionierung

Vor allem anderen: Schema-Version einführen.

- `SessionMetadata` bekommt `schemaVersion: 2` und optional `recorderVersion: string` (aus `package.json` der Extension).
- `SessionStartEvent` bekommt `schemaVersion: 2`, damit `events.jsonl` auch ohne `metadata.json` parsebar ist.
- **Precedence-Regel**: Wenn beide Felder gesetzt sind, gewinnt `metadata.schemaVersion`. Wenn `metadata.json` fehlt oder kein Feld hat, gilt `sessionStart.schemaVersion`. Fehlen beide → `1` (Legacy).
- Viewer (`parseSession.ts`) hat eine zentrale Funktion `resolveSchemaVersion(metadata, firstEvent): number`. Das Resultat wird in `loadedSession.schemaVersion` gespeichert und nirgendwo sonst neu erraten.
- Viewer mappt alte Formate defensiv (insbesondere `failedTests: string[]` aus V1 auf `failedTestDetails`-Leere in V2).
- Codegenerierung in `recording-viewer/src/generated/recordingTypes.ts` muss mit der neuen Event-Union synchron gehalten werden — die Generator-Pipeline ist Teil der Aufgabe jedes Blocks, der Events/Fields hinzufügt. Aktuelle Pipeline prüfen (siehe "Offene Entscheidungen").

## Fix-Blöcke

### Block AB — Lifecycle-FSM mit Session-Token (P0)

Fusion von ursprünglich A (atomarer Start) und B (synchrones Disable/End), weil die Races zusammenhängen.

**Problem AB.1 (Ordering)**: `_isRecording = true` vor `_captureOpenFileSnapshots()`/`_captureInitialDiagnostics()` führt dazu, dass Listener-Events vor `sessionStart` und zwischen Snapshots im JSONL landen.

**Problem AB.2 (EQ-Seed-Heuristik)**: Wiring seedet `eqEngineState` bei `state.eventCount <= 1` (sessionRecorderWiring.ts:97). Nach jedem Ordering-Fix, der Initial-State-Events schreibt, ist `eventCount > 1` und das Seeding fällt aus.

**Problem AB.3 (Disable-Race)**: `disable()` → `void endSession()` ist fire-and-forget. `_isRecording` bleibt bis nach `writeMetadata` true. Events können nach Consent-Entzug geschrieben werden (GDPR-Risiko).

**Problem AB.4 (Concurrent start/disable)**: Wenn Consent während eines laufenden `startSession()` (zwischen `await initSession` und `_isRecording=true`) entzogen wird, beendet `disable()` keine Session, weil sie noch nicht als "recording" gilt. `startSession()` läuft weiter und aktiviert Recording nach Consent-Entzug.

**Problem AB.5 (In-flight snapshot)**: `_snapshotDocument()` ruft nach `await writeSnapshot()` ohne Guard `_record(fileSnapshot)` (sessionRecorder.ts:499). Eine Snapshot-Operation, die vor `endSession` gestartet wurde, kann nach `sessionEnd` noch ein Event anhängen.

**Problem AB.6 (deactivate)**: `extension.ts:263` macht `void activeSessionRecorder.endSession()`. VS Code wartet nicht. Bei graceful deactivate kann Recording unvollständig enden.

**Problem AB.7 (no startSession guard)**: Öffentliche `recordXxx`-Methoden prüfen nur `_isRecording`, nicht `_isEnabled`. Semantik "nach disable keine Events mehr" ist nicht durchgezogen.

**Fix**:

1. **Recorder-Phase-FSM.** `SessionRecorder` hält `_phase: 'idle' | 'starting' | 'recording' | 'ending' | 'disabling' | 'disabled'`. Transitions laufen innerhalb des Lifecycle-Mutex (Ausnahme: `disable()` darf synchron von `{idle,starting,recording,ending}` nach `disabling` transiten). Phase `disabled` ist der finale Cleanup-Endzustand und wird nur am Ende von `_doDisable()` gesetzt. `_isRecording` und `_isEnabled` werden eliminiert und durch `_phase`-Checks ersetzt — eine Source-of-Truth.

   Erlaubte Transitions:
   - `idle → starting → recording → ending → idle` (normaler Lifecycle)
   - `{idle|starting|recording|ending} → disabling → disabled` (Consent-Entzug)
   - Von `disabled` gibt es nur `disabled → idle` via `enable()`.
   - `_isEnabled` wird als Getter `this._phase !== 'disabling' && this._phase !== 'disabled'` nachgebildet, falls externe Callsites das Flag brauchen.

2. **Session-Generation-Token.** `SessionRecorder` hält `_currentGeneration: number`. Jeder erfolgreiche Start inkrementiert. Jede async Operation (Snapshot-Capture, Shell-Output-Reader, Debounce-Callback, WebSocket-Handler) captured die Generation als lokale Variable und prüft vor jedem `_record`-Call, dass `gen === this._currentGeneration && this._phase === 'recording'` (oder 'starting'/'ending' je nach Pfad). Stimmt die Generation nicht, no-op.

3. **Lifecycle-Serialisierungs-Mutex — nur für Cleanup/Flush.** `SessionRecorder` hält `_lifecyclePromise: Promise<void>` und zusätzlich `_sessionStartWritten: boolean` + `_committedGeneration: number | undefined` als **Commit-Marker**. Die **öffentlichen** `disable()` und `startSession()`-Methoden setzen ihre "Intent"-Flags **synchron** vor dem Mutex:
   - `disable()` synchron:
     ```ts
     disable() {
         if (this._phase === 'disabled' || this._phase === 'disabling') return;
         // Commit-Boundary-Check: Nur wenn sessionStart geschrieben wurde, brauchen wir Finalize.
         const shouldFinalize = this._sessionStartWritten
             && (this._phase === 'starting' || this._phase === 'recording' || this._phase === 'ending');
         const generation = this._committedGeneration;
         this._phase = 'disabling';
         this._requestedGeneration = -1;
         this._lifecyclePromise = this._lifecyclePromise.then(() => this._doDisable({ shouldFinalize, generation }));
     }
     ```
     Danach: öffentliche Record-Methoden no-op, laufende `_doStart` bricht beim nächsten Re-Check ab — mit pre- vs. post-commit Unterscheidung (siehe Punkt 5).
   - `startSession()` synchron: `if (_phase === 'disabling' || _phase === 'disabled') return Promise.resolve();` — Start unter disabling/disabled ist sofort no-op, kein Enqueue. Dann `const requestedGen = ++this._requestedGeneration;`, dann `this._lifecyclePromise = this._lifecyclePromise.then(() => this._doStart(requestedGen, exerciseId, ...))`.
   - `_doStart(requestedGen, ...)` ist **no-op**, wenn `requestedGen !== this._requestedGeneration || _phase === 'disabling' || _phase === 'disabled'`. Damit: "latest start wins" und Cancel durch disable ist sofort wirksam.

3. **Lifecycle-Writer-Channel.** Neue private Methode `_writeLifecycleEvent(event)` schreibt direkt über `_writer.appendEvent`, bypass'd die `_isRecording`-Gate. Wird **nur** für `sessionStart`, `sessionEnd`, `consentChange`, `startupPhaseComplete`, `fileSnapshotError` verwendet. `_eventCount` wird dabei gepflegt.

4. **Startup-Contributor-API statt EventEmitter** (ersetzt v2-Punkt 4l). `SessionRecorder` exposed:
   ```ts
   registerStartupContributor(fn: (ctx: StartupContext) => RecordedEvent[]): Disposable
   ```
   Wiring registriert bei Setup synchron einen Contributor, der EQ-State liefert:
   ```ts
   sessionRecorder.registerStartupContributor((ctx) => {
       const eqState = telemetryManager.getEqEngineState();
       if (eqState.snapshots.length === 0) return [];
       return [{ type:'eqEngineState', timestamp: ctx.startTime, snapshots: [...], ... }];
   });
   ```
   Recorder ruft alle Contributors **synchron im `_doStart`** vor `startupPhaseComplete` auf und schreibt deren Events selbst (über Lifecycle-Writer). Kein Race mit Event-Subscription-Timing, kein "missed listener"-Problem. Wiring-Patch in `sessionRecorderWiring.ts:97` ersetzt den alten `onDidChangeState`-Listener.

5. **Neuer Start-Ablauf** (im `_doStart(requestedGen, ...)`, innerhalb Mutex). Der Ablauf hat **zwei Phasen**: pre-commit (vor `sessionStart`) und post-commit (ab `sessionStart`). Abort-Semantik unterscheidet sich:
   a. `if (requestedGen !== this._requestedGeneration) return;` — jüngere Start-Anfrage existiert, abbrechen (noch nichts allokiert, clean return).
   b. `if (_phase === 'disabling' || _phase === 'disabled') return;`
   c. `if (_phase === 'recording') await this._doEnd('user-end');` — vorherige Session sauber beenden.
   d. `_phase = 'starting';` — jetzt sind Startup-Writes erlaubt.
   e. `_sessionStartWritten = false;` zurücksetzen. Session-IDs, Timer, State setzen (synchron).
   f. `await _writer.initSession(sessionId)`.
   g. **Pre-commit Re-Check** (nach `initSession`-await, vor `sessionStart`-Write):
      ```ts
      if (requestedGen !== this._requestedGeneration) {
          // Neuer Start oder disable lief parallel. Session noch nicht committed.
          if (this._phase === 'starting') this._phase = 'idle';
          await this._writer.abort();  // räumt halb-initialisiertes Verzeichnis auf
          return;
      }
      if (this._phase === 'disabling' || this._phase === 'disabled') {
          // disable war schneller. Session noch nicht committed → kein Finalize, nur abort.
          await this._writer.abort();
          return;  // _doDisable sieht shouldFinalize=false (weil _sessionStartWritten=false)
      }
      ```
   h. `_currentGeneration = requestedGen` (aktivieren).
   i. **Commit-Point**: `_writeLifecycleEvent({type:'sessionStart', schemaVersion:2, ...})`. Direkt danach: `_sessionStartWritten = true; _committedGeneration = requestedGen;`
   j. `await _captureOpenFileSnapshots(requestedGen)` — jeder `fileSnapshot` wird via `_recordInternal(event, { allowDuringStartup: true }, requestedGen)` geschrieben. Generation-Token sichert gegen parallel disable.
   k. **Post-commit Re-Check** — **kein writer.abort() mehr, Session ist committed**. Phase-Check zuerst, weil `disable()` auch `_requestedGeneration` ändert:
      ```ts
      if (this._phase === 'disabling' || this._phase === 'disabled') {
          // disable war schneller. Session ist committed → Finalize über _doDisable.
          // _doStart returned hier ohne weitere Startup-Arbeit. _doDisable sieht _sessionStartWritten=true
          // und ruft _doFinalizeAfterDisable (schreibt consentChange + sessionEnd + Metadata).
          return;
      }
      if (requestedGen !== this._requestedGeneration) {
          // Neuer startSession(C) kam rein. Aktuelle Session sauber beenden (bekommt sessionEnd).
          // _doEnd('user-end') läuft, Phase → 'idle'. Nächste Queue-Iteration startet dann C.
          await this._doEnd('user-end');
          return;
      }
      ```
   l. `_captureInitialDiagnostics(requestedGen)` (synchron, via `_recordInternal` mit `allowDuringStartup`).
   m. **Startup-Contributors aufrufen** (synchron). Via `_recordInternal(event, { allowDuringStartup: true }, requestedGen)`.
   n. Initial-State-Events (Block E) — via `_recordInternal(event, { allowDuringStartup: true }, requestedGen)`.
   o. Post-commit Re-Check wie in k (zwischen den Startup-Blöcken, defensiv).
   p. `_phase = 'recording';` — ab hier gilt der normale Pfad.
   q. `_writeLifecycleEvent({type:'startupPhaseComplete', ...})`.
   r. `_fireStateChange()`.

6. **Neuer End-Ablauf** (`_doEnd(reason)`, innerhalb Mutex). **Nur für reguläres End**. Wird **nicht** von `disable` aufgerufen — dort läuft `_doFinalize` (Punkt 7b), das ein eigener Pfad ist:
   a. `if (_phase !== 'recording' && _phase !== 'starting') return;`
   b. `_phase = 'ending';` — öffentliche Record-Methoden sind jetzt blockiert.
   c. **Pending Debounces flushen**. Bei `reason === 'user-end'` oder `'deactivate'`: via `_recordInternal(payload, { allowDuringEnding: true }, _currentGeneration)` schreiben.
   d. Pending TerminalShellExecutions mit `aborted=true`, Map leeren.
   e. `_writeLifecycleEvent({type:'sessionEnd', ...})`.
   f. `await _writer.flush()`.
   g. `await _writer.writeMetadata({schemaVersion:2, recorderVersion, ...})`.
   h. `await _writer.endSession()`.
   i. `_phase = 'idle'`. Session-State-Reset.

7. **Neuer Disable-Ablauf** — eigener Finalize-Pfad, pre/post-commit-aware:
   - **Öffentlich synchron** (siehe Punkt 3): `_phase = 'disabling'; _requestedGeneration = -1;`. `shouldFinalize` und `generation` werden gecaptured. Danach: öffentliche Record-Methoden no-op, laufende `_doStart` bricht beim nächsten Re-Check ab.
   - **Queued**: `this._lifecyclePromise = this._lifecyclePromise.then(() => this._doDisable(ctx))`.
   - `_doDisable({ shouldFinalize, generation })`:
     a. **Warten bis `_doStart` durch ist** (falls gerade in-flight): Da `_doDisable` auf derselben `_lifecyclePromise`-Queue liegt wie `_doStart`, ist das automatisch gewährleistet (Mutex-Serialisierung). Kein expliziter Await nötig.
     b. **Re-Check nach Mutex-Wartezeit**:
        ```ts
        const finalizeNow = shouldFinalize
            && this._sessionStartWritten
            && this._committedGeneration === generation;
        ```
        — wenn `_doStart` zwischenzeitlich beim pre-commit Re-Check abortet hat, ist `_sessionStartWritten=false` und kein Finalize nötig.
     c. `if (finalizeNow) await this._doFinalizeAfterDisable({ generation });` — eigener Finalize-Pfad.
     d. `_disposeEventListeners()`.
     e. `_phase = 'disabled'` (Endzustand).
   - `_doFinalizeAfterDisable({ generation })`:
     a. `if (this._currentGeneration !== generation || !this._sessionStartWritten) return;` — Defensive Double-Check.
     b. `_writeLifecycleEvent({type:'consentChange', level:'downgraded', timestamp, ...})`.
     c. Pending Debounces werden **verworfen** (Option A, GDPR-strikt). Map geleert, aber nicht geschrieben.
     d. Pending TerminalShellExecutions mit `aborted=true`, Map leeren.
     e. `_writeLifecycleEvent({type:'sessionEnd', ...})`.
     f. `await _writer.flush()`.
     g. `await _writer.writeMetadata({schemaVersion:2, recorderVersion, ...})`.
     h. `await _writer.endSession()`.
     i. `_sessionStartWritten = false; _committedGeneration = undefined;` Session-State-Reset.

8. **`_recordInternal`-Pfad**. Neue interne Methode:
   ```ts
   _recordInternal(
       event: RecordedEvent,
       opts: { allowDuringStartup?: boolean; allowDuringEnding?: boolean },
       gen?: number,
   ): void
   ```
   Guard-Logik:
   - `gen === _currentGeneration` (falls gen gesetzt), sonst no-op.
   - `_phase === 'recording'` → immer erlaubt.
   - `_phase === 'starting' && opts.allowDuringStartup` → erlaubt.
   - `_phase === 'ending' && opts.allowDuringEnding` → erlaubt.
   - Alle anderen Kombinationen (`'idle'`, `'disabling'`, `'disabled'`) → no-op.
   - `'disabling'` und `'disabled'` sind **immer** no-op für `_recordInternal`. Der Finalize-Pfad `_doFinalizeAfterDisable` nutzt ausschließlich `_writeLifecycleEvent` für `consentChange`/`sessionEnd`. Damit ist Option A (GDPR-strikt) sauber durchgezogen.

9. **Public-Record-Methoden-Guards.** Alle öffentlichen `record*`-Methoden prüfen `_phase === 'recording'`. Keine anderen Pfade. Rufen intern `_recordInternal(event, {}, _currentGeneration)` auf.

10. **`deactivate()` awaiten.** `extension.ts:261` wird `export async function deactivate(): Promise<void>`. Body `await` auf `activeSessionRecorder?.dispose()` (was intern `await _doEnd` triggert). Bei VS Code Desktop-Deactivate erlaubt die Runtime Promise-Returns.

11. **Wiring-Anpassung.** `sessionRecorderWiring.ts:97` wird durch Contributor-Registrierung ersetzt (siehe Punkt 4). Startup-Contributor ist der einzige Pfad für Seed-Events.

**Tests (TDD-spezifisch)**:
- Start erzeugt Events strikt in Reihenfolge: `sessionStart` → Snapshots → Diagnostics → `eqEngineState` (wenn seeded) → Initial-State-Events → Panel-Visibility (via Contributor) → `startupPhaseComplete`. Assert via exakte JSONL-Zeilen-Reihenfolge nach `endSession`.
- Drei `startSession(A,B,C)` während laufendem `_doStart(A)`: nur C schreibt `sessionStart` für Exercise C; A bricht beim Re-Check ab; B wird in der Queue ebenfalls übersprungen (requestedGen >= C).
- `startSession()` nach `disable()` (ohne dazwischenliegendes `enable()`): kein Enqueue, sofortiger `return` — auch wenn später `enable()` kommt, startet nicht retroaktiv.
- `disable()` setzt `_phase='disabled'` synchron: nach Return des `disable()`-Calls darf `recordIrisChatSent("x")` keine JSONL-Zeile mehr schreiben, selbst wenn `_doDisable` noch nicht gelaufen ist.
- **Pre-commit disable**: `disable()` während `_doStart` in `await initSession` (vor `sessionStart`-Write): `_doStart` trifft pre-commit Re-Check → `_writer.abort()`, keine `sessionStart`, keine `consentChange`, keine `sessionEnd`. `_sessionStartWritten` bleibt false, `_doDisable` sieht `finalizeNow=false`, **kein Finalize**. Phase am Ende = `'disabled'`. Session-Verzeichnis aufgeräumt.
- **Post-commit disable (während Startup)**: `disable()` nach `sessionStart`-Write, aber während Snapshot-Capture: post-commit Re-Check in `_doStart` returned ohne weitere Startup-Arbeit und ohne `writer.abort()`. `_doDisable` sieht `_sessionStartWritten=true`, ruft `_doFinalizeAfterDisable`. JSONL enthält: `sessionStart`, bis-dahin geschriebene Snapshots, `consentChange`, `sessionEnd`. Kein `startupPhaseComplete`. Metadata wird geschrieben. Phase = `'disabled'`.
- **Post-commit disable (running session)**: `disable()` während `_phase=recording`: Finalize läuft. JSONL enthält vorheriges Fach-Event, `consentChange`, `sessionEnd`. Metadata wird geschrieben. Phase = `'disabled'`.
- **Neuer startSession(C) nach sessionStart(A) während Startup**: post-commit Re-Check in `_doStart(A)` sieht `requestedGen !== _requestedGeneration`, ruft `_doEnd('user-end')` für A. JSONL: A's `sessionStart`, A's Snapshots, A's `sessionEnd`. Nächste Queue-Iteration startet C regulär. Keine Abort-Dangling-Sessions.
- Zweiter `disable()`-Call während laufendem `_doDisable`: no-op (Phase ist schon `disabling`).
- `enable()` nach erfolgtem `disable()`: setzt `_phase='idle'`, kein Impact auf bereits geschriebene JSONL.
- Snapshot-Promise resolved nach `endSession()`: Generation-Token blockiert den `fileSnapshot`-Event.
- `sessionEnd` ist strikt letzte Zeile im JSONL.
- `metadata.eventCount` == Zeilenzahl in `events.jsonl`.
- Consent-Downgrade mid-session: letzte drei Events sind das vorherige Fach-Event, `consentChange`, `sessionEnd`. Pending Debounce-Payload **nicht** im Stream (Option A, GDPR-strikt).
- Regulärer `endSession()` ('user-end'): Pending Debounce-Payload **ist** im Stream zwischen letztem Fach-Event und `sessionEnd`.
- `deactivate()`: Mock-Extension-Context, 3 gepufferte Events → alle im JSONL vor Promise-Resolution. Pending Debounces werden geflusht (Reason 'deactivate').
- Startup-Contributor: Contributor liefert Events → landen zwischen `sessionStart` und `startupPhaseComplete`, unabhängig davon, wann Wiring den Contributor registriert hat (solange vor erstem `startSession`).
- `_recordInternal` mit `allowDuringStartup=true` während `_phase='starting'`: Event wird geschrieben. Ohne Flag: no-op.
- `_recordInternal` mit `allowDuringEnding=true` während `_phase='ending'`: Event wird geschrieben. Bei `_phase='disabled'`: no-op (Option A).

---

### Block D — Writer-Serialisierung, Retry, Ordering (P0)

**Problem D.1 (Batch-Loss)**: `flush()` macht `_buffer.splice(0)` **vor** `appendFile`. Bei Fehler ist der Batch weg.

**Problem D.2 (Parallel-Flush)**: `appendEvent` triggert `void this.flush()` bei 20 Events; Timer triggert alle 5s. Zwei `appendFile` können parallel laufen → JSONL-Zeilen out-of-order.

**Problem D.3 (Dispose-Loss)**: `dispose()` feuert `void flush()` und clear't Buffer. Bei Extension-Unload bis zu 19 Events weg.

**Fix**:

1. **Flush-Mutex (Single-Writer-Lane).** Ein internes Promise `_writeLane: Promise<void>`. Jede `flush()`, `writeSnapshot()`, `writeMetadata()` chained: `this._writeLane = this._writeLane.then(() => this._doWrite(...))`. Strikte Serialisierung aller fs-Operationen. Nie zwei `appendFile` parallel. Ordering garantiert.

2. **Atomic Batch-Remove — `slice` innerhalb der Lane.** `flush()` enqueued eine Lambda, **innerhalb** der Lambda läuft:
   a. `const batch = this._buffer.slice()` — Snapshot des aktuellen Buffers **zum Lane-Start-Zeitpunkt**, nicht zum Enqueue-Zeitpunkt. Das stellt sicher, dass alle Events, die während einer vorherigen laufenden Flush-Operation hinzukamen, in diesem Batch landen.
   b. `const batchSize = batch.length;`
   c. `if (batchSize === 0) return;`
   d. `await fs.appendFile(path, serialized(batch))`.
   e. Bei Erfolg: `this._buffer.splice(0, batchSize)` — entfernt genau die geschriebenen Events. Events, die während des `appendFile` neu kamen, bleiben im Buffer und werden beim nächsten Flush geschrieben (Reihenfolge bleibt erhalten, weil appendEvent nur nach hinten anhängt).
   f. Bei Fehler: **nichts entfernen**, Error-Counter inkrementieren; nächster Flush versucht erneut mit altem + neuem Batch, in korrekter Reihenfolge.

3. **Flush-Debounce auf Trigger-Seite.** Wenn eine Flush bereits in-flight ist, triggert ein 20-Event-Threshold-Hit keinen zweiten Lane-Enqueue, sondern setzt `_flushRequested=true`. Nach Abschluss: wenn `_flushRequested`, sofort erneut flushen. Vermeidet Queue-Aufstau.

4. **`async dispose()` mit Final-Flush.** `RecordingStorageWriter.dispose()` wird `async`. Implementierung siehe Punkt 5 (idle-Check + Sync-Fallback vs. timeouted Drain). Signaturänderung propagiert zu `SessionRecorder.dispose()` → `async`. Aufrufer in `extension.ts`/`sessionRecorderWiring.ts` awaiten.

5. **Sync-Fallback — nur wenn Lane nachweislich idle ist.** Der Sync-Fallback in `dispose()` ist nur aktiv, wenn weder ein aktiver Write läuft noch Writes gequeued sind. Statt Settled-Erraten via Promise: explizites Tracking mit zwei Countern:
   ```ts
   private _activeWrites = 0;   // inkrementiert vor fs-call, dekrementiert nach
   private _queuedWrites = 0;   // inkrementiert beim Enqueue, dekrementiert wenn Lane-Work startet
   private get _laneIdle() { return this._activeWrites === 0 && this._queuedWrites === 0; }
   ```
   `dispose()`-Pseudo:
   ```ts
   async dispose() {
       this._timer && clearInterval(this._timer);
       if (this._laneIdle) {
           // Lane garantiert frei → sync fallback safe
           if (this._buffer.length > 0) {
               try { fs.appendFileSync(path, serialized(this._buffer)); this._buffer.length = 0; } catch { /* log */ }
           }
       } else {
           // Lane busy: best-effort Await bis Timeout. Nach Timeout KEIN weiterer Flush-Await
           // (würde wieder hinter der Lane hängen). Stattdessen: bei Timeout loggen und aufgeben.
           const drained = await Promise.race([
               this._drainLane().then(() => true),
               timeout(5000).then(() => false),
           ]);
           if (drained) {
               // Lane leer → noch einen Flush hinterher für Events, die während des Drains kamen.
               try { await this.flush(); } catch { /* log */ }
           } else {
               // Timeout: Lane-Operation hängt. Abbrechen, Buffer-Verlust akzeptieren.
               logger.warn('Recording writer dispose: lane drain timed out, accepting buffer loss');
           }
       }
   }
   ```
   Damit: keine Duplikate durch Sync+Async-Race, Timeout ist echter Hard-Cap (kein Nach-Timeout-Await). Bei Timeout wird der Verlust akzeptiert und geloggt — das ist der Preis für Robustheit gegen hängende fs-Operationen.

6. **Durability-Policy dokumentieren.** Neuer Docstring-Abschnitt: "Bei graceful Shutdown garantiert Datenerhalt. Bei Extension-Host-Crash, Prozess-Kill oder fatalem Fehler ohne `finally`-Ausführung kann bis zu `BUFFER_THRESHOLD` (20) Events verloren gehen. Lifecycle-Events (`sessionStart`, `sessionEnd`, `consentChange`) gehen durch den Lifecycle-Writer-Channel und werden im nächsten Flush geschrieben; auch sie haben keine Crash-Durability-Garantie unterhalb der Buffer-Grenze. Vollständige Crash-Robustheit wäre nur via synchroner Per-Event-Writes erreichbar (Performance-Kosten inakzeptabel) oder via SQLite-WAL-ähnlicher Mechanismus (Scope-Exlposion)."

7. **Partial-Write-Risiko als Residual dokumentieren.** Bei `appendFile`-Fehler mitten im Schreibvorgang kann die Datei partiell geschrieben sein (inkomplette letzte Zeile). JSONL-Parser im Viewer muss pro-Zeile JSON.parse mit try/catch machen und malformed Zeilen als warn überspringen. Ist bereits Parser-Best-Practice, hier explizit als Anforderung.

**Tests (TDD-spezifisch)**:
- 100 parallele `appendEvent`-Calls, davon einige während laufendem Flush (via delayed Mock `fs.appendFile`): JSONL-Output parsebar, keine Duplikate, Events in Emit-Reihenfolge (via Reihenfolge-Check mit deterministischen IDs).
- Delayed append promise + neue Events während des Delays + Retry-Szenario: Reihenfolge alter Batch → neue Events korrekt.
- Mock `fs.appendFile` wirft 1×: nächster Flush schreibt **alle** Events inkl. gescheitertem Batch **vor** den neuen Events.
- `await dispose()` mit 5 gepufferten Events und idle Lane → Sync-Fallback schreibt alle 5.
- `await dispose()` mit aktivem Lane-Work + 5 gepufferten Events → kein Sync-Fallback, sondern Await der Lane + finaler async Flush. Keine Duplikate.
- Consecutive-Error-Counter erreicht 5 → Writer deaktiviert sich (existing behaviour, regression-test).
- Gleichzeitiger Timer-Flush und Threshold-Flush während laufendem Flush: genau zwei Flush-Operationen insgesamt, kein dritter Enqueue, Events in Reihenfolge.
- Malformed Line Handling (Viewer-Seite): JSONL mit partiell geschriebener letzter Zeile → Parser überspringt sie mit Warning, lädt alle anderen Events.

---

### Block C — Interventions-FSM (P0)

**Problem C.1**: Subtle-Interventions feuern nur `shown`, nie `accepted`/`dismissed`. Status-Bar-Click geht an `iris.chatView.focus` vorbei.
**Problem C.2**: `hideHint()` löst kein Event aus, implizit verworfene Subtle-Interventions sind unsichtbar.
**Problem C.3**: Cooldown-blockierte Notifications/Proactive verschwinden komplett — Entscheidung, dass eine Intervention blockiert wurde, steckt nirgendwo.

**Fix**:

1. **InterventionDecision-Kontext-Speicher.** `InterventionService` hält `_currentSubtleDecision: InterventionDecision | undefined`.
2. **Wrapper-Command.** `showSubtleHintEQ` setzt StatusBar-Command auf neu registrierte `iris.intervention.acceptSubtle`. Command feuert `_onDidAcceptIntervention.fire(_currentSubtleDecision)` und ruft dann `iris.chatView.focus` auf; `_currentSubtleDecision = undefined`.
3. **`hideHint()` feuert Dismiss.** Wenn `_currentSubtleDecision` gesetzt: `_onDidDismissIntervention.fire(_currentSubtleDecision)` + `dismissReason`.
4. **`InterventionEvent.action` erweitern** (types.ts:128–137): zusätzlich `'blocked'`. Additive Felder: `blockedReason?: 'cooldown' | 'warmup' | 'session-limit' | 'low-confidence'`, `dismissReason?: 'user-action' | 'hidden' | 'replaced' | 'session-end'`, `rawWanted?: boolean`.
5. **DecisionEngine-Output erweitern**. `InterventionDecisionEngine` liefert jetzt:
   ```ts
   {
       rawWanted: boolean;        // EQ > Threshold (nur Severity, OHNE Confidence)
       shouldIntervene: boolean;  // rawWanted AND Confidence sufficient AND keine Guardrails blockieren
       level: 'subtle' | 'notification' | 'proactive';
       blockedReason?: 'cooldown' | 'warmup' | 'session-limit' | 'low-confidence';
       eq: number;
       confidence: 'sufficient' | 'insufficient';
       triggerType?: ...;
   }
   ```
   Bewusste Definition: `rawWanted` folgt nur der EQ-Severity — damit kann **`low-confidence` ein legitimer `blockedReason` sein**. Beispiel: EQ=0.5 (über Threshold), Confidence=insufficient → `rawWanted=true`, `shouldIntervene=false`, `blockedReason='low-confidence'`. Diese Situation ist wertvoll für Evaluation (zeigt "wäre interveniert, aber zu wenig Datenpunkte").
6. **TelemetryManager-Routing**. `TelemetryManager._evaluateAndIntervene` (oder äquivalenter Pfad) unterscheidet explizit:
   ```ts
   if (decision.shouldIntervene) {
       // show path
       switch (decision.level) {
           case 'subtle': interventionService.showSubtleHintEQ(decision); break;
           case 'notification': await interventionService.showNotificationEQ(decision); break;
           case 'proactive': await interventionService.showProactiveHelpEQ(decision); break;
       }
   } else if (decision.rawWanted) {
       // blocked path — sichtbar machen für Eval
       interventionService.recordBlockedDecision(decision);
   }
   // else: rawWanted=false → Default-Operation, kein Event
   ```
7. **`InterventionService.recordBlockedDecision(decision)`**. Neue Methode:
   - Feuert `_onDidBlockIntervention.fire({ decision })`.
   - Wendet Rate-Limit an (siehe Punkt 8).
   - Ruft **keinen** Show-Pfad auf.
8. **Rate-Limiting für Block-Events.** Counter pro `(triggerType, blockedReason)`-Kombination. Maximal 1 Block-Event pro 60 Sekunden pro Kombination. Konfigurierbar.
9. **`recordIntervention`-Signatur erweitern**: optionaler Options-Parameter `{ blockedReason?, dismissReason?, rawWanted? }`.

**Tests (TDD)**:
- Subtle-Show → StatusBar-Command-Click → `onDidAccept`-Event mit derselben Decision.
- Subtle-Show → `hideHint()` → `onDidDismiss` mit `dismissReason:'hidden'`.
- `rawWanted=true, shouldIntervene=false, blockedReason='cooldown'` im TelemetryManager → **kein** `showXxxEQ`-Aufruf, stattdessen `recordBlockedDecision`. 1 `onDidBlock`-Event.
- `rawWanted=true, shouldIntervene=false, blockedReason='low-confidence'` (EQ hoch, Confidence insufficient) → 1 `onDidBlock`-Event mit `blockedReason='low-confidence'`.
- Fünf Blocks innerhalb 60s (gleiche `(triggerType, reason)`-Kombination) → nur 1 Event (Rate-Limit).
- Fünf Blocks, jeder 70s auseinander → 5 Events.
- `rawWanted=false`: weder show noch block. Keinerlei Event.
- `rawWanted=true, shouldIntervene=true` → `shown`-Event, kein `blocked`.
- TelemetryManager-Dispatch: Test, dass `shouldIntervene=false && rawWanted=false` keinen `recordBlockedDecision`-Aufruf triggert.

---

### Block E — Initial-State-Completeness (P1)

Teil des Block-AB-Start-Ablaufs (Schritt 4h). Eigenständig gelistet, damit die Event-Emits klar sind.

**Events zu emittieren am Session-Start** (nach `sessionStart`, vor `_isRecording=true`):

1. `windowFocus` mit aktuellem `vscode.window.state.focused`.
2. Für jeden `vscode.window.visibleTextEditors` (file:), je ein `selectionChange` und `visibleRangeChange`.
3. Ein `fileSwitch` mit `fromUri: undefined, toUri: vscode.window.activeTextEditor?.document.uri.toString()` (wenn aktiv).
4. Für jedes `vscode.window.terminals`: `terminalOpenClose` mit `action:'opened'`.
5. `panelVisibility` für 'artemis' und 'chat' — Werte kommen aus den Providers. Wird über Startup-Contributors gelöst: Provider registrieren einen Contributor, der die aktuelle Panel-Visibility abfragt und als Event zurückgibt. Recorder ruft den Contributor synchron in `_doStart` (Schritt m) auf. Dadurch landen die Panel-Visibility-Events strikt vor `startupPhaseComplete`.

**Tests**:
- Unit: Session-Start mit zwei offenen Editoren → zwei `selectionChange`- und zwei `visibleRangeChange`-Events vor `startupPhaseComplete`.
- Unit: `windowFocus`, `fileSwitch`, `terminalOpenClose` sind unter den ersten Events.

---

### Block F — BuildResult-Scoping + Predicate-Konsistenz (P1)

**Problem F.1 (Scoping)**: `SessionRecorder.onNewResult()` schreibt jedes WebSocket-Result. Keine Exercise-Guards wie im `TelemetryManager`.
**Problem F.2 (Schema)**: `BuildResultEvent` speichert weder `participationId`, `exerciseId` noch `submissionId`.
**Problem F.3 (Predicate-Mismatch)**: `failedTests` nutzt `!fb.positive`, `buildErrorFamilies` nutzt `fb.positive === false`. Plus: `buildErrorFamilies` kappt bei 50 chars.
**Problem F.4 (Test-Name fehlt)**: Bei fehlgeschlagenen Tests wird nur `fb.detailText` gespeichert, nicht `fb.text` (Testname).

**Fix**:

1. **Shared Guard-Helper.** Neue Funktion in `extension/src/extension/services/telemetry/buildResultGuard.ts`:
   ```ts
   export function shouldAcceptBuildResult(
       result: ResultDTO,
       activeExerciseId: number | undefined,
       exerciseRegistry: ExerciseRegistry | undefined,
   ): boolean
   ```
   Enthält die Logik aus `TelemetryManager.onNewResult:191–207`. Wird von `TelemetryManager` UND `SessionRecorder` genutzt — **keine Duplikation**. Existing `TelemetryManager.onNewResult` wird refactored, um diesen Helper zu nutzen (Nicht-Breaking, nur interner Umbau).
2. **ExerciseRegistry-Injection.** `SessionRecorder`-Konstruktor bekommt optional `exerciseRegistry?: ExerciseRegistry`. Wiring reicht es durch. `onNewResult` ruft `shouldAcceptBuildResult()` auf.
3. **`BuildResultEvent` erweitern (additiv)**:
   ```ts
   exerciseId?: number;           // neu
   participationId?: number;      // neu
   submissionId?: number;         // neu
   failedTestDetails?: {          // neu, additiv zu failedTests
       testName: string;
       detail: string;
   }[];
   ```
   `failedTests: string[]` bleibt für Rückwärtskompatibilität. Viewer liest bevorzugt `failedTestDetails`, fällt zurück auf `failedTests`.
4. **`collectBuildResult` (eventCollectors.ts)**:
   - Vereinheitlichte Predicate-Logik: `fb.positive === false` für beide Listen. Für `failedTestDetails` zusätzlich `fb.text` (testName, falls vorhanden, sonst `unknown`) und `fb.detailText` (detail, falls vorhanden).
   - Feedbacks mit `positive: undefined` fallen bewusst raus. Das ist konsistent mit `BuildResultTracker` (`buildResultTracker.ts:61`) und mit `classifyBuildResult`, das auch `positive === false` nutzt.
   - `buildErrorFamilies`: 50-char-Cutoff auf 200 erhöhen, Kommentar mit Begründung. Alternative: Family via Hash über normalisiertem Text bilden. Für V1 reicht erhöhtes Limit, Hash in Follow-up.
5. **Signatur von `collectBuildResult` erweitern**: zusätzliche Parameter `activeExerciseId: number` und (optional) `participationToExerciseMap: ExerciseRegistry | undefined` — oder die Guard-Logik bleibt im `onNewResult` und `collectBuildResult` bekommt nur `activeExerciseId` als Data-Parameter.

**Tests**:
- Unit: Result mit `participation.id` einer anderen (bekannten) Exercise → kein Event.
- Unit: Result mit `participation.id` unbekannt → Event wird geschrieben (permissive).
- Unit: Feedback `positive:false, text:'TestFoo', detailText:'AssertionError'` → `failedTestDetails[0] = {testName:'TestFoo', detail:'AssertionError'}`, `failedTests[0] = 'AssertionError'` (legacy).
- Unit: Feedback `positive:undefined` → keine Einträge in beiden Listen.

---

### Block G — Snapshot-Fehler härten (P1)

**Problem G.1**: `writeSnapshot()` schluckt Fehler. `_snapshotDocument` recorded trotzdem `fileSnapshot` + markiert URI als snapshoted.

**Fix**:

1. `RecordingStorageWriter.writeSnapshot()` gibt `Promise<boolean>` zurück.
2. `_snapshotDocument()`:
   - Wenn `writeSnapshot` false → **kein** `fileSnapshot`-Event, URI **nicht** zu `_snapshotedUris` hinzufügen. Retry-Counter pro URI (Map `_snapshotRetries: Map<string, number>`).
   - Max 3 Retries pro URI. Nach 3 Fehlern: `fileSnapshotError`-Event (neu in types.ts, schemaVersion 2). URI dann endgültig als "vergeben" markieren.
3. Retry wird getriggert, wenn der nächste Editor-Wechsel für dieselbe URI feuert (also natürlicher Re-Entry-Punkt). Kein Scheduler nötig.

**Tests**:
- Unit: Mock fs.writeFile wirft 1×, beim zweiten Aufruf (nächster Editor-Switch) erfolgt erfolgreicher Snapshot + 1 Event.
- Unit: 3× Fehler → 1 `fileSnapshotError`-Event, URI bleibt danach unsnapshoted, keine weiteren Versuche.

---

### Block H — Chat-Recording vervollständigen (P1)

**Problem H.1**: Gesendete Chats werden erst nach API-Erfolg recorded. Fehlschläge unsichtbar.
**Problem H.2**: Empfangene Nachrichten speichern nur `content`, keine `messageId`/`sessionId`/`sentAt`/Helpful-Feedback.

**Fix**:

1. **Neuer Event-Typ `irisChatSendAttempt`** (additiv, schemaVersion 2):
   ```ts
   { type:'irisChatSendAttempt', timestamp, content, status:'pending'|'sent'|'failed', errorMessage?:string }
   ```
   `ChatWebviewProvider` feuert einen `pending`-Event vor dem API-Call, dann `sent` oder `failed` nach Response.
2. **`IrisChatMessageEvent` erweitern (additiv)**: optionale Felder `messageId?`, `sessionId?`, `sentAt?`. Bei `direction:'received'` werden sie aus dem WebSocket-Payload durchgereicht (`websocketMessageHandler.ts` muss sie exposen).
3. **Helpful-Feedback als separater Event-Typ** `irisChatFeedback` (additiv): `{ messageId, helpful:boolean }`. Wird gefeuert, wenn der User im Chat-UI auf Helpful/NotHelpful klickt. Keine Erweiterung des alten `irisChatMessage`-Formats.

**Tests**:
- Unit: Send-Fehler → `irisChatSendAttempt` mit `status:'failed'` + errorMessage.
- Unit: Received-Event mit `messageId` im Payload → Event enthält `messageId`.
- Unit: Helpful-Click → `irisChatFeedback`-Event.

---

### Block I — Scheme-Filter zentralisieren + Prefix-Bug (P2)

**Problem I.1**: Jeder Listener hat seinen eigenen `scheme === 'file'`-Check. Nicht-file-Schemes komplett ignoriert.
**Problem I.2**: `startsWith(exerciseRoot)` ist anfällig für `/ex1` vs `/ex10` (snapshotReconstructor.ts:44, compileEquivalentEmitter.ts:136).

**Fix**:

1. Neue Util in `extension/src/extension/services/telemetry/recording/uriFilter.ts`:
   ```ts
   shouldRecordUri(uri: vscode.Uri, exerciseRoot?: vscode.Uri): boolean
   ```
   - File-URIs: `uri.fsPath === exerciseRoot.fsPath || uri.fsPath.startsWith(exerciseRoot.fsPath + path.sep)` — fixt Prefix-Bug.
   - Remote (`vscode-remote:`): Authority+Path vergleichen.
   - Untitled/Notebook: Für V1 **nicht** recorden, aber bewusst geloggt (Follow-up).
   - Blacklist: `git:`, `output:`, `vscode-userdata:`, `search-result:`.
2. Alle Stellen (`sessionRecorder.ts:356,365,390,407,419,506`) auf `shouldRecordUri()` migrieren.
3. `snapshotReconstructor.ts:43` und `compileEquivalentEmitter.ts:136` nutzen dieselbe Util. Prefix-Bug ist damit auch im Replay-Pfad gefixt.

**Tests**:
- Unit: `/workspace/ex1` Root + `/workspace/ex10/File.java` → false.
- Unit: `/workspace/ex1` Root + `/workspace/ex1/File.java` → true.
- Unit: `git:/some/file.java` → false.
- Unit: `vscode-remote://host/workspace/ex1/file.java` mit Root `/workspace/ex1` → true.

---

### Block J — Debounce pro URI + Pending-Flush (P2)

**Problem J.1**: Ein globaler Debounce-Timer überschreibt Selection in Datei A durch Selection in Datei B.
**Problem J.2**: Timeout-Callback liest `event.textEditor.selections` — aktuellen, nicht Trigger-Zeit-Zustand.
**Problem J.3**: Pending Debounces werden bei `_disposeEventListeners` verworfen (schon in Block AB.5c adressiert, hier nur Test).

**Fix**:

1. `_selectionDebounceTimer: Map<string, NodeJS.Timeout>` keyed by `uri.toString()`. Analog `_visibleRangeDebounceTimer`.
2. Beim Trigger: Selection/Range sofort in lokale Variable serialisieren (`const selections = editor.selections.map(serializeRange)`), dann im Timeout-Callback die **lokale** Variable verwenden. Kein Zugriff mehr auf `event.textEditor` asynchron.
3. Pending-Flush bei endSession: siehe Block AB.5c (synchron letzten Wert feuern).

**Tests**:
- Unit: Schnell alternierend Selection in A und B → beide Events im Stream, keine Überschreibung.
- Unit: Selection ändert sich nach Trigger-Zeit, vor Timeout-Ablauf → Event enthält **Trigger-Zeit-Wert** (weil lokal serialisiert).
- Unit: Pending Debounce bei `endSession` → Event erscheint vor `sessionEnd`.

---

### Block K — Workspace/File-Events (P2, Teilmenge)

**Problem K.1**: Workspace-File-Create/Delete/Rename, Open/Close von TextDocuments, Debug/Task/Config fehlen.

**Fix (Teilmenge für diese Initiative)**:

1. `vscode.workspace.onDidCreateFiles` / `onDidDeleteFiles` / `onDidRenameFiles` → `fileCreate`/`fileDelete`/`fileRename`-Events (additiv, schemaVersion 2). Scheme-Filter via `shouldRecordUri()`.
2. `vscode.workspace.onDidOpenTextDocument` / `onDidCloseTextDocument` → `textDocumentOpen`/`textDocumentClose`-Events. Scheme-Filter via `shouldRecordUri()`.
3. Debug/Task/Config bleiben Follow-up (Issue tracken).

**Tests**:
- Unit: File wird während Session umbenannt → `fileRename`-Event.
- Unit: Doc wird geöffnet → `textDocumentOpen`-Event; nach Close → `textDocumentClose`.

---

## Reihenfolge der Implementierung

1. **Block D** (Writer-Robustheit) — Foundation. Ohne Serialisierung sind Lifecycle-Fixes fragil.
2. **Block AB** (Lifecycle-FSM) — hängt auf D. Inkludiert Block E (Initial-State) als Teil des Start-Ablaufs.
3. **Block C** (Interventions-FSM) — unabhängig von AB/D, parallel möglich.
4. **Block F** (BuildResult-Scoping + Predicate) — nach AB, weil es `exerciseRegistry`-Injection im Recorder braucht.
5. **Block G** (Snapshot-Retry) — nach D (Writer-API-Änderung).
6. **Block H** (Chat-Semantik).
7. **Block J** (Debounce-Map) — klein.
8. **Block I** (Scheme-Filter-Zentralisierung) — touched viele Dateien.
9. **Block K** (Workspace-Events) — klein, additiv.

Jeder Block = eine PR vom `dev`-Branch. Schema-Versionierung wird in Block D oder AB (je nachdem welcher zuerst landet) eingeführt.

## Viewer-Updates

Alle Schema-Änderungen sind additiv. Trotzdem braucht jeder Block einen Viewer-Patch, meist klein:

- `recording-viewer/src/generated/recordingTypes.ts` — durch Code-Gen-Pipeline regenerieren (Prozess prüfen, ggf. dokumentieren).
- `recording-viewer/src/parseSession.ts` — neue Event-Typen akzeptieren; `resolveSchemaVersion()` zentralisieren; malformed Zeilen überspringen.
- `recording-viewer/src/components/EventStream.tsx` — Render-Logik für neue Event-Typen.
- `recording-viewer/src/components/TrackingTimeline.tsx` — falls neue Events in Timeline-Spuren gehören.
- `recording-viewer/src/components/RecordingInfo.tsx` — `schemaVersion` + `recorderVersion` anzeigen.

### Viewer-Test-Infrastruktur (neu)

`recording-viewer/` hat aktuell **keine** Test-Infrastruktur. Als Teil des ersten Blocks, der den Viewer ändert:

1. **Vitest einführen**: `recording-viewer/vitest.config.ts` + `package.json`-Script `"test": "vitest"`. Minimal-Setup, JSDOM oder Node-Environment je nach Bedarf (Parser braucht nur Node).
2. **Fixture-Layout**:
   ```
   recording-viewer/test/fixtures/recordings/
   ├── v1-basic/                 # vor Schema-Versionierung
   │   ├── events.jsonl
   │   └── metadata.json
   ├── v2-basic/                 # mit schemaVersion:2, neuen Feldern
   │   ├── events.jsonl
   │   └── metadata.json
   ├── v2-no-metadata/           # nur events.jsonl, schemaVersion im sessionStart
   │   └── events.jsonl
   └── malformed-last-line/      # simuliert partial-write crash
       └── events.jsonl
   ```
3. **Parser-Tests** (`recording-viewer/test/parseSession.test.ts`):
   - V1 ohne schemaVersion: `resolveSchemaVersion === 1`, alle Events korrekt geparst.
   - V2 mit neuen Feldern: `schemaVersion === 2`, additive Felder vorhanden.
   - V2 ohne metadata.json: `schemaVersion` aus sessionStart.
   - Widersprüchliche Versionen in metadata vs sessionStart: metadata gewinnt.
   - Malformed last line: wird mit Warning übersprungen, alle anderen Events geparst.
   - Legacy `failedTests: string[]` ohne `failedTestDetails`: Viewer rendert nur legacy-Pfad.
4. **Fixture-Erzeugung**: V1-Fixture aus echten Recordings extrahieren (aus dem `globalStorageUri`-Verzeichnis eines manuellen Tests) + sensible Daten anonymisieren. V2-Fixture synthetisch, kleines Beispiel.

## Durability-Policy (Residual-Risiko)

Block D fixt Datenverlust bei **graceful Shutdown**. Bei **Extension-Host-Crash** (Prozess-Kill, OOM, fatal error ohne `finally`) können bis zu `BUFFER_THRESHOLD` (20) Events verloren gehen. Das ist eine bewusste Entscheidung — vollständige Crash-Durability würde synchrone Writes pro Event erfordern (Performance-Kosten inakzeptabel bei 20+ textChange/sec). Lifecycle-Events (`sessionStart`/`sessionEnd`/`consentChange`) gehen durch einen bevorzugten Lifecycle-Writer-Channel, der beim nächsten Flush am frühestmöglichen Punkt geschrieben wird, aber auch hier gibt es keinen Crash-Guarantee unterhalb der Buffer-Grenze.

Falls in Zukunft Crash-Robustheit relevant wird: Policy-Option wäre "Lifecycle-Events immer synchron schreiben", plus optional ein 1-Event-Buffer mit synchronem Flush bei jedem 50. Event. Explizit **nicht** Teil dieser Initiative.

## Nicht in dieser Initiative

- Notebook-Recording (eigener Event-Typ, große Viewer-Änderungen).
- Debug/Task/Config-Events (Block K Teil 2 — separate Issue).
- Keystroke-Dynamics (V1.2-Roadmap laut CLAUDE.md).
- Peer-basierte Thresholds (V2.0 — Artemis-Backend-API nötig).
- Crash-Durability (siehe oben).
- Viewer-Design-Refresh — nur funktionale Viewer-Updates für neue Events.

## Risiken

1. **Lifecycle-FSM-Komplexität**: Session-Generation-Token + Lifecycle-Mutex sind nicht-triviale Konkurrenz-Primitive. Ohne gute Tests Risiko, dass neue Races eingebaut werden. Deshalb der dedizierte Test-Katalog pro Block.
2. **Deactivate-Async-Migration**: `extension.ts:261` wird `async`. VS Code erlaubt Promise-Returns, aber Timeout-Verhalten ist plattformabhängig. Testen wir explizit mit einem mock VS Code API.
3. **Viewer-Regression**: Auch bei additiven Changes können Viewer-Komponenten still brechen. Fixture-basierte Tests im Viewer mindestens für V1 und V2 Recordings.
4. **Performance**: Lifecycle-Mutex serialisiert Writer-Operationen. Bei Peak-Typing (z.B. 30 textChange/sec) darf der Mutex nicht zum Bottleneck werden. Benchmark im Test-Plan einplanen.
5. **GDPR**: Block AB ändert Compliance-Verhalten (synchrones Disable). Consent-Flow muss nach Implementierung manuell durchgetestet werden; `consentChange`-Event muss im Replay-Viewer sichtbar und verständlich sein.

## Offene Entscheidungen (vor Implementierung klären)

- **E5 Panel-Visibility Snapshot-Funktion vs. Post-Event**: Provider-Snapshot-API sauberer, aber erfordert Provider-API-Änderung. Alternativ Post-Event nach `startupPhaseComplete` (weniger strikte Ordering). Empfehlung: Snapshot-API.
- **F Hash vs. Text für buildErrorFamilies**: Hash wäre robuster. Für V1 reicht 200-char-Text. Entscheidung: Text, Hash in Follow-up.
- **H3 `irisChatFeedback` vs. `helpful` am `irisChatMessage`**: Separater Event robuster (spätere Helpful-Clicks sind zeitlich entkoppelt von Message-Receive). Empfehlung: separater Event.
- **Code-Gen-Pipeline für Viewer-Typen**: Wie läuft die aktuell (`recording-viewer/src/generated/`)? Prüfen und ggf. dokumentieren. Falls manuell, im Plan als "Manual sync after each type change" vermerken.
- **`dispose()` im `endSession()` vs. separater Call**: Block AB.10 macht `deactivate()` → `dispose()`. Dispose ruft intern endSession. Klare Semantik: `dispose()` ist final, `endSession()` ist re-entrant (mehrere Sessions pro Recorder-Lebenszeit). Doku prüfen.
- **Cancel-During-InitSession (Block AB.5.f)**: Wenn während `await _writer.initSession()` disable kommt, soll `_writer.endSession()` aufgerufen werden um das halb-initialisierte Verzeichnis aufzuräumen? Dann brauchen wir ein `_writer.abort()`, das beides kann. Empfehlung: ja, eigener `abort()`-Pfad im Writer.
