---
name: profile-extraction
description: Extract and normalize school profile data from the backend crawler
metadata: {"openclaw": {"emoji": "🏫"}}
---

## Profile Extraction

Use this skill to extract detailed school profile data and trigger crawls when needed.

### When to Use

- Need detailed information about a specific school
- Profile data is stale or incomplete
- Scout agent needs to refresh school data

### Backend API

**Get school profile:**

```
GET /api/schools/{school_id}/profile
Authorization: X-Agent-Token
```

**Response:**

```json
{
  "id": "school-uuid",
  "name": "Example High School",
  "type": "private",
  "level": "secondary",
  "location": {
    "address": "123 School St",
    "suburb": "Sydney",
    "state": "NSW",
    "postcode": "2000"
  },
  "academics": {
    "naplan_reading": 85,
    "naplan_numeracy": 82,
    "hsc_median": 78
  },
  "fees": {
    "annual_tuition": 22000,
    "building_levy": 1500,
    "currency": "AUD"
  },
  "programs": ["IB", "HSC", "STEM"],
  "facilities": ["pool", "gym", "library"],
  "last_crawled": "2024-01-15T10:30:00Z",
  "data_quality": "high",
  "evidence_map": {
    "fees": "https://school.edu.au/fees",
    "academics": "https://myschool.edu.au/..."
  }
}
```

**Trigger a crawl:**

```
POST /api/schools/{school_id}/crawl
Authorization: X-Agent-Token

{
  "priority": "normal",
  "reason": "Profile data is 6 months old"
}
```

**Response:**

```json
{
  "crawl_id": "crawl-uuid",
  "status": "queued",
  "estimated_completion": "2024-01-20T12:00:00Z"
}
```

**Check crawl status:**

```
GET /api/crawls/{crawl_id}
Authorization: X-Agent-Token
```

### Data Quality Levels

| Level | Meaning | Action |
|-------|---------|--------|
| `high` | Complete, recent data | Use as-is |
| `medium` | Some fields missing | Note gaps in analysis |
| `low` | Stale or incomplete | Consider requesting crawl |
| `unknown` | Never crawled | Request crawl before analysis |

### Best Practices

1. **Check freshness first** - If `last_crawled` is > 6 months, consider a refresh
2. **Use evidence_map** - Always cite sources from the profile
3. **Note missing fields** - Don't guess; report what's missing
4. **Batch requests** - Get multiple profiles in one call when possible

### Guardrails

- **Crawl limits** - Respect per-user crawl quotas
- **Priority levels** - Use "high" only for user-blocking needs
- **Avoid redundant crawls** - Check if a crawl is already in progress

### Related Skills

- `school-search` - Find schools to extract profiles for
- `fit-analysis` - Use profile data for fit scoring
