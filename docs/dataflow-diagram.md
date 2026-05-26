# Data Flow Diagram — EARIST SAS Portal

This document presents the data flow at two levels of detail: a **Context Diagram (Level 0)** showing the system as a single process exchanging data with external entities, and a **Level-1 DFD** decomposing that single process into the major internal processes and data stores.

Notation:
- `Square` external entity
- `(Process)` internal process
- `=Data Store=` data store
- `─▶` flow of data

---

## 1. Context Diagram (Level 0)

```
   ┌───────────────────────┐                                ┌─────────────────────────┐
   │  Student Organization │── submission, revisions ──▶    │                         │
   │       Officer          │◀── status updates, notifs ──  │                         │
   └───────────────────────┘                                │                         │
                                                            │                         │
   ┌───────────────────────┐  endorse / forward / return    │                         │
   │   ISG Officer          ├──────────────────────────────▶│                         │
   │  (also submitter)      │◀── pending list, notifs ──    │                         │
   └───────────────────────┘                                │                         │
                                                            │                         │
   ┌───────────────────────┐  review / decisions / publish  │   EARIST SAS PORTAL     │
   │   SAS Admin            ├──────────────────────────────▶│        (system)         │
   │                        │◀── dashboards, reports ──     │                         │
   └───────────────────────┘                                │                         │
                                                            │                         │
   ┌───────────────────────┐  OTP code (email)              │                         │
   │   Gmail SMTP           │◀──────────────────────────────│                         │
   │                        │── delivery status ────────▶   │                         │
   └───────────────────────┘                                │                         │
                                                            │                         │
   ┌───────────────────────┐   tokenized review email       │                         │
   │   VPAA / OP / FMS /    │◀──────────────────────────────│                         │
   │   Procurement          │── approve / return (token) ──▶│                         │
   └───────────────────────┘                                │                         │
                                                            │                         │
   ┌───────────────────────┐                                │                         │
   │   Firebase BaaS        │◀── reads / writes ──────────▶ │                         │
   │  (Auth, Firestore,     │                                │                         │
   │   Storage)             │                                │                         │
   └───────────────────────┘                                └─────────────────────────┘
```

**External entities**
- Student Organization Officer (CSG / AO).
- ISG Officer (both reviewer and possible submitter).
- SAS Admin.
- VPAA / OP / FMS / Procurement (tokenized reviewers; not system users).
- Gmail SMTP (outbound email).
- Firebase (data backend — modelled as external because the application does not host it).

---

## 2. Level-1 DFD

The single process from the context diagram is decomposed into eight numbered processes and their data stores.

