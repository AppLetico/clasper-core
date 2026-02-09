# Clasper Core — Local Governance Engine for AI Execution

<p align="center">
  <img src="clasper-banner.png" alt="Clasper" width="100%" />
</p>

<h2 align="center">Local Governance for AI Execution</h2>

<p align="center">
  <b>Governance first. Execution optional.</b>
  <br />
  <i>Single-tenant, self-attested governance for teams that want control without external trust dependencies.</i>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/version-1.2.1-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/built_with-TypeScript-blue.svg" alt="TypeScript">
  <img src="https://img.shields.io/badge/status-Beta-yellow.svg" alt="Status">
</p>

---

**Clasper Core** is the **local, single-tenant governance layer** for AI execution. It decides whether execution is allowed, under what constraints, and produces **self-attested evidence** you can use internally. **Execution is optional**: you can run governance-only (your systems or external adapters execute) or add the built-in stateless runtime for LLM execution.

## Open Source vs Hosted Clasper

**Clasper Core is fully open-source and self-hostable (Apache-2.0).** You can run it locally forever.

> **Clasper Core is not crippleware and does not phone home.**

- **What’s open (Clasper Core)**: local runtime/engine, agent orchestration, policy evaluation primitives, local governance hooks, CLI/config-driven workflows, and extensibility points.
- **What’s hosted (Clasper Cloud)**: managed infrastructure and “scale + governance” features like multi-tenant control plane, hosted audit storage, org-wide dashboards, analytics, alerting/notifications, managed identity/secrets brokering, fleet-wide controls, and compliance reporting.

If you want the deeper boundary (and the “trust model” details), see [`docs/oss-vs-cloud.md`](docs/oss-vs-cloud.md).

---

## What You Get in Clasper Core

- **Policy engine** — deterministic evaluation, `allow / deny / require_approval / pending`
- **Capability request model** — explicit scope + decision traces
- **Adapter contract** — external execution adapters can request decisions and ingest telemetry
- **Local observability** — trace capture, replay, diff, annotations
- **Local risk & cost primitives** — heuristic risk scoring and pre-execution cost estimates
- **Local audit log** — self-attested logs and local export bundles (no external proof)
- **CLI + local Ops Console** — single-operator UI for traces, policies, and settings
- **Workspace-driven config** — `SOUL.md`, `AGENTS.md`, skills, and templates

## What Is Cloud-Only

- **Multi-tenant identity and org RBAC**
- **Human approvals with Cloud-issued decision tokens**
- **Externally verifiable attestations (External Proof)**
- **Central policy distribution and environment promotion**
- **Fleet-level dashboards, alerting, and compliance exports**

## Approvals in OSS

Clasper Core can emit **pending** decisions. How you resolve those is up to you:

- wire it into **your** approval workflow (common for self-hosting)
- or use **Clasper Cloud** for a hosted approvals UI and Cloud-issued decision tokens

If you do a local override, it must be:

- explicitly labeled as **LOCAL_OVERRIDE**
- recorded as **self-attested** with a trust downgrade
- excluded from “externally verified” compliance claims

---

## Ops Console: Generate Real Test Data

To exercise every page of the local Ops Console (Dashboard, Traces + detail + diff, Skills, Policies + dry-run, Adapters, Approvals, Audit), you can seed the SQLite database by calling the **real adapter + ops HTTP endpoints**.

### 1) Start Core

```bash
npm run dev
```

### 2) Set required env

The seed script mints adapter JWTs, so **`ADAPTER_JWT_SECRET` is required**.

Optional (recommended) knobs:
- `OPS_LOCAL_API_KEY`: if set, Ops endpoints require `X-Ops-Api-Key` (the seed script will use it).
- `AGENT_DAEMON_API_KEY`: if set, `/skills/publish` requires `X-Agent-Daemon-Key` (the seed script will use it).
- `CLASPER_DB_PATH`: point Core at a separate SQLite file for seeded data (set this when starting the server).

Example:

```bash
export ADAPTER_JWT_SECRET="dev-only-secret"
export OPS_LOCAL_API_KEY="local-ops-key"
```

### 3) Run the seeder

In another terminal (with the same env):

```bash
npm run seed:ops
```

Open the Ops UI at `http://localhost:8081/ops`.

## Two Ways to Deploy

| Mode | Description |
|------|-------------|
| **Governance-only** | Use Core for policy, decisions, traces, and local audit. Execution stays in **your backend** or in **external execution adapters**. |
| **Governance + managed execution** | Enable the built-in stateless runtime so Core runs LLM execution via `POST /api/agents/send`. Governance still runs first; the runtime executes only within granted scope. |

---

## How Clasper Core Works With Your Backend

```
┌─────────────┐                              ┌─────────────┐
│   Your      │ ────── (1) send message ───▶ │  Clasper    │
│   Backend   │                              │    Core     │
│             │ ◀── (2) agent calls APIs ─── │             │
└─────────────┘                              └─────────────┘
     │                                              │
     │  Source of truth:                            │  Stateless:
     │  • Users, auth                               │  • Loads workspace config
     │  • Tasks, messages                           │  • Builds prompts
     │  • Conversations                             │  • Routes LLM calls
     │  • Documents                                 │  • Mints agent JWTs
     └──────────────────────────────────────────────┘
```

In **governance-only** mode, your backend (or external adapters) call Core only for execution decisions and telemetry ingest; see the [Adapter Contract](https://clasper.ai/docs/adapter-contract/) and [Integration](https://clasper.ai/docs/integration/) docs.

---

## External Proof and Trust Boundary

**External Proof** requires an independent trust root. Clasper Core does **not** provide one.  
Clasper Cloud is the **only** issuer of externally verifiable attestations.

See [`docs/oss-vs-cloud.md`](docs/oss-vs-cloud.md) for the full boundary.

---

## Docs

- [Getting Started](https://clasper.ai/docs/getting-started/)
- [Integration](https://clasper.ai/docs/integration/)
- [Control Plane Contract](https://clasper.ai/docs/control-plane-contract/)
- [Adapter Contract](https://clasper.ai/docs/adapter-contract/)
- [Workspace](https://clasper.ai/docs/workspace/)
- [Governance](https://clasper.ai/docs/governance/)
