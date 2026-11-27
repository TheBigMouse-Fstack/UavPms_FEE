# UAV-PMS Frontend — AI-Native Engineering Map

Angular 21 frontend for UAV Powerline Monitoring System (UAV-PMS).
Keep this file concise (~100 lines). Detailed workflows live in `.agents/skills/` (load on demand) and `docs/`.

## 1. Fast Verification Commands

Run the narrowest check during iteration and `npm run verify:all` before any PR:

```bash
npm run verify:all                                  # policy + arch + lint + unit tests + build
npm run check:policy                                # UAV security guard (no online maps, secret/log leaks)
npm run check:arch                                  # Feature/layer import boundary check
npm run lint                                        # ESLint (TS + Angular + template a11y)
npx ng test --watch=false --include=<spec-path>     # Targeted Vitest spec
npx ng test --watch=false                           # Full Vitest suite
npm run build                                       # Production bundle check
npm run test:e2e                                    # Playwright E2E suite
```

## 2. Repository Map

- `src/app/core/` — Auth (`authGuard`, `roleGuard`, JWT interceptor), facility store, HTTP interceptors, layout shell, SignalR/serial services.
- `src/app/models/` — Strict domain TypeScript interfaces (no Angular UI dependencies).
- `src/app/shared/` — Reusable UI primitives, pipes, error/status mappers, idempotency helpers (must NOT import from `features/`).
- `src/app/features/<domain>/` — Lazy-loaded feature modules:
  - `data-access/` — API transport, payload normalizers, signal stores (ONLY layer allowed to parse raw API payloads or inject `HttpClient`).
  - `pages/` & `components/` — Presentation & orchestration (`OnPush`, signals). Features must NOT cross-import each other.
- `.specify/memory/constitution.md` — Immutable engineering & security invariants (`C-01..C-07`, locked by `.claude/hooks/`).
- `CLAUDE.md` & `.claude/` — Runtime guardrails (`PreToolUse` `exit 2` with `SDD_PHASE=SPEC|RED|CODE`, `.claude/locked-tests.txt`, scoped `.claude/rules/`, `spec-checker` subagent).
- `specs/` — EARS/GEARS living specs (`specs/_template/` `{spec,acceptance}.md`) and 10-column matrix (`specs/RTM.md`).
- `docs/` — Single source of truth: `MASTER_SYSTEM_SPEC.md` (v2.0), `AI_SECURITY_AND_GOVERNANCE.md`, `contracts/openapi.json` & `contracts/HANDOFF.md`, `TEAM_MVP_ACTION_PLAN.md`, `ANGULAR_ARCHITECTURE.md`, `mainflows/`. *(Legacy `CODING_STANDARDS.md`/`api_spec.md` are marked `DEPRECATED`.)*

## 3. Non-Negotiable Engineering Rules

- **TypeScript**: Strict mode; infer obvious types; never use `any` (use `unknown` + boundary validation).
- **Angular 21**: Standalone components by default (**do NOT** set `standalone: true` in decorators); `ChangeDetectionStrategy.OnPush`; `inject()` instead of constructor DI; `input()`/`output()`/`computed()`; signals with `.set()`/`.update()` (never `.mutate()`).
- **Templates**: Native control flow (`@if`, `@for`, `@switch`); no `ngClass`/`ngStyle` (use `[class.*]`/`[style.*]`); no `@HostBinding`/`@HostListener` (use `host` metadata); `NgOptimizedImage` for static images (not base64); Reactive forms; no unguarded globals (`new Date()`).
- **Accessibility**: Must pass AXE / WCAG 2.2 AA (keyboard focus, contrast, ARIA, semantic roles).
- **Readability & Defense**: Write linear, plain, human-defendable code (no nested ternaries, no dense one-liners, no copy-pasted micro-helpers, plain comments explaining business WHY). Always load `.agents/skills/readable-code-defense/SKILL.md` for coding/review tasks.

## 4. Security & High-Risk Boundaries

