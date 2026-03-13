# Clasper Core

<p align="center">
  <img src="https://raw.githubusercontent.com/AppLetico/clasper-core/main/clasper-banner.jpg" alt="Clasper" width="100%" />
</p>

<h2 align="center">Control What Your AI Can Actually Do</h2>

<p align="center">
<em>The governance layer for AI agents.</em>
</p>

<p align="center">
<b>Governance infrastructure for AI execution.</b><br/>
Before an AI calls an API, executes code, or touches your data — Clasper decides if it's allowed.
</p>

<p align="center">
Policy enforcement • execution tracing • approvals • agent identity
</p>

<p align="center">
<a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License"></a>
<img src="https://img.shields.io/github/package-json/v/AppLetico/clasper-core" alt="Version">
<img src="https://img.shields.io/badge/built_with-TypeScript-blue" alt="TypeScript">
<img src="https://img.shields.io/badge/status-Beta-yellow" alt="Status">
</p>

---

# Why Clasper Exists

AI systems are rapidly shifting from **chat interfaces** to **autonomous actors**.

Agents now:

- call APIs  
- run tools  
- modify data  
- access internal services  
- trigger workflows  

Prompt guardrails and framework-level controls are **not enough** once execution begins.

Every AI system eventually needs a deterministic answer to one question:

> **Should this AI action be allowed to run?**

Clasper provides that answer.

---

# What Clasper Is

Clasper is a **governance engine for AI execution**.

It sits between **AI agents and the systems they control**.

Every action must request permission before execution.

```
Agent
│
│ capability request
▼
Clasper Core
│
│ policy decision
▼
Execution Adapter
```

Clasper determines whether a request is:

- allowed
- denied
- requires approval
- pending

Every decision produces a **traceable governance record**.

---

# Quick Start (2 Minutes)

Clone and run Clasper locally.

```bash
git clone https://github.com/clasper-ai/clasper-core
cd clasper-core
npm install
npm run dev
```

Set required environment variables:

```bash
export ADAPTER_JWT_SECRET="dev-only-secret"
```

With the server running, open a **second terminal** and seed the Ops Console with real execution traces:

```bash
npm run seed:ops
```

Open the Ops Console:

```
http://localhost:8081/ops
```

You will immediately see:

* agent execution traces
* policy decisions
* governance health metrics
* adapter activity

---

# Example Policy

Policies define what agents are allowed to do.

Example: prevent research agents from querying production databases.

```yaml
- policy_id: restrict_database_access
  subject:
    type: adapter
  conditions:
    agent_role: research-agent
    action: database_query
    resource: { prefix: "prod_" }
  effect:
    decision: deny
  explanation: "Research agents cannot query production databases."
  precedence: 100
```

---

# Example High-Risk Policy

A common governance rule: **prevent AI from deleting production databases without approval**.

```yaml
- policy_id: prevent_ai_deleting_prod_db
  subject:
    type: adapter
  conditions:
    action: database_drop
    resource: { prefix: "prod_" }
  effect:
    decision: require_approval
  explanation: "Production database drops require human approval."
  precedence: 200
```

---

# Example Decision Trace

Every execution produces a trace.

```
Prompt
  ↓
Reasoning
  ↓
Tool Call
  ↓
Policy Evaluation
  ↓
Approval (if required)
  ↓
Execution
```

This allows operators to:

* replay agent runs
* simulate new policies
* investigate incidents

---

# Ops Console

Clasper ships with a local operations console.

## Governance Dashboard

Track:

* approval rates
* denial rates
* risk distribution
* adapter errors

---

## Execution Traces

Inspect full agent execution paths.

Filter by:

* agent_id
* adapter
* risk_level

Each trace includes the **full execution graph**.

---

## Policy Simulation

Replay historical traces against new policies.

Useful for:

* validating governance rules
* testing policy changes
* debugging agent behavior

---

## Incident Investigation

When execution fails or is denied:

* inspect trace details
* review policy decisions
* export evidence bundles

---

# Core Capabilities

## Deterministic Policy Engine

Policies support bounded operators:

```
eq
in
prefix
exists
all_under
any_under
```

Decision outcomes:

```
allow
deny
require_approval
pending
```

---

## Agent Identity

Every request includes agent metadata:

```
agent_id
agent_role
agent_metadata
```

Policies can enforce rules per agent or per role.

---

## Execution Graph

Clasper records the entire execution chain:

```
Prompt → Reasoning → Tool → Policy → Approval → Execution
```

Traces can be:

* replayed
* diffed
* simulated

---

## Risk & Cost Signals

Each execution request includes signals such as:

```
risk_score
risk_level
cost_estimate
```

Policies can dynamically react to high-risk actions.

---

## Adapter System

Execution occurs through adapters.

Adapters may represent:

* APIs
* databases
* internal services
* external tools

Each adapter registers capabilities and certification tier.

---

# Architecture

```
             ┌─────────────┐
             │   AI Agent  │
             └──────┬──────┘
                    │
                    │ capability request
                    ▼
             ┌─────────────┐
             │  Clasper    │
             │    Core     │
             │             │
             │ Policy Eval │
             │ Risk Check  │
             │ Trace Log   │
             └──────┬──────┘
                    │
                    │ decision
                    ▼
             ┌─────────────┐
             │  Execution  │
             │   Adapter   │
             └─────────────┘
```

Clasper remains **stateless and deterministic**, while execution happens through adapters.

---

# Deployment Modes

## Governance Only

Use Clasper for:

* policy evaluation
* decision traces
* governance visibility

Execution stays inside your own infrastructure.

---

## Governance + Runtime

Clasper can optionally run a lightweight runtime that:

* builds prompts
* routes LLM calls
* executes actions within granted scope

---

# OpenClaw Integration

Clasper includes a first-class adapter for [OpenClaw](https://openclaw.ai) — an execution gateway and tool ecosystem. When connected:

- OpenClaw tool calls are **intercepted** and sent to Clasper for policy evaluation
- Side-effectful tools can be **blocked** or **require approval** before execution
- Every decision is **audited** with matched policies and full traceability

To set up the integration, see **[How to set up OpenClaw with Clasper](https://clasper.ai/docs/openclaw-adapter/)**.

---

# Development

Node 20 required.

```
nvm use
npm install
```

Run CI locally:

```
npm run ci
```

---

# Documentation

- [Getting Started](https://clasper.ai/docs/getting-started/)
- [Integration](https://clasper.ai/docs/integration/)
- [OpenClaw Adapter](https://clasper.ai/docs/openclaw-adapter/) — Set up OpenClaw with Clasper
- [Control Plane Contract](https://clasper.ai/docs/control-plane-contract/)
- [Adapter Contract](https://clasper.ai/docs/adapter-contract/)
- [Workspace](https://clasper.ai/docs/workspace/)
- [Governance](https://clasper.ai/docs/governance/)

---

# License

Apache 2.0
