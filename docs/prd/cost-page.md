# PRD: Cost Page (Ops UI)

## Product Area

Ops UI → Platform → Cost

## Applies To

* **Clasper Core (OSS)** — v1 scope
* **Clasper Cloud** — future extension (not implemented here)

---

## 1. Problem Statement

Today, cost visibility in Clasper exists but is fragmented:

* The **Dashboard** shows a 7-day total and sparkline.
* The **Traces** view shows per-trace cost.
* There is no place to answer:

  > “Where did this cost come from, over time, and what executions caused it?”

This forces operators to:

* mentally aggregate cost
* manually correlate traces
* lose governance context around spend

**Cost is already a first-class signal in Clasper’s data model, but not yet a first-class UX surface.**

---

## 2. Product Goal

Create a **Cost page** that provides:

> **Clear time-series spend visibility with fast, opinionated drill-down into governed executions.**

The Cost page is **not**:

* a billing system
* an invoice view
* a Cloud pricing surface

It **is**:

* a governance visibility surface
* a navigation hub between cost and traces
* a complement to policy and risk signals

---

## 3. Design Principles

1. **Governance-aligned**

   * Cost is shown in the context of executions and traces.
2. **Time-first**

   * Cost is understood over time before it is broken down by dimension.
3. **Drill-down, not duplication**

   * Detailed investigation always happens in **Traces**, not on the Cost page.
4. **Backend-light (v1)**

   * Reuse existing APIs; no new aggregation endpoints required.
5. **Extendable**

   * The page should clearly support future breakdowns without refactor.

---

## 4. In-Scope (v1)

### 4.1 Core Capabilities

The Cost page will:

* Show **daily spend over time** for a selected range (7d / 30d).
* Show **total spend** for the selected range.
* Allow **single-click drill-down** from a day → Traces filtered to that day.
* Automatically respect the active **workspace scope** via `buildParams()`.

---

### 4.2 Supported Time Ranges (v1)

* Presets only:

  * **7d**
  * **30d**

Custom date pickers are explicitly **out of scope** for v1.

---

### 4.3 Drill-Down Behavior (Critical)

Clicking a day on the Cost page:

* Navigates to `#traces`
* Applies:

  * `start_date=YYYY-MM-DD`
  * `end_date=YYYY-MM-DD`
* Uses existing Traces pagination, sorting, and filters.

**The Cost page never renders trace tables itself.**

---

## 5. UX Definition (v1)

### 5.1 Page Layout

**Header**

* Page title: **Cost**
* Subtitle (static copy):

  > “Model usage cost associated with governed executions.”
* Range toggle: `7d | 30d`
* Manual refresh button

**Summary Section**

* Total cost for selected range (large, primary)
* Small explanatory text:

  > “Excludes infrastructure and downstream system costs.”

**Chart Section**

* Daily cost chart (bars or line)
* X-axis: date
* Y-axis: cost
* Clickable data points (day → traces)

**Daily List/Table (Optional but recommended)**

* Date
* Daily total
* Chevron / link affordance → traces

---

### 5.2 Empty / Loading / Error States

* **Loading**: skeleton chart + muted totals
* **Empty**: “No cost data for this range”
* **Error**: reuse existing toast pattern

---

## 6. URL, Routing, and Navigation

### 6.1 Route

```
#cost
#cost?range=7d
#cost?range=30d
```

(Future-proofed but not required in v1:)

```
#cost?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
```

---

### 6.2 Navigation

* Sidebar entry:

  ```
  Platform
    └─ Cost
  ```

* Dashboard:

  * Make **Cost (7d)** stat card clickable → `#cost?range=7d`

This reinforces:

* dashboard = summary
* Cost page = investigation starting point

---

## 7. Frontend Implementation Plan (v1)

### 7.1 New View

**File**

```
src/ops-ui/src/views/cost.jsx
```

**Responsibilities**

* Parse hash params (`range`)
* Call:

  ```
  GET /ops/api/dashboards/cost?{buildParams(range)}
  ```
* Render header, totals, chart, and daily rows

---

### 7.2 Routing

**File**

```
src/ops-ui/src/app.jsx
```

Add:

```js
cost: CostView
```

---

### 7.3 Sidebar Navigation

**File**

```
src/ops-ui/src/components/sidebar.jsx
```

Add:

```js
{ id: "cost", label: "Cost", icon: DollarIcon }
```

---

### 7.4 Traces Drill-Down Support

**Enhancement**

* Extend TracesView hash parsing to accept:

  * `end_date`
* Pass `start_date` / `end_date` through to:

  ```
  GET /ops/api/traces
  ```

**Reset behavior**

* Clearing filters removes both dates.

---

### 7.5 Copy & Tooltips

Centralize Cost page copy in:

```
src/ops-ui/src/copy.js
```

Examples:

* “Total cost reflects model usage only”
* “Click a day to view related traces”

---

## 8. Explicit Non-Goals (v1)

The Cost page will **not**:

* Show invoices or billing data
* Show user-level or role-level breakdowns
* Perform client-side aggregation over large trace sets
* Replace or duplicate the Traces view
* Introduce new backend APIs

---

## 9. “Nice Next” (Post-v1, Not Blocking)

These are **deliberate extension points**, not commitments.

### 9.1 Aggregated Breakdowns (Backend Required)

* By adapter
* By agent role
* By capability

Only added once the backend can aggregate efficiently.

---

### 9.2 Custom Date Ranges

* Date picker on Cost page
* Still drills into Traces for detail

---

### 9.3 Cost → Governance Correlation

Examples:

* “Top cost drivers by capability”
* “Policies associated with highest spend”
* “High-cost executions requiring approval”

This is where Cost becomes a **governance control surface**, not just reporting.

---

## 10. Success Criteria

v1 is successful if:

* Users can answer “where did this cost come from?” in <30 seconds.
* Cost navigation feels natural from the Dashboard.
* No new backend work was required.
* The page feels obviously extensible, not disposable.

---

## 11. One-Sentence Vision Anchor

> **The Cost page is the time-series entry point into governed execution spend, with traces as the source of truth.**

