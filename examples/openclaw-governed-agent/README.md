# Secure OpenClaw Agent

Example OpenClaw agent protected by Clasper governance.

**Tools cannot run unless approved.**

---

## What this demonstrates

```
AI requested tool: exec
Clasper policy: require_approval
Status: waiting_for_operator
Timeout: 8s
Execution denied
Tool executed: NO
```

Clasper intercepts OpenClaw tool calls and enforces policy before execution. Without approval (or when Core is down), tools are blocked.

---

## Run the demo

From the **clasper-core** repo root:

```bash
npm install
cp .env.example .env   # set ADAPTER_JWT_SECRET=your-secret
```

**Terminal 1 — start Clasper Core:**
```bash
npm run dev
```

**Terminal 2 — run the demo:**
```bash
cd examples/openclaw-governed-agent
npm run start
```

Expected output: dangerous tool intercepted, approval required, timeout → **Tool executed: NO**.

---

## Prerequisites

- Clasper Core running (`npm run dev` at repo root)
- OpenClaw policies seeded (`npx clasper-core seed openclaw` — the demo runs this if needed)
- `ADAPTER_JWT_SECRET` in `.env` (at repo root)
- `CLASPER_APPROVAL_MODE=enforce` for full require_approval flow (OpenClaw setup defaults to this)

---

## Why this matters

Secure OpenClaw agents use Clasper. The agent cannot execute tools unless Clasper allows it.

See the [OpenClaw Governance Quickstart](https://clasper.ai/docs/openclaw-adapter/) for full setup.
