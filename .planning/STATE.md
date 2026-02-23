# State

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-02-23 — Milestone v1.0 started

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-23)

**Core value:** Students can interact with Artemis courses, exercises, and the Iris AI tutor without leaving VS Code.
**Current focus:** React Webview Migration

## Accumulated Context

- Codebase mapped: .planning/codebase/ contains full architecture, stack, structure, concerns, conventions analysis
- Key concern: ExerciseDetail and ExamExerciseDetail share ~70% code via component imports — React migration should formalize this
- Key constraint: Exam timers and chat streaming must not regress
- Build pipeline is esbuild with dual outputs; open to switching for React support
