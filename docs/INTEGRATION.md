# Integration Guide

Wombat is an **agent runtime** that works alongside your backend SaaS application. It doesn't replace your backend — it extends it with AI agent capabilities while your backend remains the source of truth for all data.

**The core idea**: Your backend sends messages to Wombat, Wombat calls an LLM, and the agent's response may include API calls back to your backend to read/write data. This bidirectional relationship is what makes agents useful.

## System Architecture

A typical deployment runs 5 processes that work together:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              INFRASTRUCTURE                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌──────────────┐         ┌──────────────┐         ┌──────────────┐       │
│   │   Frontend   │         │   Database   │         │    Redis     │       │
│   │  (SvelteKit) │         │ (PostgreSQL) │         │   (Queue)    │       │
│   └──────┬───────┘         └──────▲───────┘         └──────▲───────┘       │
│          │                        │                        │               │
│          │ HTTP                   │ SQL                    │ Jobs          │
│          ▼                        │                        │               │
│   ┌──────────────────────────────┴────────────────────────┴──────┐         │
│   │                         Backend API                          │         │
│   │                      (FastAPI :8000)                         │         │
│   │  • REST endpoints    • Mission Control    • Auth/Sessions    │         │
│   └──────────────────────────────┬───────────────────────────────┘         │
│                                  │                                          │
│          ┌───────────────────────┼───────────────────────┐                 │
│          │                       │                       │                 │
│          ▼                       ▼                       ▼                 │
│   ┌─────────────┐         ┌─────────────┐         ┌─────────────┐         │
│   │   Worker    │         │   Wombat    │◀────────│ Dispatcher  │         │
│   │ (Celery)    │         │   Daemon    │         │  (Poller)   │         │
│   │             │         │   (:8081)   │         │             │         │
│   │ • Async     │         │             │         │ • Polls     │         │
│   │   tasks     │         │ • Agent     │         │   undelivered│        │
│   │ • School    │         │   runtime   │         │   notifs    │         │
│   │   analysis  │         │ • LLM calls │         │ • Forwards  │         │
│   └─────────────┘         │ • Skills    │         │   to daemon │         │
│                           └──────┬──────┘         └─────────────┘         │
│                                  │                                          │
│                                  │ API calls                               │
│                                  ▼                                          │
│                           ┌─────────────┐                                  │
│                           │   OpenAI    │                                  │
│                           │  (LLM API)  │                                  │
│                           └─────────────┘                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Process summary:**

| Process | Port | Command | Purpose |
|---------|------|---------|---------|
| Backend API | 8000 | `make dev` | REST API, Mission Control, auth |
| Worker | - | `make dev-worker` | Async tasks (Celery) |
| Frontend | 5173 | `npm run dev` | Web UI |
| Wombat Daemon | 8081 | `make dev` | Agent runtime, LLM orchestration |
| Dispatcher | - | `npm run dispatcher` | Notification delivery loop |

## The Backend ↔ Wombat Relationship

This is the key concept to understand: **Wombat and your backend have a bidirectional relationship**.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│   ┌─────────────┐                              ┌─────────────┐          │
│   │   Backend   │ ────── (1) sends message ──▶ │   Wombat    │          │
│   │   (Zenvy)   │                              │   Daemon    │          │
│   │             │ ◀─ (2) agent calls APIs ──── │             │          │
│   │             │                              │             │          │
│   │  • Database │                              │  • Stateless│          │
│   │  • Users    │ ◀─ (3) dispatcher polls ──── │  • LLM calls│          │
│   │  • Tasks    │                              │  • Skills   │          │
│   │  • Notifs   │                              │             │          │
│   └─────────────┘                              └─────────────┘          │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### How it works

1. **Backend → Wombat**: Your backend sends user messages to Wombat via `POST /api/agents/send`. The payload includes `user_id`, `session_key`, and the message.

2. **Wombat → OpenAI → Backend**: Wombat loads the workspace config (AGENTS.md, souls, skills), builds a system prompt, calls OpenAI, and the agent's response may include API calls back to your backend (Mission Control).

3. **Wombat → Backend (writes)**: The agent can create tasks, post messages, create documents, etc. by calling your backend's Mission Control APIs. Wombat mints a short-lived JWT for these calls.

4. **Backend → Wombat (dispatcher)**: The dispatcher polls your backend for undelivered notifications and forwards them to the Wombat daemon, triggering agent responses.

### Key insight: Wombat is stateless

Wombat doesn't store user data, conversation history, or tasks. **Your backend is the source of truth**:

| What | Where it lives |
|------|----------------|
| User accounts, sessions | Backend database |
| Conversation history | Backend database (or passed in `messages[]`) |
| Tasks, documents, activity | Backend (Mission Control tables) |
| Agent personas, rules | Workspace files (in your backend repo) |
| LLM execution | Wombat (stateless, just routes requests) |

This means:
- You can run **multiple Wombat instances** behind a load balancer
- No sticky sessions needed
- If Wombat restarts, nothing is lost (state is in your backend)

### What your backend needs to implement

To integrate with Wombat, your backend needs **Mission Control APIs**:

| Endpoint | Purpose |
|----------|---------|
| `POST /api/mission-control/tasks` | Create tasks |
| `GET /api/mission-control/tasks` | List tasks |
| `POST /api/mission-control/messages` | Post messages |
| `POST /api/mission-control/documents` | Create documents |
| `GET /api/mission-control/notifications` | Get notifications |
| `POST /api/mission-control/dispatch/undelivered` | For dispatcher |

