# Contributing to Clasper Core

Thanks for helping make **Clasper Core** better. Small PRs are welcome (docs, tests, refactors, features). Forks are welcome too.

## Contribution philosophy

- **Developer-first**: if you can make Core easier to run, easier to integrate, or easier to trust, that’s a great contribution.
- **Experimental is fine**: propose ideas early; we can iterate in public.
- **No surprises**: we try to keep behavior explicit and well-documented.

## License + CLA (important)

- **No CLA required.**
- By contributing, you agree your contributions are licensed under the project’s **Apache-2.0** license (the standard “inbound = outbound” model).

## Scope boundary: Core vs Cloud

Clasper Core is intended to stay **maximally useful when self-hosted** (local governance + optional local execution).

- **Great fits for `clasper-core` PRs**: policy evaluation, traceability, adapters/contracts, local audit/logging primitives, CLI/Ops Console, workspace-driven configuration, extensibility points.
- **Usually out of scope here** (and may be redirected): multi-tenant control plane, hosted storage/analytics, org-wide dashboards, hosted alerting, hosted identity/secrets brokering, fleet-wide governance controls, compliance reporting.

If you’re unsure, open an issue with a short proposal — we’ll route it.

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

- `src/lib/*.test.ts` - Unit tests for library modules
- `src/server/*.test.ts` - API endpoint tests

### Writing tests

```typescript
import { describe, expect, it } from "vitest";

describe("MyModule", () => {
  it("does something", () => {
    expect(result).toBe(expected);
  });
});
```

## Style + portability guidelines

- Keep modules small and focused.
- Prefer explicit errors with clear messages.
- **Avoid hardcoding project-specific names** in core logic.
- Use workspace files for project-specific configuration.
- Keep new config in `.env.example`.

Clasper Core is designed to be reusable across projects:

1. **No hardcoded domain logic** - Use workspace files for personas/rules
2. **Configurable via env vars** - Add new config to `.env.example`
3. **Generic defaults** - Fallbacks should be project-agnostic
4. **Document configuration** - Update docs when adding features

## Adding a new feature

1. Implement in `src/lib/` or `src/server/`
2. Add tests in the same directory (`.test.ts`)
3. Update `.env.example` if new config is needed
4. Update relevant docs

## Adding a new script

1. Add your script in `src/scripts/`
2. Add a npm script in `package.json`
3. Add a CLI command in `src/cli.ts` if needed
4. Document it in `docs/`

## Workspace changes

If modifying the workspace loader:

1. Update `src/lib/workspace.ts`
2. Add tests in `src/lib/workspace.test.ts`
3. Update relevant docs
4. Update example workspaces in `docs/examples/`

## Pull request checklist

- [ ] Tests pass (`npm test`)
- [ ] Build succeeds (`npm run build`)
- [ ] No project-specific hardcoding in core modules
- [ ] `.env.example` updated if new config added
- [ ] Docs updated if behavior changed
