---
name: user-profile
description: Understand and work with user preferences and family profiles
metadata: {"openclaw": {"emoji": "👤"}}
---

## User Profile

Use this skill to understand user preferences, family context, and personalize recommendations.

### When to Use

- Starting a new school search
- Understanding user priorities
- Personalizing fit analysis
- Asking clarifying questions

### Backend API

**Get user profile:**

```
GET /api/users/{user_id}/profile
Authorization: X-Agent-Token
```

**Response:**

```json
{
  "id": "user-uuid",
  "name": "Jane Smith",
  "location": {
    "suburb": "Bondi",
    "state": "NSW",
    "postcode": "2026"
  },
  "children": [
    {
      "id": "child-uuid",
      "name": "Emma",
      "age": 10,
      "current_grade": 4,
      "target_grade": 5,
      "special_needs": ["dyslexia"],
      "interests": ["swimming", "music"]
    }
  ],
  "preferences": {
    "school_types": ["private", "public"],
    "max_commute_min": 30,
    "budget_max": 25000,
    "priorities": ["academics", "arts", "sports"]
  },
  "search_history": [
    {
      "date": "2024-01-10",
      "query": "primary schools Bondi",
      "results_count": 15
    }
  ]
}
```

**Update preferences:**

```
PATCH /api/users/{user_id}/preferences
Authorization: X-Agent-Token

{
  "priorities": ["academics", "special_needs_support", "arts"],
  "budget_max": 30000
}
```

### Priority Categories

| Priority | What to Look For |
|----------|------------------|
| `academics` | NAPLAN scores, HSC results, IB programs |
| `sports` | Facilities, teams, championships |
| `arts` | Music, drama, visual arts programs |
| `special_needs_support` | Learning support, dedicated staff |
| `religious` | Faith-based programs, values |
| `technology` | STEM programs, 1:1 devices |
| `outdoor` | Camps, environmental programs |

### Clarifying Questions

When user preferences are incomplete, ask about:

1. **Location** - "Where do you live? How far are you willing to travel?"
2. **Budget** - "What's your budget range for school fees?"
3. **Child needs** - "Does your child have any specific learning needs?"
4. **Priorities** - "What's most important: academics, sports, arts, or something else?"
5. **School type** - "Are you open to all school types, or prefer public/private?"

### Best Practices

1. **Ask early** - Clarify vague requirements before expensive work
2. **Respect privacy** - Only access data needed for the task
3. **Update as you learn** - If user reveals new preferences, update the profile
4. **Personalize recommendations** - Use child interests to highlight relevant programs

### Example: Personalization

```markdown
## Recommendation for Emma (Age 10)

Based on Emma's interest in swimming, I've highlighted schools with:
- Competition-level swim programs
- Access to pools (on-site or nearby)
- Swim team participation

Given her dyslexia, I've also flagged schools with:
- Dedicated learning support staff
- Small class sizes
- Explicit phonics programs
```

### Related Skills

- `school-search` - Search based on user preferences
- `fit-analysis` - Score schools against preferences
