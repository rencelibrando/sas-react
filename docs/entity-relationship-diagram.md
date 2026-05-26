# Entity-Relationship Diagram — EARIST SAS Portal

> A condensed ERD. See `docs/erd-planning.md` for the canonical field-by-field schema, status flows, and design decisions.

---

## 1. Entity Catalogue

| Collection | Role |
|---|---|
| `organizations` | Recognized student organizations (ISG, CSG, AO). |
| `users` | Portal accounts — admins or organization officers. |
| `documents` | Central document store (incoming + outgoing). |
| `documentStatusHistory` | Append-only audit log of status transitions. |
| `documentCounters` | Per-org, per-year sequence counters. |
| `systemCounters` | Global counters (org number, Memorandum number). |
| `officeProfiles` | Contact info for non-system reviewers (VPAA, OP, FMS, Procurement). |
| `reviewTokens` | Single-use tokenized links emailed to external reviewers. |
| `otps` | Short-lived 2FA codes (10-minute TTL). |

---

## 2. ASCII ERD (Crow's-foot)

Symbols: `‖` = one and only one, `|` = one (mandatory), `o` = zero (optional), `<` / `>` = many.

```
                          ┌──────────────────────────┐
                          │      SYSTEM_COUNTERS     │
                          ├──────────────────────────┤
                          │ PK  counterId            │
                          │     count                │
                          │     year (nullable)      │
                          └─────────────┬────────────┘
                                        │ generates
                                        │ 1
                                        ▼ N
                          ┌──────────────────────────┐
                          │       ORGANIZATIONS      │
                          ├──────────────────────────┤
                          │ PK  organizationId       │
                          │     organizationNumber   │
                          │     name                 │
                          │     type ("ISG"|"CSG"|   │
                          │            "AO")          │
                          │     status               │
                          │     dateCreated          │
                          │     lastUpdated          │
                          └──┬─────────┬─────────────┘
            1 ── has officer │         │ 1 ── owns
                             ▼ 1       ▼ N
        ┌──────────────────────┐   ┌────────────────────────┐
        │        USERS         │   │   DOCUMENT_COUNTERS    │
        ├──────────────────────┤   ├────────────────────────┤
        │ PK  userId (Auth UID)│   │ PK  counterKey         │
        │     fullName          │   │     organizationId(FK) │
        │     email             │   │     year               │
        │     role ("Admin"|    │   │     count              │
        │           "Organization")│ └─────────┬──────────────┘
        │     userRole (nullable)│             │ generates 1 → N
        │     organizationId (FK,│             ▼
        │       nullable)        │   ┌────────────────────────┐
        │     status             │   │       DOCUMENTS         │
        │     dateCreated        │ N ├────────────────────────┤
        │     lastLogin          ├──►│ PK  documentId          │
        │     lastUpdated        │ submits│ direction              │
        │     deletedAt          │ N │     documentType        │
        │     privacyConsentAt   │──►│     documentNumber      │
        └─────────┬──────────────┘ creates│ title                  │
                  │              N │     description          │
                  │ N changes      ▼     │     organizationId (FK,n)│
                  │              ┌─────────────────────────────┐
                  │              │     submittedBy   (FK→USER) │
                  │              │     assignedTo    (FK→USER) │
                  │              │     createdBy     (FK→USER) │
                  │              │     updatedBy     (FK→USER) │
                  │              │     status                  │
                  │              │     remarks                 │
                  │              │     files[ ]                │
                  │              │     proposalFlags{}         │
                  │              │     revisionCount           │
                  │              │     pipeline{}              │
                  │              │     dateSubmitted           │
                  │              │     dateLastRevised         │
                  │              │     dateAssigned            │
                  │              │     dateReviewed            │
                  │              │     dateReleased            │
                  │              │     lastUpdated             │
                  │              └────────┬───────────┬────────┘
                  │                       │ 1         │ 1 (proposals)
                  │                       ▼ N         ▼ N
                  │              ┌─────────────────┐  ┌─────────────────┐
                  └─────────────►│ DOC_STATUS_HIST │  │  REVIEW_TOKENS  │
                              N  ├─────────────────┤  ├─────────────────┤
                                 │ PK historyId    │  │ PK tokenId      │
                                 │    documentId(FK)│  │    token (uniq) │
                                 │    status        │  │    documentId   │
                                 │    previousStatus│  │    stage        │
                                 │    changedBy (FK)│  │    officeId (FK)│
                                 │    remarks       │  │    sentToEmail  │
                                 │    timestamp     │  │    sentAt        │
                                 └─────────────────┘  │    expiresAt     │
                                                      │    consumed      │
                                                      │    consumedAt    │
                                                      │    action        │
                                                      │    remarks       │
                                                      └────────┬─────────┘
                                                               │ N
                                                               ▼ 1
                                                      ┌────────────────────┐
                                                      │   OFFICE_PROFILES  │
                                                      ├────────────────────┤
                                                      │ PK officeId        │
                                                      │    officeName      │
                                                      │    abbreviation    │
                                                      │    contactEmail    │
                                                      │    updatedBy (FK)  │
                                                      │    lastUpdated     │
                                                      └────────────────────┘

       Auxiliary (not on main diagram):

       ┌────────────────────────┐
       │          OTPS          │  document id = email; 10-min TTL
       ├────────────────────────┤
       │    otp                  │
       │    email                │
       │    createdAt            │
       │    expiresAt            │
       │    verified (false)     │
       └────────────────────────┘
```

