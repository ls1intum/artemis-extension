# Proactive Intervention — Slice 5a: Course-level enablement (A/B toggle) end-to-end — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an **admin-only, per-course `proactiveStruggleEnabled`** setting (default **off**) that gates proactive struggle detection independently of the chat, so a cohort A/B (chat-only vs chat+proactive) is possible; gate the trigger server-side; and make the extension client **read the 202 `accepted` body** and pause proactive surfacing (no no-AI lamp) when the course has it off, **distinct from a 404** (which degrades to the lamp).

**Sequencing.** Independent of slices 1-4b on the server side; on the client it extends `StruggleEgressResult` + the orchestrator's result handling (introduced through slices 1-4). Slices execute in order; a review against un-applied `HEAD` will see prior slices partially absent — expected.

**Scope of THIS slice (§13 + the §14 row-1 client behaviour).** Artemis: the `proactiveStruggleEnabled` field on `IrisCourseSettings` (admin-only on the update path), the `prepareTrigger` gate, and a 202 body that distinguishes **course-off** from **already-in-flight**; the admin toggle in the course Iris-settings page. Extension: read the 202 `courseDisabled` flag and latch proactive-off for the session (no surfacing, no lamp). **Out of scope (Slice 5b):** the student-facing AskIris on/off control + the 3-state badge + the §14 cases-2/3 exercise-view banner. 5a makes the A/B gate *work* (server gates, client respects, no proactive noise); 5b *surfaces* the states to the student.

**Architecture.** `proactiveStruggleEnabled` lives in the JSON-serialized `IrisCourseSettings` record (no DB migration — it is a JSON column). Default **off**: the record DEFAULT sets it `false` and existing JSON rows lacking the key deserialize to `false`. The update path treats it as **admin-only** (mirrors `variant`/`rateLimit`: `enforceInstructorRestrictions` rejects an instructor changing it). The resource distinguishes course-off from in-flight from a **single settings read**: `prepareTrigger` returns a typed `TriggerPreparation` (triggered / course-disabled / in-flight) and `requestStruggleIntervention` surfaces a `StruggleTriggerOutcome(accepted, courseDisabled, jobToken)`, so the 202 is `{accepted:false, courseDisabled:true}` for course-off and `{accepted:false, courseDisabled:false}` for a taken single-flight slot — no second settings read, no TOCTOU. The client maps **only** `courseDisabled:true` → a `'course-off'` egress result → orchestrator latches `_courseProactiveOff` (no POST, no fallback lamp) until the next exercise.

**Tech Stack:** Artemis (Java 21/Spring, Jackson JSON settings, JUnit/Mockito + Spring integration test; Angular 19 signals + Vitest). Extension client (TypeScript, Vitest `test/logic`).

Spec refs: §12.2 (card states — only the "Off (course)" behaviour, surfacing deferred to 5b), §13, §14 (row 1 + the 404-vs-course-off distinction).

## Global Constraints

- **Branch:** `feat/struggle-v3-integration`. Not `dev`/`main`.
- **Commit messages:** Conventional Commits. **No AI attribution** (no `Co-Authored-By`, no `🤖`, no "Generated with"). Overrides any default trailer.
- **Staging:** exact files only. `git` from each repo's root (Artemis `/Users/liamberger/Documents/private/Artemis`; extension `/Users/liamberger/Documents/private/MA/artemis-extension`). Never `git add -A`/`.`.
- **Verification:** Artemis test classes green + `./gradlew spotlessApply`; Angular Vitest green; extension targeted Vitest green + `npm run check-types`.
- **Invariants:** Desktop = Cookie auth, Theia = Bearer (untouched). No `^`/`~` added to any `package.json`.
- **Default OFF (§13):** the setting defaults to `false` everywhere (record DEFAULT, Angular `createDefaultCourseSettings`, missing-JSON deserialization). Treatment courses are switched on explicitly.
- **No DB migration:** `IrisCourseSettings` is persisted as a JSON column (`@JdbcTypeCode(SqlTypes.JSON)` on `IrisCourseSettingsEntity`); a new record field is a new JSON key, not a schema change.
- **Admin-only (§13):** only admins may change the field; instructors are server-rejected (mirrors `variant`/`rateLimit`).

---

## File structure

- **Artemis** (`/Users/liamberger/Documents/private/Artemis`)
  - Modify: `src/main/java/de/tum/cit/aet/artemis/iris/domain/settings/IrisCourseSettings.java` — field + JsonCreator + DEFAULT + `of(...)`.
  - Modify: `src/main/java/de/tum/cit/aet/artemis/iris/service/settings/IrisSettingsService.java` — `sanitizePayload` + `enforceInstructorRestrictions`.
  - Modify: `src/main/java/de/tum/cit/aet/artemis/iris/service/session/IrisStruggleInterventionService.java` — typed `prepareTrigger`/`requestStruggleIntervention` (gate + course-off-vs-in-flight).
  - Modify: `src/main/java/de/tum/cit/aet/artemis/iris/dto/StruggleInterventionAcceptedDTO.java` — `courseDisabled` field.
  - Modify: `src/main/java/de/tum/cit/aet/artemis/iris/web/IrisStruggleInterventionResource.java` — distinguish course-off from in-flight in the 202.
  - Modify (test): `src/test/java/de/tum/cit/aet/artemis/iris/struggle/IrisStruggleInterventionServiceTriggerTest.java` (2 `new IrisCourseSettings(...)` constructor sites + typed-result assertions), `.../struggle/IrisStruggleInterventionEndpointTest.java`, `.../struggle/IrisStruggleInterventionRoundTripTest.java` (enable proactive), `.../struggle/StruggleInterventionEventDTOTest.java` (DTO arity), `src/test/java/de/tum/cit/aet/artemis/iris/IrisSettingsResourceIntegrationTest.java`, `src/test/java/de/tum/cit/aet/artemis/iris/domain/settings/IrisCourseSettingsTest.java`. **Not** `AbstractIrisIntegrationTest` / `IrisSettingsServiceTest` — their `of(...)` calls use the kept 4-arg overload.
  - Modify: `src/main/webapp/app/iris/shared/entities/settings/iris-course-settings.model.ts`, `.../iris-settings-update/iris-settings-update.component.ts`, `.../iris-settings-update.component.html`, `src/main/webapp/i18n/en/iris.json`, `src/main/webapp/i18n/de/iris.json`.
  - Modify (test): `.../iris-settings-update/iris-settings-update-component.spec.ts`.
