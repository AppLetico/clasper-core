---
name: mission-control
description: Interact with Mission Control for tasks, messages, and documents
metadata: {"openclaw": {"emoji": "📋"}}
---

## Mission Control

Use this skill to interact with the Mission Control backend for task management, messaging, and document creation.

### When to Use

- Creating or updating tasks
- Posting messages to task threads
- Creating deliverables or research documents
- Checking activity feed or notifications

### Backend APIs

**Create a task:**

```
POST /api/mission-control/tasks
Authorization: X-Agent-Token

{
  "title": "Research schools in Bondi area",
  "description": "Find and analyze top 5 schools within 10km of Bondi",
  "status": "in_progress",
  "metadata": {
    "type": "research",
    "priority": "normal"
  }
}
```

**Post a message:**

```
POST /api/mission-control/messages
Authorization: X-Agent-Token

{
  "task_id": "task-uuid",
  "content": "Found 12 schools matching criteria. Starting fit analysis...",
  "actor_type": "agent",
  "agent_role": "scout"
}
```

**Create a document:**

```
POST /api/mission-control/documents
Authorization: X-Agent-Token

{
  "task_id": "task-uuid",
  "title": "School Shortlist - Bondi Area",
  "content": "## Top 5 Schools\n\n1. Bondi Public...",
  "doc_type": "deliverable"
}
```

**Get notifications:**

```
GET /api/mission-control/notifications?unread=true
Authorization: X-Agent-Token
```

### Document Types

| Type | Purpose | Example |
|------|---------|---------|
| `deliverable` | Final output for user | School shortlist, comparison report |
| `research` | Working notes | Crawl results, data quality notes |
| `plan` | Task planning | Discovery plan, analysis approach |
| `standup` | Status update | Daily progress summary |

### Task Statuses

| Status | Meaning |
|--------|---------|
| `pending` | Not yet started |
| `in_progress` | Actively being worked on |
| `blocked` | Waiting for input or tool |
| `completed` | Finished successfully |
| `cancelled` | No longer needed |

### Best Practices

1. **Log all actions** - Post messages for major actions taken
2. **Create documents for outputs** - User-facing results go in documents
3. **Update task status** - Keep status accurate for visibility
4. **Use metadata** - Add structured data for filtering/search

### Message Guidelines

```markdown
## Good message (for logs):
"Searched for schools in Bondi area. Found 12 candidates. 
3 have stale profiles (>6 months). Requesting crawls for those."

## Bad message (too vague):
"Working on it."
```

### Related Skills

- `school-search` - Find schools to report on
- `fit-analysis` - Generate analysis for documents
