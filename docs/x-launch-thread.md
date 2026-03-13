# X Launch Thread Skeleton (Proof-First)

Use this skeleton for the OpenClaw launch thread. Replace placeholders with actual links and media.

---

## Tweet 1: Problem + Promise

AI agents can run tools without approval. We built Clasper to stop that.

One-line promise: **Stop AI tools from running without approval.**

---

## Tweet 2: Architecture

Clasper sits between AI/OpenClaw and tool execution:

```
AI Agent → OpenClaw → Clasper Policy Engine → Decision
                          │
        allow / require_approval / deny
```

OSS: local approvals + self-attested evidence.  
Cloud: external proof + shared approval authority.

---

## Tweet 3: Hostile Demo Clip

[dangerous-tool-attempt.mp4 or GIF]

Agent attempts dangerous tool (exec, delete) → Clasper intercepts → require_approval.

---

## Tweet 4: Outcome Proof

- Clasper Policy: require_approval
- Status: waiting_for_operator
- Timeout: 8s → no approval
- Result: denied (fail closed)
- **Tool executed: NO**

Evidence in Ops UI + Audit log. Reproducible: `npm run prove:governance`

---

## Tweet 5: Links

- Repo: https://github.com/AppLetico/clasper-core
- OpenClaw Governance Quickstart: https://clasper.ai/docs/openclaw-adapter
- Benchmark command: `npm run prove:governance` (Core running, policies seeded, CLASPER_APPROVAL_MODE=enforce)

---

## Reproducible Commands

```bash
# 1. Start Core
make dev

# 2. In another terminal: seed policies
npx clasper-core seed openclaw

# 3. Run skeptic-proof benchmark
CLASPER_APPROVAL_MODE=enforce npm run prove:governance

# 4. Print tool-policy matrix
npm run openclaw:policies
```

## Known Limits (include in thread or FAQ)

- Replay: context only; full re-execution planned
- OSS exports: self-attested
- Decision tokens: Cloud-only
