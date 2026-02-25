# Clasper Adapter for OpenClaw

> No OpenClaw tool with side effects can execute unless Clasper explicitly allows it.

---

## Prerequisites

- **Node.js** 22+
- **Clasper Core** — cloned and dependencies installed (`make setup`)
- **OpenClaw** — installed globally or available in PATH (see below)

### Installing OpenClaw

Use the official installer (primary path):

**macOS / Linux / WSL2**

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
```

**Windows (PowerShell)**

```powershell
iwr -useb https://openclaw.ai/install.ps1 | iex
```

For alternate install methods and the latest onboarding guidance, see OpenClaw's
official Getting Started docs:

- [https://docs.openclaw.ai/start/getting-started](https://docs.openclaw.ai/start/getting-started)

#### Verify the install

```bash
openclaw doctor     # check for config issues
openclaw status     # gateway status
openclaw dashboard  # open the browser UI
```

### Onboarding: Skill Selection

During `openclaw onboard`, the wizard will ask you to **Install missing skill
dependencies**. Skills are optional plugins that extend what OpenClaw can do.
You can skip all of them and install any later with
`openclaw skills install <name>`.

**Recommended for most setups:**

| Skill | Why |
|-------|-----|
| `summarize` | Lets the agent summarize long content — generally useful |
| `model-usage` | Tracks token spend and costs across models |
| `clawhub` | Access the OpenClaw community skill hub; makes discovering and installing new skills easier |

**macOS users — pick any you actively use:**

| Skill | App |
|-------|-----|
| `apple-notes` | Apple Notes |
| `apple-reminders` | Apple Reminders |
| `things-mac` | Things 3 task manager |
| `obsidian` | Obsidian note vault |
| `imsg` | iMessage |

**Worth considering:**

| Skill | Why |
|-------|-----|
| `nano-pdf` | Read and process PDF files |
| `openai-whisper` | Speech-to-text (handy if you send voice notes via WhatsApp/iMessage) |
| `himalaya` | Email integration via CLI |

> **Tip:** Start lean. You can always add more skills later without re-running
> the full onboarding wizard.

### Onboarding: Hook Selection

After skills, the wizard asks you to **Enable hooks**. Hooks are small scripts
that run automatically when agent events fire (like starting a new session or
booting the gateway). You can enable or disable them at any time with
`openclaw hooks enable <name>` / `openclaw hooks disable <name>`.

OpenClaw ships with four bundled hooks. During onboarding you'll typically see
three of them:

| Hook | What it does | Recommendation |
|------|-------------|----------------|
| `session-memory` | Saves a summary of your conversation to `~/.openclaw/workspace/memory/` whenever you issue `/new` (reset session). Uses an LLM call to generate a descriptive filename. | **Enable** — gives the agent persistent memory across sessions |
| `command-logger` | Appends every command event (`/new`, `/stop`, `/reset`, etc.) to `~/.openclaw/logs/commands.log` in JSONL format. | **Enable** — lightweight audit trail, useful for troubleshooting |
| `boot-md` | Runs a `BOOT.md` file from your agent workspace when the gateway starts. Use it to send yourself a morning briefing, trigger startup automations, etc. | **Optional** — enable if you plan to write a `BOOT.md`; skip if unsure |

> There is also a fourth bundled hook (`soul-evil`) that is not shown during
> onboarding. It's a novelty hook that randomly swaps the agent's personality —
> not relevant for production use.

**Our recommendation:** enable **session-memory** and **command-logger**. They
are both lightweight and immediately useful. You can skip `boot-md` until you
have a reason to use it.

Hooks can also be managed after onboarding:

```bash
openclaw hooks list           # see all discovered hooks
openclaw hooks enable <name>  # enable a hook
openclaw hooks disable <name> # disable a hook
openclaw hooks check          # show eligibility summary
```

For more details: [docs.openclaw.ai/automation/hooks](https://docs.openclaw.ai/automation/hooks)

### Onboarding: Hatching Your Bot

The final onboarding step asks **"How do you want to hatch your bot?"** — this
is OpenClaw's term for the initial first-run of your agent.

| Option | What it does | Recommendation |
|--------|-------------|----------------|
| **Hatch in TUI** (recommended) | Launches the agent in your terminal so you can chat with it immediately | **Pick this** — quickest way to verify the install and channel setup work |
| **Open the Web UI** | Opens the Control UI in your browser (`http://127.0.0.1:18789/`) | Also fine — same thing, just in the browser instead of the terminal |
| **Do this later** | Skips the test entirely | Not ideal — you won't know if something is broken until later |

