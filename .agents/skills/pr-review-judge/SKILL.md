---
name: pr-review-judge
description: Independent LLM-as-Judge PR review rubric to run in a clean session against git diff and the feature spec before human approval.
---

# Independent PR Review Judge

Run this skill in a **separate, clean agent session** (never the same session that generated the code).

## Inputs Required

1. `git diff origin/main...HEAD` (or staged diff).
2. Linked `specs/<REQ-ID>/spec.md` and `specs/<REQ-ID>/acceptance.md` (if feature PR).

## Review Rubric (Check in Order)

1. **Scope Discipline**:
   - Did the PR touch files outside the stated task/spec? Flag any unrequested refactors or "drive-by" edits.
   - Is the PR size within Small Batches guidelines (≤ 400 lines excluding lockfiles)?
2. **Correctness & Edge Cases**:
   - Compare every acceptance criterion in `acceptance.md` against the implementation and tests.
   - Look for subtle logic bugs: race conditions, stale signal reads, missing `track` keys, unhandled `401`/`403`/empty/null responses.
3. **Test Integrity (Anti "Perpetually Green")**:
   - Do tests actually fail if the core business logic is broken?
   - Flag tests that only mock everything away or assert trivial rendering without checking behavior.
4. **UAV-PMS Security & Angular Compliance**:
   - Check `uav-security-gate` rules (local-only maps, RBAC, no secret/PII logging, no unsanitized HTML).
   - Check Angular 21 rules (no `any`, `OnPush`, signals, `inject()`, no cross-feature imports).
5. **Code Readability & Defense Readiness (`readable-code-defense/SKILL.md`)**:
   - Flag overly clever one-liners, nested ternaries, cryptic abbreviations, jargon-heavy comments, or newly copy-pasted helper functions (`record`, `stringValue`, `parseDate`, etc.).
   - If a developer cannot easily trace and explain a function line-by-line in a live code inspection, request simplification as a blocking issue.
6. **Pragmatic Scope Ceiling (Anti-Banking Over-Engineering)**:
   - Context: graduation project / real operational MVP — **NOT** Tier-1 Banking SRE.
   - **Blocking ONLY for real defects**: broken Mainflow / acceptance criteria, real P0 security/RBAC/PII/online-map/XSS flaws, compile or runtime bugs, perpetually-green tests, or WIP leaks.
   - **NEVER Blocking** for hypothetical enterprise SRE scenarios (e.g., internal runner tampering, cosmetic micro-refactors, or speculative edge cases outside spec) — put those in **Non-blocking (max 3)** or backlog.
   - Target **at most 1 fix round** per slice. When the Human Owner explicitly accepts a risk or defers an item to backlog, immediately respect it and do not re-block.

## Output Format

Return a concise verdict: **`APPROVE_FOR_HUMAN_REVIEW`** or **`CHANGES_REQUESTED`**, followed by:
- **Blocking issues** (file:line + why + concrete fix)
- **Non-blocking suggestions** (max 3)
- **Uncovered acceptance criteria** (if any)