- **Extension** (`/Users/liamberger/Documents/private/MA/artemis-extension`)
  - Modify: `extension/src/extension/services/struggleIntervention/struggleContract.ts` — `StruggleEgressResult` + `StruggleInterventionAccepted`.
  - Modify: `extension/src/extension/api/artemisApi.ts` — read the 202 body.
  - Modify: `extension/src/extension/services/struggleIntervention/struggleInterventionService.ts` — `_courseProactiveOff` latch.
  - Test: `extension/test/logic/struggleIntervention/struggleInterventionService.test.ts`.

---

### Task 1: Artemis — `proactiveStruggleEnabled` on `IrisCourseSettings` (admin-only)

**Files:**
- Modify: `IrisCourseSettings.java`, `IrisSettingsService.java`
- Modify (test, constructor-arity fix only): `IrisStruggleInterventionServiceTriggerTest.java`
- Test: `IrisSettingsResourceIntegrationTest.java`, `IrisCourseSettingsTest.java`

**Interfaces:**
- Produces: `IrisCourseSettings.proactiveStruggleEnabled()` (boolean, default false); the **existing 4-arg `of(enabled, customInstructions, variant, rateLimit)` is kept as a back-compat factory that defaults the flag to `false`** (so the ~40 existing `of(...)` call sites stay untouched), plus a **new 5-arg `of(..., proactiveStruggleEnabled)`** overload for the admin/test paths; the update path rejects a non-admin changing it.

**Arity strategy (keep the blast radius small).** Adding a 5th record component makes the *canonical constructor* 5-arg, which breaks every `new IrisCourseSettings(4-arg)` — but there are only 4 of those (`DEFAULT`, the `of` body, and 2 trigger-test helpers). The `of(...)` **factory** is called ~40 times across the settings tests; keeping a 4-arg `of(...)` overload (defaulting the flag false) leaves all of those compiling and semantically correct (default off). Only the places that must *set/preserve* the flag use the 5-arg `of(...)`: `sanitizePayload` and the new tests.

- [ ] **Step 1: Add a failing settings integration test (admin can set, instructor cannot)**

