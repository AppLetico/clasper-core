# Contributing to Clasper Core

Thanks for helping make Clasper Core better. Small PRs are welcome (docs, tests, refactors, features). Forks are welcome too.

Clasper is early and evolving — thoughtful contributions matter more than volume.

## Contribution philosophy (read this first)

Clasper is a **governance-first** system. Its primary job is to decide whether execution is allowed, not to make execution easier.

When contributing, optimize for:

- **Explicit authority over convenience**  
  If a change makes something "just work" by default, ask whether it weakens governance.

- **Fail-closed behavior over permissive defaults**  
  Unknowns should surface clearly, not silently pass.

- **Durable rules over one-off actions**  
  Prefer policies and explainable decisions over ad-hoc overrides.

- **Evidence over outcomes**  
  Traces, decisions, and explanations matter as much as execution results.

A good mental model:

> If Clasper were being audited after an incident, would this change make it easier or harder to explain why something happened?  
> If it makes that explanation weaker, it probably doesn't belong in Core.

## What Clasper Core is (and is not)

Clasper Core **enforces authority before execution**.

It is intentionally opinionated about:

- pre-execution decisioning
- explicit policies
- no-bypass guarantees
- auditable outcomes

It is intentionally **not** optimized for:

- "just let it run"
- implicit trust in tools, skills, or adapters
- automatic remediation without policy
- convenience shortcuts that bypass governance

## License + CLA (important)

- **No CLA required.**
- By contributing, you agree your contributions are licensed under the project's **Apache-2.0** license (inbound = outbound).

## Scope boundary: Core vs Cloud

Clasper Core is intended to stay **maximally useful when self-hosted** for single-operator or local governance workflows.

**Great fits for clasper-core PRs**

- Policy evaluation and decision semantics
- Adapter contracts and execution gating
- Trace, audit, and evidence primitives
- Local approvals (self-attested, clearly labeled)
- Ops Console UX that explains decisions
- CLI and local tooling
- Workspace-driven configuration
- Extensibility points that preserve no-bypass guarantees

**Usually out of scope here (may be redirected)**

- Multi-tenant control planes
- Org-wide RBAC and separation of duties
- Hosted identity, secrets, or signing services
- Fleet-wide dashboards or alerting
- Compliance reporting or external attestations

If you're unsure, open an issue with a short proposal. We care more about direction than speed.

## Design guardrails (non-negotiable)

When proposing or implementing changes:

- **No implicit allow paths** — If something is allowed, it must be explainable.
- **No silent bypasses** — Partial governance is worse than no governance.
- **No auto-mutating governance state** — Plugins and adapters must not auto-create policies or approvals.
- **No "fix it" buttons** — UI may assist policy creation, but must not grant authority directly.
- **No retroactive authority** — Policies affect future executions, not past ones.

If a feature needs an escape hatch, it must be:

- explicit
- visible in audit/trace
- clearly labeled as unsafe or dev-only

## Setup

```bash
npm install
cp .env.example .env
```

## Dev workflow

```bash
npm run dev
```

## Tests

```bash
npm test              # Run all tests
npm test -- --watch   # Watch mode
```

### Test structure

- `src/lib/*.test.ts` – unit tests for governance logic
- `src/server/*.test.ts` – API and decision-path tests

When adding features, prefer tests that assert:

- decision outcome
- explanation
- audit/trace side effects

Not just return values.

## Style + portability guidelines

- Keep modules small and focused.
- Prefer explicit errors with clear explanations.
- Avoid hardcoding project-specific logic.
- Use workspace files for domain-specific configuration.
- Keep defaults conservative and explainable.
- Add new config to `.env.example`.
- Document behavioral changes clearly.

Clasper Core is meant to be reusable across runtimes and ecosystems.

## Adding a new feature

1. Implement in `src/lib/` or `src/server/`
2. Add tests (`.test.ts`) that cover decision paths
3. Update `.env.example` if config is added
4. Update docs if behavior or semantics change

If a feature changes authority semantics, call it out explicitly in the PR description.

## Workspace changes

If modifying workspace loading or semantics:

1. Update `src/lib/workspace.ts`
2. Add tests in `src/lib/workspace.test.ts`
3. Update example workspaces in `docs/examples/`
4. Document how the change affects governance behavior

## Pull request checklist

- [ ] Tests pass (`npm test`)
- [ ] Build succeeds (`npm run build`)
- [ ] No implicit allow or bypass paths introduced
- [ ] Authority decisions remain explicit and explainable
- [ ] `.env.example` updated if config added
- [ ] Docs updated if behavior or semantics changed

## Final note

Clasper Core is building the authority layer agent systems are missing.

If a change makes Clasper feel more powerful but less accountable, it's probably the wrong change.

When in doubt, choose:

**clarity over convenience**

That's the project.