Read `docs/AI_SECURITY_AND_GOVERNANCE.md` before touching auth, GIS, upload, or logging:
- **Sensitive data**: GIS coordinates, UAV images, defects, maintenance tickets, emails, JWTs. Never send to third-party AI/map/analytics services or log raw payloads.
- **Local-only GIS**: Maps MUST use local PMTiles / GeoJSON / local assets. Never add Google Maps, OSM, Mapbox, or remote tile/CDN fallbacks.
- **RBAC**: Roles are strictly `SystemAdmin`, `Manager`, `Inspector`, `Analyst`, `Technician`. Never invent roles; backend enforces authority; handle 401/403/refresh-loading gates safely.
- **Human-Approval-Required Zones** (stop & confirm plan before editing): `src/app/core/auth/**`, `src/app/features/gis/**`, `docs/AI_SECURITY_AND_GOVERNANCE.md`, `.github/workflows/**`.

## 5. AI-Native Execution Workflow (v2.0 — Zero-Tradeoff Speed & Security)

1. **Mainflow / Demo First**: Always ask the user's nearest deadline (Demo / Milestone) and verify real app bugs (screenshots / Network / Console) BEFORE proposing refactors or CI/YAML work.
2. **Explore → Plan → Verify Plan → Code → Verify**: Read target files first, state scope & non-goals, get plan approval for non-trivial changes, then edit and verify.
3. **Right-Sized Process & Gate 5**: For core features or mainflow/security changes, create `specs/<REQ-ID>-<slug>/` (`spec.md` + `acceptance.md`) and lock acceptance tests BEFORE coding, then update `specs/RTM.md`. For small UI hotfixes before a demo, 1 coding chat + targeted test + manual browser check is sufficient.
4. **Vertical Slice Small Batches**: Scope 1 feature/security fix per slice (~250–450 lines). Mechanical refactors across homogeneous files or pure dead-code deletions may group by domain (~500 modified lines, excluding pure deletions).
5. **Clean Working Tree**: Park unrelated WIP on a dedicated `wip/*` branch before starting a new `REQ` so `git diff` stays clean and never leaks WIP into PRs.
6. **Targeted Iteration → Single Full Gate**: During iteration, run targeted Vitest (`npx ng test --watch=false --include=<spec>`) + `npm run lint:changed`. Run full `npm run verify:all` once before Judge review.
7. **Risk-Tiered Pragmatic Judge (Anti-Banking Ceiling)**: Never let the coding session self-approve security/core logic. Run `.agents/skills/pr-review-judge/SKILL.md` in a clean session once per slice (target max 1 fix round; respect Human accept-risk overrides; never block on hypothetical enterprise SRE scenarios):
   - **Tier 1 (Auth, GIS, RBAC, Upload, State Machine)**: Strict real-security & correctness gate.
   - **Tier 2 (Standard UI / Refactor)**: 1 pragmatic pass — block only real logic/A11y/arch/test-integrity defects (max 3 non-blocking).
   - **Tier 3 (CI/YAML/Docs)**: Static tools (`check:policy`, `check:arch`) + 1 pragmatic security pass (no over-engineering).
8. **Domain Chat Reset**: Reset coding/judge sessions when switching domains or `REQ`s to prevent context compaction and token bloat.

## 6. On-Demand Skills (`.agents/skills/`)

Load only the skill relevant to the current task:
- `angular-feature/SKILL.md` — Implementing or refactoring Angular 21 features (`data-access` → store → UI → Vitest).
- `readable-code-defense/SKILL.md` — Keeping FE & BE code simple, linear, helper-free, and easy to explain during live code inspection.
- `uav-security-gate/SKILL.md` — Auditing UAV-PMS security, RBAC, local-only GIS, and PII/secret hygiene.
- `playwright-e2e/SKILL.md` — Writing role-based Playwright E2E and WCAG AA accessibility tests.
- `pr-review-judge/SKILL.md` — Running an independent LLM-as-Judge review on a PR diff against its spec.