In `IrisSettingsResourceIntegrationTest.java`, add (mirror `testUpdateCourseSettings_asAdmin_changeVariant` / `_asInstructor_*` exactly — course handle `course1`, admin mock user is the plain `"admin"`, instructor is `TEST_PREFIX + "instructor1"`; proactive is off by default after `enableIrisFor`, so both tests attempt to set it `true`):
```java
@Test
@WithMockUser(username = "admin", roles = "ADMIN")
void testUpdateCourseSettings_asAdmin_enablesProactiveStruggle() throws Exception {
    enableIrisFor(course1);
    var current = irisSettingsService.getSettingsForCourse(course1);   // proactive off (default)
    var update = IrisCourseSettings.of(current.enabled(), current.customInstructions(), current.variant(), current.rateLimit(), true);

    var response = request.putWithResponseBody("/api/iris/courses/" + course1.getId() + "/iris-settings", update, IrisCourseSettingsWithRateLimitDTO.class, HttpStatus.OK);

    assertThat(response.settings().proactiveStruggleEnabled()).isTrue();
    assertThat(irisSettingsService.getSettingsForCourse(course1).proactiveStruggleEnabled()).isTrue();
}

@Test
@WithMockUser(username = TEST_PREFIX + "instructor1", roles = "INSTRUCTOR")
void testUpdateCourseSettings_asInstructor_cannotChangeProactiveStruggle() throws Exception {
    enableIrisFor(course1);
    var current = irisSettingsService.getSettingsForCourse(course1);   // proactive off (default)
    var update = IrisCourseSettings.of(current.enabled(), current.customInstructions(), current.variant(), current.rateLimit(), true);  // attempt to flip it on

    request.putWithResponseBody("/api/iris/courses/" + course1.getId() + "/iris-settings", update, IrisCourseSettingsWithRateLimitDTO.class, HttpStatus.FORBIDDEN);
}
```
Also add a unit serialization test to `IrisCourseSettingsTest.java` (verifies default-off + that an explicit `true` survives a JSON round-trip):
```java
@Test
void proactiveStruggle_defaultsOff_andRoundtripsWhenEnabled() {
    assertThat(IrisCourseSettings.of(true, null, null, null).proactiveStruggleEnabled()).isFalse();

    var enabled = IrisCourseSettings.of(true, null, IrisPipelineVariant.DEFAULT, null, true);
    var json = objectMapper.writeValueAsString(enabled);
    assertThat(objectMapper.readValue(json, IrisCourseSettings.class).proactiveStruggleEnabled()).isTrue();
}
```
(The method already `throws JsonProcessingException` via the class's existing `jsonRoundtrip_*` test pattern; add `throws JsonProcessingException` to the signature.)

- [ ] **Step 2: Run to verify failure**

```bash
( cd /Users/liamberger/Documents/private/Artemis && ./gradlew test --tests "de.tum.cit.aet.artemis.iris.IrisSettingsResourceIntegrationTest.testUpdateCourseSettings_*ProactiveStruggle*" ) 2>&1 | tee /tmp/slice5a_t1.txt | tail -25
```
Expected: FAIL — `of(...)` has no 5th param / `proactiveStruggleEnabled()` does not exist.

- [ ] **Step 3: Add the record field (default off), keep the 4-arg `of`, add a 5-arg `of`**

In `IrisCourseSettings.java`, add the component, thread it through the canonical (`@JsonCreator`) constructor, set the DEFAULT to `false`, keep the 4-arg `of(...)` (now passing `false`), and add a 5-arg `of(...)`:
```java
public record IrisCourseSettings(boolean enabled, @Size(max = IRIS_CUSTOM_INSTRUCTIONS_MAX_LENGTH) @Nullable String customInstructions, IrisPipelineVariant variant,
        @Valid @Nullable IrisRateLimitConfiguration rateLimit, boolean proactiveStruggleEnabled) implements Serializable {

    private static final IrisCourseSettings DEFAULT = new IrisCourseSettings(true, null, IrisPipelineVariant.DEFAULT, null, false);

    @JsonCreator
    public IrisCourseSettings(@JsonProperty("enabled") boolean enabled, @JsonProperty("customInstructions") @Nullable String customInstructions,
            @JsonProperty("variant") IrisPipelineVariant variant, @JsonProperty("rateLimit") @Valid IrisRateLimitConfiguration rateLimit,
            @JsonProperty("proactiveStruggleEnabled") boolean proactiveStruggleEnabled) {
        this.enabled = enabled;
        this.customInstructions = sanitizeCustomInstructions(customInstructions);
        this.variant = Objects.requireNonNullElse(variant, IrisPipelineVariant.DEFAULT);
        this.rateLimit = rateLimit; // null = use defaults, non-null = explicit override (even if values are null = unlimited)
        this.proactiveStruggleEnabled = proactiveStruggleEnabled;
    }
```
factories (keep the existing 4-arg as a back-compat default-false overload; add the 5-arg):
```java
    /** Back-compat factory: proactive struggle defaults to OFF (spec §13). Keeps existing call sites working. */
    public static IrisCourseSettings of(boolean enabled, @Nullable String customInstructions, @Nullable IrisPipelineVariant variant,
            @Nullable IrisRateLimitConfiguration rateLimit) {
        return new IrisCourseSettings(enabled, customInstructions, variant, rateLimit, false);
    }

    public static IrisCourseSettings of(boolean enabled, @Nullable String customInstructions, @Nullable IrisPipelineVariant variant,
            @Nullable IrisRateLimitConfiguration rateLimit, boolean proactiveStruggleEnabled) {
        return new IrisCourseSettings(enabled, customInstructions, variant, rateLimit, proactiveStruggleEnabled);
    }
```
NOTE on default-off + serialization: a missing `proactiveStruggleEnabled` JSON key deserializes to `false` (primitive default), and `@JsonInclude(NON_EMPTY)` omits `false` on write — so existing course rows stay off and round-trip cleanly; an admin's `true` serializes normally.

- [ ] **Step 4: Preserve the field on the update path + make it admin-only**

In `IrisSettingsService.java`:
- `sanitizePayload` (so a save round-trips the field instead of dropping it):
```java
        return IrisCourseSettings.of(payload.enabled(), payload.customInstructions(), payload.variant(), sanitizedRateLimit, payload.proactiveStruggleEnabled());
```
- `enforceInstructorRestrictions` (reject a non-admin changing it, mirroring variant/rateLimit):
```java
        if (request.proactiveStruggleEnabled() != current.proactiveStruggleEnabled()) {
            throw new AccessForbiddenAlertException("Only administrators can change proactive struggle detection", "IrisSettings", "irisProactiveStruggleRestricted");
        }
```

- [ ] **Step 5: Fix the canonical-constructor (`new IrisCourseSettings(...)`) arity sites**

Because the 4-arg `of(...)` overload is kept, the ~40 `IrisCourseSettings.of(...)` call sites across `AbstractIrisIntegrationTest`, `IrisSettingsServiceTest`, `IrisSettingsResourceIntegrationTest`, and `IrisCourseSettingsTest` **compile unchanged** (and correctly default the flag to `false`). The only breaks are the 4 direct `new IrisCourseSettings(4-arg)` calls against the now-5-arg canonical constructor. Two are inside `IrisCourseSettings.java` (the `DEFAULT` constant and the `of` body — both updated in Step 3). The other two are in `IrisStruggleInterventionServiceTriggerTest.java`; update them and add a proactive-off helper for the Task-2 gate test:
```java
    private static IrisCourseSettings enabledSettings() {
        return new IrisCourseSettings(true, null, IrisPipelineVariant.DEFAULT, null, true);   // Iris + proactive ON
    }

    private static IrisCourseSettings disabledSettings() {
        return new IrisCourseSettings(false, null, IrisPipelineVariant.DEFAULT, null, false);  // Iris OFF
    }

    private static IrisCourseSettings proactiveOffSettings() {
        return new IrisCourseSettings(true, null, IrisPipelineVariant.DEFAULT, null, false);   // Iris ON, proactive OFF
    }
```
(No change to `AbstractIrisIntegrationTest` is needed — its `of(...)` calls use the kept 4-arg overload, defaulting proactive off. The one test that needs proactive on enables it explicitly in Task 2.)

- [ ] **Step 6: Run green + format + commit**

```bash
( cd /Users/liamberger/Documents/private/Artemis && ./gradlew test --tests "de.tum.cit.aet.artemis.iris.IrisSettingsResourceIntegrationTest" --tests "de.tum.cit.aet.artemis.iris.domain.settings.IrisCourseSettingsTest" --tests "de.tum.cit.aet.artemis.iris.service.settings.IrisSettingsServiceTest" && ./gradlew spotlessApply ) 2>&1 | tail -12
git -C /Users/liamberger/Documents/private/Artemis add \
    src/main/java/de/tum/cit/aet/artemis/iris/domain/settings/IrisCourseSettings.java \
    src/main/java/de/tum/cit/aet/artemis/iris/service/settings/IrisSettingsService.java \
    src/test/java/de/tum/cit/aet/artemis/iris/struggle/IrisStruggleInterventionServiceTriggerTest.java \
    src/test/java/de/tum/cit/aet/artemis/iris/IrisSettingsResourceIntegrationTest.java \
    src/test/java/de/tum/cit/aet/artemis/iris/domain/settings/IrisCourseSettingsTest.java
git -C /Users/liamberger/Documents/private/Artemis commit -m "feat(iris): admin-only per-course proactiveStruggleEnabled setting (default off)"
```
(Run `IrisSettingsServiceTest` too — its ~20 `of(...)` calls use the kept 4-arg overload and must stay green.)

---

### Task 2: Artemis — gate the trigger + distinguish course-off from in-flight in the 202 (single settings read)

**Files:**
- Modify: `IrisStruggleInterventionService.java`, `StruggleInterventionAcceptedDTO.java`, `IrisStruggleInterventionResource.java`
- Test: `IrisStruggleInterventionServiceTriggerTest.java`, `IrisStruggleInterventionEndpointTest.java`, `IrisStruggleInterventionRoundTripTest.java`, `StruggleInterventionEventDTOTest.java`

**Interfaces:**
- Produces: `prepareTrigger` returns a typed `TriggerPreparation(@Nullable PreparedTrigger trigger, boolean courseDisabled)` (single settings read distinguishes course-off from in-flight); `requestStruggleIntervention` returns `StruggleTriggerOutcome(boolean accepted, boolean courseDisabled, @Nullable String jobToken)`; `StruggleInterventionAcceptedDTO(boolean accepted, boolean courseDisabled, long exerciseId, @Nullable String jobId)`; the endpoint returns `{accepted:false, courseDisabled:true}` for course-off and `{accepted:false, courseDisabled:false}` for an in-flight slot.

**Why a typed result (not a separate precheck).** `accepted:false` today means BOTH "course/Iris disabled" AND "a job is already in flight" (`addStruggleInterventionJobIfNonePending` returned empty). If the client mapped `accepted:false` → course-off, a slow (>30 s) Pyris job still in flight on a client re-POST would be mis-read as course-off and silently kill proactive help for the session. A separate `isProactiveEnabled` precheck would re-read settings and re-load the exercise (a TOCTOU + double load). Instead, `prepareTrigger` reads settings ONCE and returns *why* it rejected, and the resource derives `courseDisabled` from that single decision.

- [ ] **Step 1: Failing tests**

In `IrisStruggleInterventionServiceTriggerTest.java`, migrate the existing `prepareTrigger` assertions to the typed result and add the gate test (the class uses `service`, the `course` instance, constants `EX`/`USER_ID`/`user`):
```java
// in enabled_reservesSlotAndReturnsToken:  was result.isPresent() / result.get().jobToken()
assertThat(result.accepted()).isTrue();
assertThat(result.trigger().jobToken()).isEqualTo("tok");
// in disabledSettings_doesNotReserveOrEnqueue:  was result.isEmpty()
assertThat(result.accepted()).isFalse();
assertThat(result.courseDisabled()).isTrue();   // Iris disabled => course-off for proactive purposes
// in overlappingTrigger_isSkipped:  was assertThat(service.prepareTrigger(EX, user)).isEmpty()
var skipped = service.prepareTrigger(EX, user);
assertThat(skipped.accepted()).isFalse();
assertThat(skipped.courseDisabled()).isFalse();  // in-flight, NOT course-off

@Test
void proactiveDisabled_marksCourseDisabled() {
    when(irisSettingsService.getSettingsForCourse(course)).thenReturn(proactiveOffSettings());

    var result = service.prepareTrigger(EX, user);

    assertThat(result.accepted()).isFalse();
    assertThat(result.courseDisabled()).isTrue();
    verify(pyrisJobService, never()).addStruggleInterventionJobIfNonePending(anyLong(), anyLong(), anyLong());
}
```

In `IrisStruggleInterventionEndpointTest.java`, the `initTestCase` calls `activateIrisFor(course)` (→ `enableIrisFor`, which keeps the default proactive=off). The accepted-test needs proactive ON, so add this after the `activateIrisFor(...)` calls (the local `course` var is in scope; `AbstractIrisIntegrationTest` exposes `irisSettingsService`; add the `IrisCourseSettings` import):
```java
        var courseSettings = irisSettingsService.getSettingsForCourse(course);
        irisSettingsService.updateCourseSettings(course.getId(),
                IrisCourseSettings.of(courseSettings.enabled(), courseSettings.customInstructions(), courseSettings.variant(), courseSettings.rateLimit(), true), true);
```
Then add the course-off endpoint test + the accepted-test assertion:
```java
@Test
@WithMockUser(username = TEST_PREFIX + "student1", roles = "USER")
void courseProactiveDisabled_returnsAcceptedFalseCourseDisabled() throws Exception {
    var settings = irisSettingsService.getSettingsForCourse(exercise.getCourseViaExerciseGroupOrCourseMember());
    irisSettingsService.updateCourseSettings(exercise.getCourseViaExerciseGroupOrCourseMember().getId(),
            IrisCourseSettings.of(settings.enabled(), settings.customInstructions(), settings.variant(), settings.rateLimit(), false), true);

    var body = request.postWithResponseBody("/api/iris/chat/exercises/" + exerciseId() + "/struggle-intervention", requestBody(), StruggleInterventionAcceptedDTO.class,
            HttpStatus.ACCEPTED);
    assertThat(body.accepted()).isFalse();
    assertThat(body.courseDisabled()).isTrue();
}
```
```java
        // add in triggersStruggleInterventionPipeline_andReturnsAccepted, after the existing asserts:
        assertThat(accepted.courseDisabled()).isFalse();
```
And `IrisStruggleInterventionRoundTripTest.java` also only calls `activateIrisFor(...)` before POSTing, so add the same proactive-enable line to its setup (mirror the endpoint test's; use whichever course/exercise handle that test exposes). `StruggleInterventionEventDTOTest.java` constructs `StruggleInterventionAcceptedDTO` directly — those two lines are updated in Step 4 (compile fix).

- [ ] **Step 2: Run to verify failure**

```bash
( cd /Users/liamberger/Documents/private/Artemis && ./gradlew test --tests "de.tum.cit.aet.artemis.iris.struggle.IrisStruggleInterventionServiceTriggerTest" --tests "de.tum.cit.aet.artemis.iris.struggle.IrisStruggleInterventionEndpointTest" ) 2>&1 | tee /tmp/slice5a_t2.txt | tail -30
```
Expected: FAIL — `prepareTrigger` still returns `Optional`; DTO has no `courseDisabled`.

- [ ] **Step 3: Typed `prepareTrigger` + `requestStruggleIntervention` (single read)**

In `IrisStruggleInterventionService.java`, add the result records next to `PreparedTrigger`:
```java
    /** Why a trigger was (not) prepared, from a SINGLE settings read: a reserved trigger, or a rejection that is
     *  either a deliberate course-off (Iris/proactive disabled) or a transient in-flight skip. */
    public record TriggerPreparation(@Nullable PreparedTrigger trigger, boolean courseDisabled) {

        public boolean accepted() {
            return trigger != null;
        }

        static TriggerPreparation triggered(PreparedTrigger trigger) {
            return new TriggerPreparation(trigger, false);
        }

        static TriggerPreparation courseDisabled() {
            return new TriggerPreparation(null, true);
        }

        static TriggerPreparation inFlight() {
            return new TriggerPreparation(null, false);
        }
    }

    /** Outcome surfaced to the REST layer: accepted (with job token) or rejected, course-off carried for the 202. */
    public record StruggleTriggerOutcome(boolean accepted, boolean courseDisabled, @Nullable String jobToken) {
    }
```
Change `prepareTrigger` to return `TriggerPreparation` (one settings read, distinguishes the two empties):
```java
    public TriggerPreparation prepareTrigger(long exerciseId, User user) {
        var exercise = programmingExerciseRepository.findByIdElseThrow(exerciseId);
        var course = exercise.getCourseViaExerciseGroupOrCourseMember();
        authCheckService.checkHasAtLeastRoleForExerciseElseThrow(Role.STUDENT, exercise, user);
        var settings = irisSettingsService.getSettingsForCourse(course);
        if (!settings.enabled() || !settings.proactiveStruggleEnabled()) {
            return TriggerPreparation.courseDisabled();
        }
        var tokenOpt = pyrisJobService.addStruggleInterventionJobIfNonePending(course.getId(), user.getId(), exerciseId);
        if (tokenOpt.isEmpty()) {
            log.info("Struggle intervention already in flight for user {} exercise {}, skipping", user.getId(), exerciseId);
            return TriggerPreparation.inFlight();
        }
        return TriggerPreparation.triggered(new PreparedTrigger(course.getId(), exerciseId, user.getId(), settings.variant().jsonValue(), tokenOpt.get()));
    }
```
Change `requestStruggleIntervention` to return `StruggleTriggerOutcome`:
```java
    public StruggleTriggerOutcome requestStruggleIntervention(long exerciseId, PyrisStruggleSignalDTO signal, Map<String, String> uncommittedFiles, User user) {
        var prepared = prepareTrigger(exerciseId, user);
        if (!prepared.accepted()) {
            return new StruggleTriggerOutcome(false, prepared.courseDisabled(), null);
        }
        var p = prepared.trigger();
        CompletableFuture.runAsync(() -> sendToPyris(p, signal, uncommittedFiles)).exceptionally(e -> {
            log.error("Error sending struggle intervention to Iris for exercise {} user {}", p.exerciseId(), p.userId(), e);
            pyrisJobService.releaseStruggleInFlightJob(p.jobToken(), p.userId(), p.exerciseId());
            return null;
        });
        return new StruggleTriggerOutcome(true, false, p.jobToken());
    }
```

- [ ] **Step 4: DTO arity + resource mapping + the 2 direct DTO call sites**

In `StruggleInterventionAcceptedDTO.java`:
```java
@JsonInclude(JsonInclude.Include.NON_EMPTY)
public record StruggleInterventionAcceptedDTO(boolean accepted, boolean courseDisabled, long exerciseId, @Nullable String jobId) {
}
```
In `IrisStruggleInterventionResource.java` `triggerStruggleIntervention`, map straight from the outcome (one decision, no precheck):
```java
        var user = userRepository.getUserWithGroupsAndAuthorities();
        // Explicit server-side AI opt-in gate (spec §10), before any pipeline work.
        user.hasOptedIntoLLMUsageElseThrow();
        var outcome = struggleInterventionService.requestStruggleIntervention(exerciseId, requestDTO.struggleSignal(), requestDTO.uncommittedFiles(), user);
        return ResponseEntity.accepted().body(new StruggleInterventionAcceptedDTO(outcome.accepted(), outcome.courseDisabled(), exerciseId, outcome.jobToken()));
```
In `StruggleInterventionEventDTOTest.java`, update the two direct constructors (arity 3 → 4):
```java
        assertThat(new StruggleInterventionAcceptedDTO(true, false, 42, "tok").jobId()).isEqualTo("tok");
        assertThat(new StruggleInterventionAcceptedDTO(false, true, 42, null).courseDisabled()).isTrue();
```

- [ ] **Step 5: Run green + format + commit**

```bash
( cd /Users/liamberger/Documents/private/Artemis && ./gradlew test --tests "de.tum.cit.aet.artemis.iris.struggle.IrisStruggleInterventionServiceTriggerTest" --tests "de.tum.cit.aet.artemis.iris.struggle.IrisStruggleInterventionEndpointTest" --tests "de.tum.cit.aet.artemis.iris.struggle.IrisStruggleInterventionRoundTripTest" --tests "de.tum.cit.aet.artemis.iris.struggle.StruggleInterventionEventDTOTest" && ./gradlew spotlessApply ) 2>&1 | tail -12
git -C /Users/liamberger/Documents/private/Artemis add \
    src/main/java/de/tum/cit/aet/artemis/iris/service/session/IrisStruggleInterventionService.java \
    src/main/java/de/tum/cit/aet/artemis/iris/dto/StruggleInterventionAcceptedDTO.java \
    src/main/java/de/tum/cit/aet/artemis/iris/web/IrisStruggleInterventionResource.java \
    src/test/java/de/tum/cit/aet/artemis/iris/struggle/IrisStruggleInterventionServiceTriggerTest.java \
    src/test/java/de/tum/cit/aet/artemis/iris/struggle/IrisStruggleInterventionEndpointTest.java \
    src/test/java/de/tum/cit/aet/artemis/iris/struggle/IrisStruggleInterventionRoundTripTest.java \
    src/test/java/de/tum/cit/aet/artemis/iris/struggle/StruggleInterventionEventDTOTest.java
git -C /Users/liamberger/Documents/private/Artemis commit -m "feat(iris): gate proactive trigger on course setting + distinguish course-off from in-flight in 202"
```

---

### Task 3: Artemis Angular — admin toggle in the course Iris-settings page

**Files:**
- Modify: `iris-course-settings.model.ts`, `iris-settings-update.component.ts`, `iris-settings-update.component.html`, `i18n/en/iris.json`, `i18n/de/iris.json`
- Test: `iris-settings-update-component.spec.ts`

**Interfaces:**
- Produces: `IrisCourseSettingsDTO.proactiveStruggleEnabled?: boolean`; `createDefaultCourseSettings()` sets it `false`; `updateProactiveStruggleEnabled(value)` setter; an admin-only checkbox in the "Administrator Settings" section; non-admin saves restore the original value.

- [ ] **Step 1: Failing component test**

In `iris-settings-update-component.spec.ts`, extend `mockSettings` with `proactiveStruggleEnabled: false`, and add:
```ts
it('updateProactiveStruggleEnabled sets the flag on the settings signal', () => {
    component.settings.set({ ...mockSettings, proactiveStruggleEnabled: false });
    component.updateProactiveStruggleEnabled(true);
    expect(component.settings()?.proactiveStruggleEnabled).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure**

```bash
( cd /Users/liamberger/Documents/private/Artemis && pnpm exec vitest run src/main/webapp/app/iris/manage/settings/iris-settings-update/iris-settings-update-component.spec.ts ) 2>&1 | tee /tmp/slice5a_t3.txt | tail -25
```
Expected: FAIL — `updateProactiveStruggleEnabled` does not exist. (Artemis uses pnpm + Vitest 4; `package.json` `test:one` = `pnpm run prebuild && pnpm exec vitest run`. If a missing prebuild artifact makes the spec fail to load, run `pnpm run prebuild` once first.)

- [ ] **Step 3: Model field + default**

In `iris-course-settings.model.ts`, add to `IrisCourseSettingsDTO`:
```ts
    proactiveStruggleEnabled?: boolean;
```
and in `createDefaultCourseSettings()`:
```ts
    return {
        enabled: true,
        variant: 'default',
        proactiveStruggleEnabled: false,
    };
```

- [ ] **Step 4: Component setter + non-admin restore**

In `iris-settings-update.component.ts`, add the setter (mirror `updateVariant`):
```ts
    /**
     * Update the admin-only proactive-struggle flag in the settings signal (saved via the Save button).
     */
    updateProactiveStruggleEnabled(value: boolean): void {
        const currentSettings = this.settings();
        if (currentSettings) {
            this.settings.set({ ...currentSettings, proactiveStruggleEnabled: value });
        }
    }
```
and in `saveSettings()`, extend the non-admin restore block (where `variant`/`rateLimit` are restored) so a non-admin save cannot change it:
```ts
            if (originalSettingsValue) {
                settingsToSave.variant = originalSettingsValue.variant;
                settingsToSave.rateLimit = originalSettingsValue.rateLimit;
                settingsToSave.proactiveStruggleEnabled = originalSettingsValue.proactiveStruggleEnabled;
            }
```
Also fix the dirty-check so a server-omitted `false` (the backend's `@JsonInclude(NON_EMPTY)` drops `false` on the wire, so the loaded value can arrive `undefined`) does not read as dirty against an explicit `false`. In `normalizeSettingsForComparison`, coerce the flag to a boolean:
```ts
        return {
            ...settings,
            customInstructions: this.normalizeEmpty(settings.customInstructions) as string | undefined,
            proactiveStruggleEnabled: !!settings.proactiveStruggleEnabled,
        };
```

- [ ] **Step 5: HTML checkbox in the Administrator Settings section**

In `iris-settings-update.component.html`, inside the `@if (isAdmin()) { … }` admin section (next to the "Pipeline Variant" block, using the `settingsValue` alias the section already uses), add:
```html
        <!-- Proactive struggle detection (A/B condition, spec §13) -->
        <div class="mb-3 form-check">
            <input
                id="proactiveStruggleEnabled"
                type="checkbox"
                class="form-check-input"
                [ngModel]="settingsValue.proactiveStruggleEnabled"
                (ngModelChange)="updateProactiveStruggleEnabled($event)"
            />
            <label class="form-check-label" for="proactiveStruggleEnabled">
                <strong jhiTranslate="artemisApp.iris.settings.proactiveStruggle"></strong>
            </label>
            <p class="form-text" jhiTranslate="artemisApp.iris.settings.proactiveStruggleHelp"></p>
        </div>
```

- [ ] **Step 6: i18n (en + de)**

In `src/main/webapp/i18n/en/iris.json`, in the `settings` object next to `variant`/`variantHelp`:
```json
"proactiveStruggle": "Proactive Struggle Detection",
"proactiveStruggleHelp": "When enabled, Iris proactively detects when a student is stuck and offers help. Off by default; enable only for courses in the proactive A/B condition.",
```
In `src/main/webapp/i18n/de/iris.json`, same keys:
```json
"proactiveStruggle": "Proaktive Schwierigkeitserkennung",
"proactiveStruggleHelp": "Wenn aktiviert, erkennt Iris proaktiv, wenn ein Student nicht weiterkommt, und bietet Hilfe an. Standardmäßig aus; nur für Kurse in der proaktiven A/B-Bedingung aktivieren.",
```

- [ ] **Step 7: Run green + commit**

```bash
( cd /Users/liamberger/Documents/private/Artemis && pnpm exec vitest run src/main/webapp/app/iris/manage/settings/iris-settings-update/iris-settings-update-component.spec.ts ) 2>&1 | tail -25
git -C /Users/liamberger/Documents/private/Artemis add \
    src/main/webapp/app/iris/shared/entities/settings/iris-course-settings.model.ts \
    src/main/webapp/app/iris/manage/settings/iris-settings-update/iris-settings-update.component.ts \
    src/main/webapp/app/iris/manage/settings/iris-settings-update/iris-settings-update.component.html \
    src/main/webapp/app/iris/manage/settings/iris-settings-update/iris-settings-update-component.spec.ts \
    src/main/webapp/i18n/en/iris.json \
    src/main/webapp/i18n/de/iris.json
git -C /Users/liamberger/Documents/private/Artemis commit -m "feat(iris): admin toggle for proactive struggle detection in course settings"
```

---

### Task 4: Extension client — read the 202 `courseDisabled` flag

**Files:**
- Modify: `extension/src/extension/services/struggleIntervention/struggleContract.ts`, `extension/src/extension/api/artemisApi.ts`
- Test: `extension/test/logic/struggleIntervention/struggleInterventionService.test.ts` (Task 5 covers the orchestrator side; here only the contract/api types change, gated by `check-types`)

**Interfaces:**
- Produces: `StruggleEgressResult` gains `'course-off'`; `StruggleInterventionAccepted` gains `courseDisabled?: boolean`; `postStruggleIntervention` returns `'course-off'` only when the 202 body has `accepted === false && courseDisabled === true`.

- [ ] **Step 1: Extend the contract types**

In `struggleContract.ts`:
```ts
/** 202 response body of the trigger (Plan 2 StruggleInterventionAcceptedDTO). */
export interface StruggleInterventionAccepted {
    accepted: boolean;
    /** True only when proactive is off for this course (§13) — distinct from an in-flight `accepted:false`. */
    courseDisabled?: boolean;
    exerciseId: number;
    jobId?: string | null;
}
```
and extend the result union + its doc:
```ts
/**
 * Outcome of the trigger POST (spec §9/§11/§13). `accepted` → enqueued, await the websocket decision; `course-off`
 * → proactive is disabled for this course (§13), so the client pauses proactive for the session with NO no-AI lamp;
 * `unavailable` → the endpoint is missing (404 — old/feature-less Artemis), so the client degrades to the no-AI lamp
 * (spec §11); `failed` → a transient 4xx/5xx/network error → treat as silent.
 */
export type StruggleEgressResult = 'accepted' | 'course-off' | 'unavailable' | 'failed';
```

- [ ] **Step 2: Read the 202 body in `postStruggleIntervention`**

In `artemisApi.ts`, import the body type and read it:
```ts
import type { StruggleEgressResult, StruggleInterventionAccepted, StruggleInterventionRequest } from '@extension/services/struggleIntervention/struggleContract';
```
```ts
    async postStruggleIntervention(exerciseId: number, body: StruggleInterventionRequest): Promise<StruggleEgressResult> {
        try {
            const response = await this.makeRequest(`/api/iris/chat/exercises/${exerciseId}/struggle-intervention`, {
                method: 'POST',
                body: JSON.stringify(body),
            });
            // Course-off (§13) is a deliberate instructor choice: pause proactive with no lamp. An in-flight
            // `accepted:false` (courseDisabled false/absent) is NOT course-off — treat it as accepted (a job is
            // already running; await its websocket decision).
            const accepted = await response.json().catch(() => null) as StruggleInterventionAccepted | null;
            if (accepted?.accepted === false && accepted?.courseDisabled === true) {
                return 'course-off';
            }
            return 'accepted';
        }
        catch (error) {
            // A 404 means this Artemis lacks the endpoint (old / feature-less) → degrade to the no-AI lamp for the
            // session (spec §11). Any other failure (transient 5xx / network / 401) → silent.
            if (error instanceof ApiError && error.status === 404) {
                return 'unavailable';
            }
            return 'failed';
        }
    }
```

- [ ] **Step 3: Type-check + commit (orchestrator handling lands in Task 5)**

```bash
( cd /Users/liamberger/Documents/private/MA/artemis-extension/extension && npm run check-types ) 2>&1 | tail -15
git -C /Users/liamberger/Documents/private/MA/artemis-extension add \
    extension/src/extension/services/struggleIntervention/struggleContract.ts \
    extension/src/extension/api/artemisApi.ts
git -C /Users/liamberger/Documents/private/MA/artemis-extension commit -m "feat(struggle): read the 202 courseDisabled flag (distinguish course-off from in-flight)"
```

---

### Task 5: Extension orchestrator — latch proactive-off for the session

**Files:**
- Modify: `extension/src/extension/services/struggleIntervention/struggleInterventionService.ts`
- Test: `extension/test/logic/struggleIntervention/struggleInterventionService.test.ts`

**Interfaces:**
- Produces: a `_courseProactiveOff` session latch. After a `'course-off'` POST result the orchestrator surfaces nothing (no fallback lamp) and stops POSTing for the session; the latch clears on `reset()` (re-probe next exercise), alongside `_serverAvailable`.

- [ ] **Step 1: Failing logic test**

In `struggleInterventionService.test.ts`, add (use the file's real helpers: the `fakeDeps(over)` builder, `alert()`, `tick(n)`; `deliver()` is void, so flush a macrotask with `await new Promise(r => setTimeout(r, 0))` like the existing POST-path tests; `setTimeoutFn` is a no-op in `fakeDeps`, so the only thing clearing in-flight is the course-off branch / `reset()`):
```ts
it('course-off latches: no fallback lamp, and no second POST for the session', async () => {
    const post = vi.fn(async () => 'course-off' as const);
    const deps = fakeDeps({ postIntervention: post });
    const svc = new StruggleInterventionService(deps);
    svc.onTick(tick(530));

    svc.deliver(alert());
    await new Promise(r => setTimeout(r, 0));
    expect(post).toHaveBeenCalledTimes(1);
    expect(deps.showAmbient).not.toHaveBeenCalled();   // course-off => no no-AI lamp

    svc.deliver(alert());
    await new Promise(r => setTimeout(r, 0));
    expect(post).toHaveBeenCalledTimes(1);             // latched: no second POST

    svc.reset();                                       // new exercise / re-probe clears the latch
    svc.deliver(alert());
    await new Promise(r => setTimeout(r, 0));
    expect(post).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run to verify failure**

```bash
( cd /Users/liamberger/Documents/private/MA/artemis-extension/extension && npx vitest run test/logic/struggleIntervention/struggleInterventionService.test.ts ) 2>&1 | tail -25
```
Expected: FAIL — the second deliver still POSTs (no latch) and/or course-off falls through to the fallback lamp.

- [ ] **Step 3: Implement the latch**

In `struggleInterventionService.ts`:
- Add the field next to `_serverAvailable`:
```ts
    private _courseProactiveOff = false;
```
- In `_handleAlert`, after the `alert.kind !== 'edit'` guard, short-circuit when latched (no POST, no surface):
```ts
        if (this._courseProactiveOff) {
            this._dbg('  ↳ SKIP (course proactive disabled for this session)');
            return;
        }
```
- After the POST, handle the `'course-off'` result (mirror the `'unavailable'` branch, but NO fallback lamp):
```ts
            if (result === 'course-off') {
                this._dbg('  ↳ COURSE-OFF: proactive disabled for this course → pause session, no lamp');
                this._courseProactiveOff = true;
                this._setInFlight(false);
                return;
            }
            if (result === 'unavailable') {
                this._serverAvailable = false;
                this._setInFlight(false);
                this._fallback(signal);
            }
```
- In `reset()`, clear the latch alongside `_serverAvailable` (re-probe next session; per-session latch, spec §13):
```ts
        this._serverAvailable = true;        // re-probe the server next session: a 404 latch is per-session (spec §11)
        this._courseProactiveOff = false;    // course-off is also a per-session latch (spec §13): re-probe next exercise
```

- [ ] **Step 4: Run green + type-check + commit**

```bash
( cd /Users/liamberger/Documents/private/MA/artemis-extension/extension && npx vitest run test/logic/struggleIntervention/struggleInterventionService.test.ts && npm run check-types ) 2>&1 | tail -20
git -C /Users/liamberger/Documents/private/MA/artemis-extension add \
    extension/src/extension/services/struggleIntervention/struggleInterventionService.ts \
    extension/test/logic/struggleIntervention/struggleInterventionService.test.ts
git -C /Users/liamberger/Documents/private/MA/artemis-extension commit -m "feat(struggle): pause proactive (no lamp) when the course disables it"
```

---

## Self-review checklist

- **Spec coverage:** §13 course toggle end-to-end (Tasks 1-3: admin-only setting, prepareTrigger gate, admin UI); §13 client 202 read (Task 4); §14 row-1 behaviour — course-off pauses proactive with NO no-AI lamp, distinct from a 404 (Tasks 4-5). Student-facing surfacing of the state (AskIris card / banner) is **deferred to Slice 5b** (called out, not silently assumed).
- **Default off (§13):** record DEFAULT `false`, missing-JSON → `false`, Angular `createDefaultCourseSettings` `false`. Existing courses stay off until an admin enables.
- **No DB migration:** JSON column; a new record key, not a schema change. `@JsonInclude(NON_EMPTY)` omits `false`, so old rows round-trip.
- **Admin-only (§13):** `enforceInstructorRestrictions` rejects a non-admin change (server-enforced, 403), mirroring `variant`/`rateLimit`; the Angular save also restores the original value for non-admins; the toggle renders only inside the `@if (isAdmin())` block.
- **Correctness — course-off vs in-flight (codex r1):** distinguished from a SINGLE settings read — `prepareTrigger` returns a typed `TriggerPreparation` (triggered / course-disabled / in-flight), `requestStruggleIntervention` surfaces `StruggleTriggerOutcome`, so the 202 `courseDisabled` is exact (no second read, no TOCTOU, no double exercise load). The client treats ONLY `accepted:false && courseDisabled:true` as course-off, so a slow in-flight job is never mis-read as a course disable.
- **Course-off ≠ 404:** `'course-off'` → pause, **no lamp**; `'unavailable'` (404) → **fallback lamp** (§14 rows 1 vs 5 stay distinct). Per-session latch cleared on `reset()`, like `_serverAvailable`.
- **Arity ripple handled (codex r1):** the 4-arg `of(...)` is **kept** as a default-false overload, so the ~40 `of(...)` call sites (`AbstractIrisIntegrationTest`, `IrisSettingsServiceTest`, `IrisSettingsResourceIntegrationTest`, `IrisCourseSettingsTest`) compile unchanged. Only the 4 direct `new IrisCourseSettings(4-arg)` sites change (DEFAULT + `of` body in the record; the 2 trigger-test helpers), plus the 3 `StruggleInterventionAcceptedDTO(...)` sites (resource + 2 in `StruggleInterventionEventDTOTest`). The proactive flag defaults off everywhere; the struggle-endpoint accepted-test AND the round-trip test enable it explicitly in setup.
- **Dirty-check false-vs-undefined (codex r1):** `@JsonInclude(NON_EMPTY)` drops `false` on the wire, so the loaded flag may be `undefined`; `normalizeSettingsForComparison` coerces it to a boolean so a clean load is not falsely "dirty".
- **Mirrors existing patterns:** admin-only enforcement = `variant`/`rateLimit`; the Angular setter = `updateVariant`; i18n keys next to `variant`/`variantHelp`; the client latch = the `_serverAvailable` 404 latch.
- **Placeholder scan:** every step shows the actual code or mirrors a named existing method; tests reuse the host classes' real fixtures/helpers by name (verified: `course1`/`"admin"`/`instructor1` in `IrisSettingsResourceIntegrationTest`; `service`/`EX`/`USER_ID`/`course` in the trigger test; pnpm + Vitest 4 for Angular).
