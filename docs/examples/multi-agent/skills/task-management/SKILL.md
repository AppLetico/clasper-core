# Task Management Skill

This skill enables agents to manage tasks via the Mission Control API.

## Endpoints

### List Tasks

```
GET /api/mission-control/tasks
Headers: X-Agent-Token: <jwt>
```

Returns tasks for the current user.

### Create Task

```
POST /api/mission-control/tasks
Headers: X-Agent-Token: <jwt>
Body: { "title": "...", "description": "...", "status": "in_progress", "idempotency_key": "..." }
```

### Post Message

```
POST /api/mission-control/messages
Headers: X-Agent-Token: <jwt>
Body: { "task_id": "...", "content": "...", "actor_type": "agent", "idempotency_key": "..." }
```

## Usage Notes

- Always include `idempotency_key` for create operations
- Check existing tasks before creating duplicates
- Use descriptive titles for tasks