**We recommend "Hatch in TUI"**. Send a quick test message to confirm your
WhatsApp (or other channel) is connected and the agent responds. Once you've
verified everything works, you can stop the agent and move on to the Clasper
plugin configuration steps below.

---

## Choose One Setup Path

Use either:

- **Option A: CLI wizard (recommended)** — fastest path, configures both Clasper and OpenClaw integration
- **Option B: Manual steps** — explicit step-by-step setup and config

---

## Option A: CLI Wizard (Recommended)

If you already have OpenClaw installed and available in PATH, use the Clasper
setup wizard to configure both Clasper Core and the OpenClaw integration in one
flow:

```bash
cd /path/to/clasper-core
npm install
npm run build
npx clasper-core setup --profile openclaw
```

Upgrade/sync an existing OpenClaw plugin install later:

```bash
npx clasper-core setup --profile openclaw --upgrade-openclaw-plugin --non-interactive
```

Optional (global command install):

```bash
npx clasper-core link
```

What the wizard does:

- Configures `.env` (`CLASPER_PORT`, `ADAPTER_JWT_SECRET`, approval mode, LLM provider)
- Builds Clasper Core if needed
- Initializes `./workspace` if missing
- Installs `integrations/openclaw` plugin into OpenClaw
- Merges plugin config into `~/.openclaw/openclaw.json`
- Seeds OpenClaw default policies (or tells you how to rerun seeding)
- Optionally runs `npm link` so `clasper-core` works globally

Then start services:

```bash
clasper-core dev
openclaw gateway start
```

---

## Option B: Manual Setup

### Manual Step 1: Configure Clasper Core

Before the OpenClaw plugin can talk to Clasper Core, both sides need to share a
secret and Clasper needs to know how to handle governed tool calls. All of this
is configured via the `.env` file in the clasper-core root.

If you don't have a `.env` yet, copy the example and edit it:

```bash
cp .env.example .env
```

Then set the following values:

```bash
# ── Authentication ──────────────────────────────────────────────────
# Shared secret used to mint/verify adapter JWTs.
# The OpenClaw plugin signs requests with this secret, and Clasper
# Core verifies them. Both sides MUST use the same value.
# Pick any string for local dev (e.g. "my-dev-secret").
# → You will set the matching value in the OpenClaw plugin config
#   (Step 5, "adapterSecret").
ADAPTER_JWT_SECRET=my-dev-secret

# ── Ops API ─────────────────────────────────────────────────────────
# API key for seeding policies and accessing the Ops API.
# Leave blank to disable Ops API auth entirely (fine for local dev).
# If set, the seed script and any Ops API calls must include this key.
OPS_LOCAL_API_KEY=

# ── Approval behavior ──────────────────────────────────────────────
# When a policy returns "require_approval", you can run in one of two modes:
#
#   simulate (dev-friendly, default)
#     - actions are AUTO-APPROVED (not blocked)
#     - the decision + audit make it explicit this was a config override
#
#   enforce (production posture)
#     - execution pauses until an operator approves/denies in the Ops Console
#
# Recommended config:
CLASPER_APPROVAL_MODE=enforce
#
# Enable advanced deterministic policy operators used by exception rules
# (in, prefix, all_under, any_under, exists).
CLASPER_POLICY_OPERATORS=true
#
# Back-compat (older config, still supported):
#   CLASPER_REQUIRE_APPROVAL_IN_CORE=allow  → simulate
#   CLASPER_REQUIRE_APPROVAL_IN_CORE=block  → enforce

# ── Network & tenant ───────────────────────────────────────────────
# These defaults are fine for local single-tenant development.
# CLASPER_PORT is the port the Ops API + Console listens on.
# → The OpenClaw plugin config (Step 5) must point to this port
#   (e.g. "clasperUrl": "http://localhost:8081").
CLASPER_PORT=8081
CLASPER_LOCAL_TENANT_ID=local
CLASPER_LOCAL_WORKSPACE_ID=local
```

**How these connect to OpenClaw (configured later in Step 5):**

