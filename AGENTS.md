## Clasper Core — Agent Guidance

You are working on **Clasper Core**, the local governance engine for AI execution. It decides whether execution is allowed, under what constraints, and produces self-attested evidence.

### Project Structure

- `src/` — Core: policy engine, adapters, workspace, tracing, auth, ops
- `src/ops-ui/` — Preact Ops Console (traces, policies, approvals, audit, governance health, agents, incidents)
- `integrations/openclaw/` — OpenClaw adapter plugin and policies
- `docs/` — Documentation; full docs at clasper.ai/docs

### Tech Stack

- TypeScript (Node 22+), Preact for Ops UI, SQLite (better-sqlite3), Fastify

### Conventions

- Use ESM (`import`/`export`); no `require`
- Policy conditions: deterministic fields (`tool`, `tool_group`, `agent_id`, `agent_role`, `actor`, `action`, `resource`, `context.*`) over heuristics
- Adapter contract: `ExecutionDecision`, `ExecutionScope` in `src/lib/adapters/executionContract.ts`; adapters can register `certification_tier` and `tool_capabilities`
- Ops API: `/ops/api/*` with `requireOpsContextFromHeaders`; traces use `traceStore.list()` with filters; governance uses `loadGovernanceMaps` + `buildGovernanceView`

### Ops Console Views

- **Dashboard** — Traces, risk, cost, approvals
- **Traces** — List with filters (agent_id, risk_level, adapter); trace detail with execution graph
- **Governance Health** — Approval/denial rates, risk distribution, adapter errors
- **Policies** — CRUD, dry-run, policy test (actor/action/resource)
- **Approvals** — Pending decisions queue
- **Agents** — Agent inventory from traces (agent_id, agent_role)
- **Incidents** — Denied/error traces; inspect + export evidence
- **Audit** — Audit log
- **Adapters** — Registry with certification badges and tool capabilities

### Commands

- `npm run dev` — Start Core
- `npm run build` — TypeScript + ops UI bundle
- `npm test` — Vitest
- `make seed-openclaw-policies` or `npx clasper-core seed openclaw` — Seed OpenClaw policies
- `clasper test [file]` — Run policy tests from YAML
- `clasper export` — Create self-attested export bundle (Ops API)

### Session Metadata (Optional)

If used with Agent Orchestrator:

```bash
~/.ao/bin/ao-metadata-helper.sh  # sourced automatically
# Then call: update_ao_metadata <key> <value>
```