```
   ┌──────────────────────────┐         ┌──────────────────────────────┐
   │ Student Organization     │         │     SAS Admin                │
   │ Officer                  │         │                              │
   └──────────┬───────────────┘         └───────────────┬──────────────┘
              │ credentials                              │ credentials
              ▼                                          ▼
        ┌───────────────────────────────────────────────────────┐
        │ (1) Authenticate & Authorize                          │
        │      ─ password + email OTP                           │
        └────┬───────────────────────────────────┬──────────────┘
             │ writes/reads                       │ session cookie
             ▼                                    ▼
        ╔══════════════╗                  back to UI
        ║ =D1 otps=     ║
        ║ =D2 users=    ║◀── lastLogin, privacyConsent
        ╚══════════════╝

  ┌─────────────────────┐                                                  ┌────────────────────┐
  │ Student Org Officer │ files + form                                     │  ISG Officer        │
  └──────────┬──────────┘                                                  └─────────┬──────────┘
             │                                                                       │ endorse / return
             ▼                                                                       ▼
        ┌─────────────────────────────────────────────┐   ┌─────────────────────────────────────────────┐
        │ (2) Submit / Revise Document                │   │ (3) ISG Completeness & Endorsement          │
        │     ─ upload to Storage                      │──▶│     ─ verify required files                  │
        │     ─ allocate documentNumber               │   │     ─ forward to SAS / return w/ remarks    │
        │     ─ create document record                │   └────────────────┬───────────────────────────┘
        └────────────┬────────────────────────────────┘                    │
                     │ writes                                              │ writes pipeline.stages[]
                     ▼                                                     ▼
                  ╔═══════════════════╗            ╔══════════════════════════════════╗
                  ║ =D3 documents=     ║◀──────────║ =D4 documentStatusHistory=       ║
                  ╚═══════════════════╝   reads    ╚══════════════════════════════════╝
                     ▲ ▲      ▲                                ▲
                     │ │      │ counter                        │
                     │ │      ▼                                │
                     │ │  ╔════════════════════╗               │
                     │ │  ║ =D5 documentCounters║              │
                     │ │  ║    systemCounters= ║               │
                     │ │  ╚════════════════════╝               │
                     │ │                                       │
                     │ │ reviews / writes                      │
                     │ │                                       │
                     │ ▼                                       │
         ┌───────────────────────────────────────────────────────────┐
         │ (4) SAS Review & Endorsement Letter Generation             │
         │     ─ open document; decide approve / return               │
         │     ─ generate Endorsement Letter PDF                       │
         │     ─ allocate endorsement number                           │
         │     ─ create outgoing document; link via generatedDocId    │
         │     ─ issue VPAA review token                               │
         └────────────┬─────────────────────────────┬─────────────────┘
                      │ writes                       │ creates token
                      ▼                              ▼
                  =D3 documents=            ╔════════════════════╗
                  =D4 documentStatusHistory=║ =D6 reviewTokens=  ║
                                            ╚═══════╤════════════╝
                                                    │ sentToEmail
                                                    ▼
                                         ┌───────────────────────┐
                                         │ (5) Email Dispatch     │
                                         │  ─ OTP                  │
                                         │  ─ credentials           │
                                         │  ─ review-link           │
                                         │  ─ notifications         │
                                         └──────────┬────────────┘
                                                    │ SMTP
                                                    ▼
                                          ┌────────────────────┐
                                          │  Gmail SMTP         │
                                          └────────────────────┘
                                                    │
                                                    ▼ tokenized link
                                  ┌────────────────────────────────┐
                                  │  VPAA / OP / FMS / Procurement │
                                  │  (external reviewers)          │
                                  └──────────────┬─────────────────┘
                                                 │ approve / return + signature
                                                 ▼
                          ┌──────────────────────────────────────────────┐
                          │ (6) Tokenized Review Handler                 │
                          │     ─ validate token (not expired/consumed)  │
                          │     ─ stamp signature on letter PDF          │
                          │     ─ advance or regress pipeline            │
                          └──┬────────────────────┬──────────────────────┘
                             │ updates             │ consumes
                             ▼                     ▼
                       =D3 documents=        =D6 reviewTokens=
                       =D4 documentStatusHistory=

                ┌──────────────────────────┐
                │   SAS Admin               │ writes Memorandums, equipment, reports
                └────────────┬──────────────┘
                             ▼
        ┌──────────────────────────────────────────────────┐
        │ (7) Memorandum & Outgoing Doc Publication        │
        │     ─ allocate Memorandum number                  │
        │     ─ draft → release                              │
        │     ─ broadcast notifications                       │
        └──────────────┬───────────────────────────────────┘
                       │ writes
                       ▼
                =D3 documents=    =D7 notifications=
                                            ▲
                                            │
        ┌──────────────────────────────────────────────────┐
        │ (8) Notification & Reminder Engine                 │
        │     ─ in-app notifications                         │
        │     ─ overdue-report scan                          │
        │     ─ token-expiry warnings                        │
        │     ─ equipment-return reminders                   │
        └──────────────┬───────────────────────────────────┘
                       │ delivery
                       ▼
                Student Org / ISG / SAS Admin UI
```

---

## 3. Data Stores