| Clasper `.env` | OpenClaw plugin config | Must match? |
|----------------|----------------------|-------------|
| `ADAPTER_JWT_SECRET` | `adapterSecret` | Yes — same string on both sides |
| `CLASPER_PORT` | `clasperUrl` (port portion) | Yes — plugin must reach this port |
| `OPS_LOCAL_API_KEY` | *(not used by plugin)* | No — only used for the Ops API / seed scripts |
| `CLASPER_REQUIRE_APPROVAL_IN_CORE` | *(not used by plugin)* | No — controls Clasper-side behavior only |

> **Important:** If you leave `CLASPER_REQUIRE_APPROVAL_IN_CORE=allow` (the default),
> any `require_approval` decision will be auto-allowed and audited. Set it to `block`
> to see the full approval polling flow in the Ops Console.

### Manual Step 2: Start Clasper Core

```bash
npx clasper-core dev
```

Verify it's running:

```bash
curl -s http://localhost:8081/health
# → {"status":"ok", ...}
```

The Ops Console is available at [http://localhost:8081/](http://localhost:8081/).

### Manual Step 3: Seed the Default Policies

The integration ships with a default policy pack. Policies are **never** auto-loaded
by the plugin — you must seed them explicitly:

```bash
npx clasper-core seed openclaw
```

> **Important:** Clasper Core’s policy engine defaults to **allow** when no policy
> matches. This OpenClaw policy pack includes a **fallback rule** (`openclaw-fallback-require-approval`)
> so *new / unscoped tools do not silently execute*. If you remove or disable the
> fallback rule, an unrecognized tool may be allowed unless risk/budget/RBAC gates block it.

This reads `integrations/openclaw/policies/openclaw-default.yaml` and POSTs each
policy to the Ops API. You should see output like:

```
  Found 8 policies to seed.

  ✓ openclaw-allow-read-file → allow
  ✓ openclaw-allow-safe-shell-reads → allow
  ✓ openclaw-require-approval-exec → require_approval
  ✓ openclaw-require-approval-write-file → require_approval
  ✓ openclaw-require-approval-http-request → require_approval
  ✓ openclaw-require-approval-web-fetch → require_approval
  ✓ openclaw-deny-delete-file → deny
  ✓ openclaw-fallback-require-approval → require_approval
```

If seeding fails with a 401, set `OPS_LOCAL_API_KEY` in your `.env` to match what
the seed script sends (or leave it blank to disable Ops auth).

**What the default policies do:**

| Tool | Effect | Why |
|------|--------|-----|
| `read` | allow | Low-risk baseline |
| `exec` (`ls`/`pwd`/`whoami` under workspace root) | allow | Safe read-only shell commands in scoped paths |
| `exec` (all other commands) | require_approval | Shell commands need operator review |
| `write` | require_approval | File mutations need operator review |
| `web_search` | require_approval | Network access needs operator review |
| `web_fetch` | require_approval | Network access needs operator review |
| `delete` | deny | Destructive — blocked outright |

You can edit `policies/openclaw-default.yaml` and re-run the seed command to change
these. Policies are upserted by `policy_id`, so re-running is safe.

### Manual Step 4: Install the Plugin in OpenClaw

```bash
openclaw plugins install /path/to/clasper-core/integrations/openclaw
```

This registers the plugin using the `openclaw.plugin.json` manifest.

### Manual Step 5: Configure the Plugin

Add the plugin config to your OpenClaw configuration (`~/.openclaw/openclaw.json`):

```json
{
  "plugins": {
    "entries": {
      "clasper-openclaw": {
        "enabled": true,
        "config": {
          "clasperUrl": "http://localhost:8081",
          "adapterId": "openclaw-local",
          "adapterSecret": "my-dev-secret",
          "approvalWaitTimeoutMs": 300000,
          "approvalPollIntervalMs": 2000,
          "executionReuseWindowMs": 600000
        }
      }
    }
  }
}
```

| Key | Required | Default | Description |
|-----|----------|---------|-------------|
| `clasperUrl` | yes | — | Clasper Core URL (must be reachable) |
| `adapterId` | no | `openclaw-local` | Identifier for this adapter in Clasper |
| `adapterSecret` | no | — | Must match `ADAPTER_JWT_SECRET` in Clasper `.env` |
| `approvalWaitTimeoutMs` | no | `300000` | Max wait for operator approval before fail-closed timeout |
| `approvalPollIntervalMs` | no | `2000` | Poll interval while waiting on approval |
| `executionReuseWindowMs` | no | `600000` | Reuse the same pending `execution_id` for the same request fingerprint |

### Manual Step 5a: Approval wait + retry behavior

When a decision is pending approval:

- The plugin waits up to `approvalWaitTimeoutMs` (default 5 minutes).
- It polls Core every `approvalPollIntervalMs` (default 2 seconds).
- If the same request is retried before resolution, the plugin reuses the same pending
  `execution_id` for up to `executionReuseWindowMs` (default 10 minutes) instead of
  creating a brand new approval row.

This keeps governance strict (same request only) while avoiding repeated approvals
for the same action.

> Note: broader "approve once for similar requests" Core-side grants are intentionally
> deferred. Current reuse is adapter-local and request-scoped by design.

#### Expected flow (enforce mode)

1. Tool call hits `require_approval` and creates a pending decision.
2. Plugin waits up to `approvalWaitTimeoutMs`, polling every `approvalPollIntervalMs`.
3. If the same request is retried while still pending, plugin reuses the same `execution_id`.
4. Once approved/denied, the reuse entry is cleared.
5. A different fingerprint (different tool/target/session context) creates a new decision.

### Manual Step 6: Start OpenClaw

```bash
openclaw gateway start
```

> The plugin is loaded from `plugins.entries.clasper-openclaw` in
> `~/.openclaw/openclaw.json`, so no `--plugins` flag is required.

On startup you should see:

```
[clasper] Initializing governance plugin (adapter=openclaw-local, core=http://localhost:8081)
[clasper] Adapter registered with Clasper Core (risk_class=high)
[clasper] Tool dispatch interceptor installed — all tools are now governed.
[clasper] Plugin ready. No OpenClaw tool with side effects can execute unless Clasper explicitly allows it.
```

If you see `FATAL: Failed to register adapter` — Clasper Core isn't running or the
URL/secret is wrong. The plugin will refuse to start (fail-closed).

---

## Running the Demo

There's a self-contained demo you can run without OpenClaw to verify the policies
and decision flow against Clasper Core directly.

### Option A: Automated demo script

```bash
bash integrations/openclaw/demos/demo.sh
```

This will:
1. Check Clasper Core is running
2. Seed the default policies
3. Register the adapter
4. Run 4 adversarial scenarios and print results

### Option B: Malicious skill demo (manual)

If you already have the adapter registered and a token:

```bash
CLASPER_URL=http://localhost:8081 \
ADAPTER_TOKEN=<your-jwt> \
npx tsx integrations/openclaw/demos/malicious-skill.ts
```

### What the demo exercises

| Scenario | Tool | Expected | What to check in Ops Console |
|----------|------|----------|------------------------------|
| Delete files | `delete` | **BLOCKED** | Audit log: `tool_execution_blocked` |
| Exfiltrate via HTTP | `web_search` | **REQUIRES APPROVAL** | Approvals view: pending decision |
| Remote code exec | `exec` | **REQUIRES APPROVAL** | Approvals view: pending decision |
| Read file | `read` | **ALLOWED** | Traces: successful execution |

> If `CLASPER_REQUIRE_APPROVAL_IN_CORE=allow`, the require_approval scenarios will
> show as auto-allowed with an audit note. Set it to `block` to see them actually
> pause and wait for approval.

---

## CLI test (force a tool call with a new session)

If the Control UI "new session" button doesn’t work or the agent keeps saying it can’t read without actually calling the tool, use the CLI with a **new session ID** so the agent makes a real tool call (and Clasper sees an execution request and trace):

```bash
# Gateway and Clasper Core must be running. Then:
openclaw agent --session-id "clasper-test-$(date +%s)" -m "Use the read tool to read /Users/jasongelinas/.openclaw/workspace/README.md and return only the first line."
```

If your config defaults to a channel that needs a recipient (e.g. WhatsApp), add `-t +1XXXXXXXXXX` with your number. To use the same session as your webchat for a quick test, omit `--session-id` and use a prompt that forces a tool call, e.g.:

```bash
openclaw agent -m "Call the read tool with path /Users/jasongelinas/.openclaw/workspace/README.md. Reply with only the first line of the file."
```

Then check Clasper logs for `POST /api/execution/request` and the Ops Console **Approvals** and **Traces** tabs.

---

## Verifying in the Ops Console

Open [http://localhost:8081/](http://localhost:8081/) and check:

- **Adapters** — `openclaw-local` should appear with `risk_class: high`
- **Policies** — All 8 OpenClaw policies listed and enabled
- **Audit** — Events for blocked, approved, and executed tool invocations
- **Approvals** — Pending decisions (when `CLASPER_REQUIRE_APPROVAL_IN_CORE=block`)
- **Tools** — Tool names with allow/block rates derived from actual decisions

---

## Customizing Policies

Edit `policies/openclaw-default.yaml` and re-seed:

```bash
# After editing the YAML:
make seed-openclaw-policies
```

**Example: allow deterministic safe shell reads**

Add a higher-precedence policy that allows specific commands only when all target
paths stay under workspace root:

```yaml
- policy_id: openclaw-allow-safe-shell-reads-local
  subject:
    type: tool
  conditions:
    tool: exec
    tool_group: runtime
    context.exec.argv0:
      in: ["ls", "pwd", "whoami"]
    context.targets.paths:
      all_under:
        - "{{workspace.root}}"
  effect:
    decision: allow
  explanation: "Allow safe shell reads within workspace root."
  precedence: 30
  enabled: true
```

> Tip: prefer deterministic fields (`tool`, `tool_group`,
> `context.exec.argv0`, `context.targets.paths`) over heuristic intent matching.

---

## How It Works (Internals)

```
OpenClaw Gateway
  │
  │  tool invocation (e.g. exec, write_file)
  ▼
plugin.ts
  │  interceptToolDispatch hook
  ▼
governedDispatch.ts
  │  builds ExecutionRequest with tool, tool_group, intent
  │  POST /api/execution/request → Clasper Core
  ▼
Clasper Core (policyEngine → executionDecision)
  │  evaluates matching policies, risk score, budget
  │  returns: allow | deny | require_approval
  ▼
governedDispatch.ts
  │  switch (effect):
  │    deny   → throw, report blocked
  │    require_approval → poll GET /api/execution/:id until resolved
  │    allow  → execute tool, report outcome
  ▼
telemetry.ts
  │  POST /api/ingest/audit (blocked or executed)
  │  POST /api/ingest/cost (if applicable)
  ▼
Ops Console
  │  traces, audit log, approvals, tool registry
```

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Plugin won't start: `interceptToolDispatch not available` | OpenClaw version too old | Upgrade OpenClaw to a version that supports the plugin interception API |
| Plugin won't start: `Failed to register adapter` | Clasper Core not running or wrong URL | Start Clasper Core first; check `clasperUrl` in plugin config |
| All tools blocked: `Clasper Core unreachable` | Network issue or Core crashed | This is fail-closed by design; restart Core |
| Seed fails with 401 | `OPS_LOCAL_API_KEY` mismatch | Match the key in `.env` or leave it blank to disable Ops auth |
| `require_approval` scenarios auto-allow | `CLASPER_REQUIRE_APPROVAL_IN_CORE=allow` | Set to `block` in `.env` and restart Core |
| Approval times out while pending | Nobody approved in time | Increase `approvalWaitTimeoutMs` in plugin config, then restart gateway |
| Retry creates another pending approval | New execution was generated for a different request fingerprint | Retry the exact same tool/target, or widen `executionReuseWindowMs` for slower operator workflows |

---

## File Structure

```
integrations/openclaw/
├── openclaw.plugin.json          # OpenClaw plugin manifest
├── plugin.ts                     # Entry point (register, self-check, adapter registration)
├── package.json
├── tsconfig.json
├── src/
│   ├── types.ts                  # Shared type definitions
│   ├── clasperClient.ts          # HTTP client for Clasper Core API
│   ├── governedDispatch.ts       # Adapter shim (tool interceptor)
│   ├── intentInference.ts        # Best-effort intent + context mapping
│   ├── telemetry.ts              # Outcome reporting (audit + cost)
│   └── approval.ts               # Approval polling loop
├── policies/
│   └── openclaw-default.yaml     # Default governance policies (8 rules)
├── demos/
│   ├── demo.sh                   # Automated demo runner
│   └── malicious-skill.ts        # Adversarial test scenarios
└── README.md                     # This file
```

---

## License

Apache-2.0 — same as Clasper Core.
