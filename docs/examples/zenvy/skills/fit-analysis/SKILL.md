---
name: fit-analysis
description: Analyze how well schools match user preferences and generate explainable recommendations
metadata: {"openclaw": {"emoji": "📊"}}
---

## Fit Analysis

Use this skill to analyze how well schools match user preferences and generate evidence-based recommendations.

### When to Use

- User asks for school recommendations
- Comparing multiple schools against criteria
- Analyst agent needs to score and explain fit

### Backend API

**Analyze fit for a school:**

```
POST /api/schools/{school_id}/fit
Authorization: X-Agent-Token

{
  "user_id": "user-uuid",
  "criteria": {
    "priorities": ["academics", "sports", "arts"],
    "budget_max": 25000,
    "commute_max_min": 30,
    "special_needs": ["dyslexia_support"]
  }
}
```

**Response:**

```json
{
  "school_id": "school-uuid",
  "fit_summary": {
    "overall": "good",
    "confidence": 0.85,
    "strengths": ["Strong academic program", "Within budget"],
    "concerns": ["Limited arts program", "No dedicated dyslexia support"],
    "missing_data": ["extracurricular_fees"]
  },
  "evidence": [
    {
      "claim": "Strong academic program",
      "source": "NAPLAN results 2023",
      "link": "https://..."
    }
  ]
}
```

**Compare multiple schools:**

```
POST /api/schools/compare
Authorization: X-Agent-Token

{
  "user_id": "user-uuid",
  "school_ids": ["school-1", "school-2", "school-3"],
  "criteria": { ... }
}
```

### Best Practices

1. **Always cite evidence** - Never make claims without sources
2. **Highlight tradeoffs** - Show what's good AND what's missing
3. **State confidence** - Be clear when data is incomplete
4. **Request crawls** - If data is stale, request a profile refresh

### Fit Assessment Guidelines

| Signal | Weight | Notes |
|--------|--------|-------|
| Academic results | High | Use NAPLAN, HSC, IB scores |
| Fees & costs | High | Include hidden fees if known |
| Location/commute | Medium | Calculate from user's address |
| Special programs | Medium | Match to user priorities |
| Reviews/reputation | Low | Use with caution, cite sources |

### Communication Style

When presenting fit analysis:

```markdown
## School Name - Good Fit (85% confidence)

**Strengths:**
- Strong academic program (NAPLAN: top 10% in reading)
- Within budget ($22,000/year)

**Concerns:**
- Limited arts program (no dedicated music/drama)
- No dedicated dyslexia support mentioned on website

**Missing Data:**
- Extracurricular fees not published
- Recommend: Request profile refresh for current year
```

### Related Skills

- `school-search` - Find schools to analyze
- `profile-extraction` - Get detailed school data
- `user-profile` - Understand user preferences
