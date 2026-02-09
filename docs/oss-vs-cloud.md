# OSS vs Clasper Cloud

## External Proof (defined term)

**External Proof** = evidence that can be verified by a party that does not trust the operator.

Clasper Core **never** generates External Proof.  
Clasper Cloud is the **only** issuer of externally verifiable attestations.

Why it matters: auditors, regulators, and legal discovery.

---

## The Boundary (Trust, not features)

**OSS stops at single-tenant, self-attested governance.**  
**Cloud begins at shared authority, shared trust, and external proof.**

---

## What Clasper Core Includes (OSS)

- Deterministic policy evaluation + decisioning (`allow / deny / require_approval / pending`)
- Capability request model + adapter contract
- Local execution adapters + local telemetry ingest
- Local trace store + local Ops Console (single operator)
- Local risk + cost primitives
- Local audit log and **self-attested** export bundles

> OSS users should be able to say:  
> “I fully govern my agents — but only my agents.”

---

## What Is Cloud-Only (Non-negotiable)

- Multi-tenant identity + org RBAC
- Human approvals with **Cloud-issued decision tokens**
- Evidence signing + attestation issuance (**External Proof**)
- Central policy distribution, promotion, and rollback with audit
- Fleet-wide dashboards, alerting, and compliance exports

---

## Approvals in OSS

Clasper Core can emit **pending** decisions, but **cannot complete approvals without Cloud**.

Any local override must be:

- explicitly labeled as **LOCAL_OVERRIDE**
- recorded with a **trust downgrade** (“self-attested; not externally verifiable”)
- excluded from “externally verified” compliance claims

---

## Upgrade Triggers

Move to Clasper Cloud when you need:

- more than one human approver
- multiple environments or teams
- compliance-grade retention and audit
- externally verifiable evidence

---

## One-Sentence Rule

**Open source Clasper governs execution you own.  
Clasper Cloud governs execution you must answer for.**
