---
name: school-search
description: Search for schools matching user criteria using the backend search API
metadata: {"openclaw": {"emoji": "🔍"}}
---

## School Search

Use this skill to search for schools that match user criteria.

### When to Use

- User asks to find schools in a specific area
- Expanding the candidate list based on new criteria
- Scout agent needs to discover new schools

### Backend API

**Search for schools:**

```
POST /api/schools/search
Authorization: X-Agent-Token

{
  "location": {
    "suburb": "Bondi",
    "state": "NSW",
    "radius_km": 10
  },
  "filters": {
    "type": ["private", "public", "catholic"],
    "level": ["primary", "secondary", "k-12"],
    "gender": ["coed", "boys", "girls"],
    "boarding": false
  },
  "limit": 20
}
```

**Response:**

```json
{
  "schools": [
    {
      "id": "school-uuid",
      "name": "Bondi Public School",
      "type": "public",
      "level": "primary",
      "suburb": "Bondi",
      "state": "NSW",
      "profile_freshness": "2024-01-15",
      "data_quality": "high"
    }
  ],
  "total": 45,
  "has_more": true
}
```

### Best Practices

1. **Start broad, then narrow** - Use minimal filters first to understand availability
2. **Check data quality** - Schools with `data_quality: "low"` may need a crawl
3. **Respect limits** - Don't request more than 50 schools at once
4. **Cache results** - Avoid repeated searches for the same criteria

### Related Skills

- `profile-extraction` - Get detailed data for specific schools
- `fit-analysis` - Analyze how well schools match user preferences