---

## 3. Relationship Summary

| Parent → Child | Cardinality | Stored as |
|---|---|---|
| `organizations` → `users` | 1 : 1 (active) | `users.organizationId` |
| `organizations` → `documents` (incoming) | 1 : N | `documents.organizationId` |
| `organizations` → `documentCounters` | 1 : N | `documentCounters.organizationId` |
| `users` → `documents` | 1 : N | `documents.submittedBy` / `createdBy` / `assignedTo` |
| `documents` → `documentStatusHistory` | 1 : N | `documentStatusHistory.documentId` |
| `documents` → `reviewTokens` | 1 : N (≤2 active) | `reviewTokens.documentId` |
| `officeProfiles` → `reviewTokens` | 1 : N | `reviewTokens.officeId` |
| `documents` (proposal) → `documents` (endorsement_letter) | 1 : 0..N | `pipeline.stages[n].generatedDocId` |
| `systemCounters` → `organizations.organizationNumber` | generator | `systemCounters/organizationNumber` |
| `systemCounters` → `documents.documentNumber` (Memorandum) | generator | `systemCounters/outgoing_{year}` |
| `documentCounters` → `documents.documentNumber` (incoming, endorsement) | generator | `documentCounters/{orgId}_{year}` or `documentCounters/endorsement_{orgId}_{year}` |

---

## 4. Key Constraints

1. `users.organizationId` must be `null` for admins and present for organization officers.
2. `users.role ∈ {"Admin", "Organization"}` — used by `App.jsx` for routing.
3. `documents.organizationId` is `null` only for Memorandums (broadcast).
4. `pipeline.stages` is **append-only** — history is preserved across regressions.
5. `reviewTokens.token` is unique and single-use; once `consumed = true` it can no longer move the pipeline.
6. Counter increments happen inside Firestore transactions to guarantee uniqueness.
7. `proposalFlags` exists only on `activity_proposal` documents and drives the required-files completeness gate.
8. `endorsement_letter` documents are children of the originating proposal via `pipeline.stages[n].generatedDocId`.

---

## 5. Document Status Lifecycle

```
[incoming / non-proposal]
   pending ─▶ under_review ─▶ approved ─▶ released
                        ├─▶ returned ─▶ pending
                        └─▶ rejected   (terminal)

[activity_proposal]
   pending ─▶ in_pipeline ─▶ approved ─▶ released
              │
              ▼ stage actor may "return" at any stage:
              currentStage regresses; status → "returned"
              (no terminal `rejected`; admin uses remarks)

[outgoing / Memorandum]
   draft ─▶ released
```

---

## 6. Numbering Cheatsheet

| Document | Format | Example | Source |
|---|---|---|---|
| Incoming (org-submitted) | `{orgNumber}-{year}-{seq}` | `002-2025-007` | `documentCounters/{orgId}_{year}` |
| Endorsement Letter | `{orgNumber}{YY}_{seq}` | `00225_007` | `documentCounters/endorsement_{orgId}_{year}` |
| Memorandum | `{year}-{seq}` | `2025-012` | `systemCounters/outgoing_{year}` |
| Organization Number | 3-digit `{seq}` | `002` | `systemCounters/organizationNumber` |
