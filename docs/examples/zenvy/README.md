# Zenvy School Finder Example

This is an example workspace configuration for the Zenvy School Finder project.

## Overview

The Zenvy School Finder uses a multi-agent setup with three specialized agents:

- **Jarvis (Kookaburra)** - Squad Lead who coordinates the team
- **Scout (Bilby)** - Discovery Specialist who finds candidate schools
- **Analyst (Echidna)** - Matching Specialist who evaluates fit

## Files

```
zenvy/
├── AGENTS.md           # Shared operating rules for all agents
├── HEARTBEAT.md        # Heartbeat checklist
├── IDENTITY.md         # Agent names, emojis, branding
├── souls/              # Per-agent personalities
│   ├── jarvis.md       # 🐦 Kookaburra - Squad Lead
│   ├── scout.md        # 🐭 Bilby - Discovery Specialist
│   └── analyst.md      # 🦔 Echidna - Matching Specialist
├── skills/             # API usage instructions for agents
│   ├── school-search/SKILL.md
│   ├── fit-analysis/SKILL.md
│   ├── profile-extraction/SKILL.md
│   ├── mission-control/SKILL.md
│   └── user-profile/SKILL.md
└── README.md           # This file
```

## Project Integration Pattern

When using wombat with a backend project (like zenvy-backend), keep the workspace config in the backend repo:

```
zenvy-backend/
├── app/                    # Backend code
├── agent-daemon/           # Wombat workspace config
│   ├── workspace/          # ← Set WOMBAT_WORKSPACE to this
│   │   ├── AGENTS.md
│   │   ├── souls/
│   │   └── skills/
│   └── config/
│       └── agent-config.json
└── ...
```

This keeps agent behavior version-controlled with the backend APIs the agents call.

## Usage

To use this workspace with wombat:

```bash
# Copy to your workspace
cp -r docs/examples/zenvy workspace/

# Or set the path directly
WOMBAT_WORKSPACE=./docs/examples/zenvy
WOMBAT_DEFAULT_TASK="School Finder"
```

## Session Keys

Each agent uses a session key pattern:
- `user:{userId}:jarvis`
- `user:{userId}:scout`
- `user:{userId}:analyst`

## Integration

This workspace is designed to work with the Zenvy backend's Mission Control APIs.

**Running wombat for Zenvy:**

```bash
# From the wombat directory
WOMBAT_WORKSPACE=/path/to/zenvy-backend/agent-daemon/workspace make dev

# Run the dispatcher (delivers notifications)
make dispatcher
```

See [INTEGRATION.md](../../INTEGRATION.md) for the full system architecture.