| ID | Name | Description |
|---|---|---|
| D1 | `otps` | Short-lived OTP codes (10-minute TTL), document id = email. |
| D2 | `users` | Portal accounts and roles. |
| D3 | `documents` | Central document table (incoming + outgoing). |
| D4 | `documentStatusHistory` | Append-only audit log of status transitions. |
| D5 | `documentCounters` + `systemCounters` | Sequence counters used by document-number generation. |
| D6 | `reviewTokens` | Tokenized review credentials for VPAA / OP / FMS / Procurement. |
| D7 | `notifications` | In-app notification records. |
| —  | Cloud Storage | Uploaded files at `documents/{documentId}/{requirementKey}/{fileName}`. |

(Equipment, reports, and office-profile stores are omitted from the Level-1 diagram for brevity — they follow the same pattern as documents.)

---

## 4. Process Catalogue

| # | Process | Inputs | Outputs | Where implemented |
|---|---|---|---|---|
| 1 | Authenticate & Authorize | email, password, OTP | session, `users.role` | `AuthPage.jsx`, `server.js#send-otp/verify-otp`, `otpService.js` |
| 2 | Submit / Revise Document | form fields + files | `documents` write, Storage upload | `documentService.js#submitActivityProposal/submitDocument/uploadRevision`, page components |
| 3 | ISG Completeness & Endorsement | proposal id, action | pipeline stage update | `documentService.js#endorseProposal/returnProposalFromISG`, `ISGEndorsementPage.jsx` |
| 4 | SAS Review & Endorsement Letter | proposal id, signed PDF | outgoing doc, review token | `documentService.js#completeSASReview/returnFromSAS`, `reviewTokenService.js`, `AdminActivityProposals.jsx` |
| 5 | Email Dispatch | recipient, payload | SMTP delivery | `server.js` (`/api/send-otp`, `/api/send-credentials`, `/api/send-review-link`, `/api/send-notification-email`) |
| 6 | Tokenized Review Handler | token, decision, optional signature | pipeline transition | `server.js` (`/api/review/:token/*`), `server/pdfStamper.js` |
| 7 | Memorandum & Outgoing Doc Publication | title, body, attachment, mode | `documents` write | `documentService.js#createOutgoingDocument`, `AdminMemorandums.jsx` |
| 8 | Notification & Reminder Engine | scheduled scan triggers | `notifications` writes, optional emails | `notificationService.js`, `reportService.js`, `reviewTokenService.js`, `equipmentRequestService.js` |

---

## 5. Key Flows in Plain English

1. **Login** — User submits credentials to (1); (1) checks lockout, signs in via Firebase, then signs out and asks (5) to send an OTP. User submits the OTP back to (1), which clears `D1` and re-establishes the session.
2. **Proposal submission** — Officer uploads files; (2) writes Storage and a row in `D3` with `pipeline.currentStage = isg_endorsement` (or `sas_review` if the submitter is ISG); (8) notifies admins and ISG.
3. **ISG endorsement** — (3) checks `proposalFlags` against `files` requirement keys; if complete, advances `currentStage` to `sas_review`; otherwise returns with remarks and (8) notifies the submitter.
4. **SAS review** — (4) lets the Admin generate and upload a signed Endorsement Letter PDF; allocates a number from `D5`; creates an outgoing document linked back via `generatedDocId`; issues a token in `D6` and asks (5) to email it.
5. **External review** — VPAA / OP / FMS / Procurement open `/review?token=…`, which routes through (6). On approval, (6) stamps a signature on the PDF and advances the pipeline. On return, (6) regresses to `sas_review` and notifies the Admin via (8).
6. **Release & distribution** — At `sas_release`, (4) publishes; for org-submitted proposals the pipeline moves to `isg_distribution`, where ISG marks the document as distributed and (8) notifies the submitting organization.
7. **Memorandums** — (7) lets the Admin publish broadcast announcements; (8) writes a `notifications` row per organization.
8. **Reminders** — On first admin login per session, (8) scans `D3` for overdue reports and `D6` for tokens nearing expiry; it writes notifications and may invoke (5) for email delivery.
