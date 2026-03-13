# Clasper

<p align="center">
  <img src="https://raw.githubusercontent.com/AppLetico/clasper-core/main/clasper-banner.jpg" alt="Clasper" width="100%" />
</p>

<p align="center">
<strong>Control what AI tools are allowed to run.</strong>
</p>

<p align="center">
Policy enforcement for OpenClaw tool execution.
</p>

<p align="center">
<a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License"></a>
<img src="https://img.shields.io/github/package-json/v/AppLetico/clasper-core" alt="Version">
<img src="https://img.shields.io/badge/built_with-TypeScript-blue" alt="TypeScript">
<img src="https://img.shields.io/badge/status-Beta-yellow" alt="Status">
</p>

---

## Prove it in 30 seconds

Run governance verification:

```bash
npm install
npm run prove:governance
```

With Clasper running and `OPS_LOCAL_API_KEY` set, the script seeds OpenClaw policies, calls the posture endpoint, and runs a synthetic decision probe. Output includes:

- **Posture**: mode, status (ENFORCED/DEGRADED/DISABLED), fallback presence, policy count
- **Probe**: deterministic `__clasper_probe__` tool decision from the policy engine

<em>Start Clasper (<code>npm run dev</code>) in another terminal, then run <code>prove:governance</code> again. Set <code>OPS_LOCAL_API_KEY</code> and <code>ADAPTER_JWT_SECRET</code> for full verification. Open the Ops Console at http://localhost:8081/ops</em>

---

## Architecture

```
AI Agent
   ↓
OpenClaw Runtime
   ↓
Clasper Policy Engine
   ↓
Tool Execution
```

Clasper is a **policy enforcement layer** — it does not run agents or tools; it decides whether execution is allowed. Stateless and deterministic.

## 10-second Mental Model

```
AI Action
   ↓
Clasper Policy Evaluation
   ↓
Decision Logged
   ↓
Inspect via CLI or API
```

Quick debugging flow:

```bash
clasper-core decisions latest --ops-api-key <key>
clasper-core decisions show <decision_id> --ops-api-key <key>
```

---

## Why Clasper

AI agents can execute tools that trigger real-world side effects.

Deleting data  
Sending payments  
Running shell commands  

Clasper intercepts tool execution and enforces policy before those actions run.

---

## Policy Example

Tool Policy Matrix (from `make seed-openclaw-policies`):

| Tool | Policy |
|------|--------|
| `exec` | require_approval |
| `write` | require_approval |
| `read`, `sessions_list`, `memory_search` | allow |
| `unknown_tool` | require_approval (fallback) |

---

## Security Guarantees

- Unknown tools require approval (fallback policy)
- Misconfigured plugins: missing `clasperUrl` disables; registration/auth failures halt startup
- Guarded mode: missing fallback policy blocks no-match requests
- Strict mode: no-match denies
- Approval service outages trigger fail-closed behavior

Set `CLASPER_MODE=permissive|guarded|strict` to control no-match behavior (default: permissive).

---

## OSS vs Cloud

| Capability | OSS | Cloud |
|------------|-----|-------|
| Policy enforcement | ✅ | ✅ |
| Local approvals | ✅ | ✅ |
| Signed evidence | ❌ | ✅ |
| Tokenized approvals | ❌ | ✅ |

---

# Quickstart

```bash
git clone https://github.com/clasper-ai/clasper-core
cd clasper-core
npm install
export ADAPTER_JWT_SECRET="dev-only-secret"
npm run dev
```

In a second terminal:

```bash
npx clasper-core seed openclaw
npx clasper-core policy install safe-defaults
npm run seed:ops
```

Open **http://localhost:8081/ops** — see traces, policy decisions, and the Ops Console.

To connect OpenClaw, see **[How to set up OpenClaw with Clasper](https://clasper.ai/docs/openclaw-adapter/)**.

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

* decision replay (context + policy re-evaluation)
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

Decision replay: re-evaluate historical trace context against new policies (no re-execution).

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

* decision replayed (context for policy simulation)
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

# Example & Integration

The first-class [OpenClaw](https://openclaw.ai) adapter intercepts tool calls and sends them to Clasper for policy evaluation. Setup: **[OpenClaw Adapter docs](https://clasper.ai/docs/openclaw-adapter/)**.

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