See [CONTROL_PLANE_CONTRACT.md](CONTROL_PLANE_CONTRACT.md) for the full API spec.

## Backend Configuration

Wombat requires a Mission Control-compatible backend. Configure the connection:

```bash
# Required
BACKEND_URL=http://localhost:8000
AGENT_JWT_SECRET=your-secret-matching-backend
AGENT_JWT_ALGORITHM=HS256  # default
```

The daemon posts to these Mission Control endpoints:
- `POST /api/mission-control/messages` - Agent messages
- `POST /api/mission-control/documents` - Agent documents (plans, reports)
- `GET /api/mission-control/tasks` - Task lookup
- `POST /api/mission-control/tasks` - Task creation

## Workspace Configuration

Point wombat to your project's workspace folder:

```bash
# Relative or absolute path
WOMBAT_WORKSPACE=./workspace
WOMBAT_WORKSPACE=/path/to/project/agent-config

# Default task title (optional)
WOMBAT_DEFAULT_TASK=Agent Thread
```

### Project Integration Pattern

For production projects, keep the workspace config **in your backend repo** (not in wombat). This keeps agent behavior version-controlled with the APIs the agents call.

**Example: Zenvy**

```
zenvy-backend/
├── app/                        # Backend code
├── agent-daemon/               # Wombat workspace config
│   ├── workspace/              # ← Set WOMBAT_WORKSPACE to this
│   │   ├── AGENTS.md           # Operating rules
│   │   ├── IDENTITY.md         # Agent names/branding
│   │   ├── HEARTBEAT.md        # Heartbeat checklist
│   │   ├── souls/              # Per-agent personalities
│   │   │   ├── jarvis.md
│   │   │   ├── scout.md
│   │   │   └── analyst.md
│   │   └── skills/             # API usage instructions
│   │       ├── school-search/SKILL.md
│   │       └── mission-control/SKILL.md
│   └── config/
│       └── agent-config.json   # Agent roles, session keys
└── ...
```

**Running wombat for a project:**

```bash
# From wombat directory
WOMBAT_WORKSPACE=/path/to/zenvy-backend/agent-daemon/workspace make dev
```

See [docs/examples/zenvy/](examples/zenvy/) for a complete example workspace.

See [WORKSPACE.md](WORKSPACE.md) for workspace file specifications.

## Dispatcher

The dispatcher polls the backend for undelivered notifications and forwards them to the daemon:

```bash
# Must match backend INTERNAL_API_TOKEN
INTERNAL_API_TOKEN=your-internal-token

# Daemon URL (where dispatcher sends notifications)
AGENT_DAEMON_URL=http://localhost:8081

# Optional daemon auth key
AGENT_DAEMON_API_KEY=
```

Run the dispatcher:

```bash
npm run dispatcher
```

## Task Resolution

The daemon resolves tasks in priority order:

1. **`task_id`** in request - Use this specific task (backend-owned)
2. **`task_title`** in request - Find or create task with this title
3. **`WOMBAT_DEFAULT_TASK`** env var - Fallback default

This enables flexible patterns:
- **Backend-owned**: Backend creates tasks, passes `task_id` to wombat
- **Wombat-owned**: Wombat auto-creates tasks with `task_title` or default

## API Example

`POST /api/agents/send`

```json
{
  "user_id": "uuid",
  "session_key": "user:{userId}:agent",
  "message": "Generate a plan for the project.",
  "task_title": "Project Planning",
  "metadata": {
    "kickoff_plan": true,
    "kickoff_note": "Draft a concise 3-step plan."
  }
}
```

With backend-owned task:

```json
{
  "user_id": "uuid",
  "session_key": "user:{userId}:agent",
  "message": "Continue working on this task.",
  "task_id": "existing-task-uuid"
}
```

## Authentication Flow

```
┌─────────┐     ┌─────────┐     ┌─────────┐
│ Backend │────▶│ Wombat  │────▶│ OpenAI  │
│         │     │ Daemon  │     │         │
└─────────┘     └─────────┘     └─────────┘
     │                │
     │ X-Internal-Token (dispatcher)
     │ X-Agent-Daemon-Key (optional)
     │                │
     │                ▼
     │         ┌─────────────┐
     │◀────────│ Agent JWT   │──── X-Agent-Token
     │         │ (minted by  │
     │         │  wombat)    │
     │         └─────────────┘
```

## Utilities

### Heartbeat

```bash
USER_ID=user-uuid AGENT_ROLE=agent npm run heartbeat
```

### Daily Standup

```bash
STANDUP_TIMEZONE=UTC npm run standup
```

## Example: Using with a New Project

1. Clone wombat to your dev environment
2. Create a workspace folder in your project repo:
   ```
   your-project/
   └── agent-config/
       ├── AGENTS.md
       ├── SOUL.md
       └── souls/
           └── specialist.md
   ```
3. Configure wombat:
   ```bash
   WOMBAT_WORKSPACE=/path/to/your-project/agent-config
   WOMBAT_DEFAULT_TASK=Your Project Task
   BACKEND_URL=http://your-backend:8000
   ```
4. Start wombat: `npm run dev`
