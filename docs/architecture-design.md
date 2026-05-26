# Architecture Design — EARIST SAS Portal

## 1. Overview

The EARIST Student Affairs System (SAS) Portal is a full-stack web application that manages student-organization document workflows for the EARIST Office of Student Affairs. It implements two primary document directions:

- **Incoming documents** — submitted by student organizations (activity proposals, financial reports, accomplishment reports, fund-utilization reports).
- **Outgoing documents** — published by SAS (Memorandums broadcast to all organizations, and Endorsement Letters generated as part of the activity-proposal pipeline).

The most complex workflow is the **Activity Proposal Pipeline**, a six-stage sequential approval flow involving the Institute Student Government (ISG), SAS, the Office of the VPAA, and the Office of the President.

---

## 2. High-Level Architecture

```
                ┌────────────────────────────────────────┐
                │              END USERS                  │
                │  Student Org │ ISG │ SAS Admin │ VPAA/OP│
                └──────────────────┬─────────────────────┘
                                   │ HTTPS
                                   ▼
        ┌──────────────────────────────────────────────┐
        │             FRONTEND (Vite + React 19)        │
        │  ─ SPA, event-driven navigation (no Router)   │
        │  ─ src/pages/*  src/components/*              │
        │  ─ src/services/*  (Firestore/Storage calls)  │
        └──────────────┬─────────────────────┬──────────┘
                       │                     │
       Firebase SDK    │                     │  fetch()
       (client)        ▼                     ▼
        ┌─────────────────────────┐  ┌────────────────────────┐
        │  FIREBASE BaaS           │  │  EXPRESS API (Node 5)  │
        │  ─ Auth                  │  │  server.js             │
        │  ─ Firestore (NoSQL)     │◄─┤  ─ OTP email           │
        │  ─ Cloud Storage         │  │  ─ Password reset      │
        │  ─ Security Rules        │  │  ─ Credentials email   │
        └─────────────────────────┘  │  ─ Review-token routes │
                                     │  ─ PDF signature stamp │
                                     │  Firebase Admin SDK    │
                                     └────────────┬───────────┘
                                                  │ SMTP
                                                  ▼
                                          ┌──────────────┐
                                          │  Gmail SMTP  │
                                          └──────────────┘
```

---

## 3. Tier-by-Tier Description

### 3.1 Presentation Tier (Frontend)

| Aspect | Detail |
|---|---|
| Framework | React 19 |
| Build tool | Vite 7 |
| Routing | **No router** — `App.jsx` listens to two custom DOM events (`pageNavigate`, `adminNavigate`) and renders the matching page component. The only true route is `/review` (tokenized review for external offices). |
| State | Local `useState` / `useRef`. Auth state comes from `onAuthStateChanged()` in `App.jsx`. OTP flow uses `sessionStorage`. |
| Styling | Plain CSS, one file per component. Theme variables in `src/styles/colors.css`. |
| Code organization | `src/pages/` — top-level views, `src/components/` — reusable UI, `src/services/` — all Firestore/Storage/Express calls, `src/config/firebase.jsx` — client SDK init, `src/utils/` — helpers. |

### 3.2 Application Tier (Express API)

`server.js` is a single-file Express 5 application that handles every operation that cannot be safely executed from the browser.

| Concern | Endpoint(s) |
|---|---|
| Login OTP | `POST /api/send-otp`, `POST /api/verify-otp`, `POST /api/check-lockout` |
| Password reset | `POST /api/reset-password`, `POST /api/admin-reset-password` |
| Account provisioning | `POST /api/create-account`, `POST /api/send-credentials` |
| Pipeline emails | `POST /api/send-review-link`, `POST /api/send-additional-doc-request`, `POST /api/notify-admins`, `POST /api/send-notification-email` |
| Tokenized review | `GET /api/review/:token`, `POST /api/review/:token/decision`, `POST /api/review/:token/signature`, `GET /api/review/:token/signature-status`, comment routes |
| Admin maintenance | `POST /api/admin/regenerate-review-token` |
| Health | `GET /health` |

Middleware stack: `helmet`, `cors` (allowlist), `express-rate-limit` (per endpoint), `requireAuth` / `requireAdmin` (Firebase ID-token verification), `multer` (signature upload).

### 3.3 Data Tier (Firebase)

| Service | Role |
|---|---|
| Firebase Auth | User identity, email/password login, session tokens |
| Firestore | All structured data — see ERD (`docs/erd-planning.md` and `docs/entity-relationship-diagram.md`) |
| Cloud Storage | Uploaded files (`documents/{documentId}/{requirementKey}/{fileName}`) |
| Security Rules | `firestore.rules` and `storage.rules` enforce per-document access by role and organization |

Counters (`documentCounters`, `systemCounters`) are updated inside Firestore transactions to guarantee unique sequence numbers under concurrent writes.

---

## 4. Cross-Cutting Concerns

| Concern | Implementation |
|---|---|
| Authentication | Firebase Auth (email + password) + 6-digit email OTP issued by the Express API and stored in the `otps` collection with a 10-minute TTL. |
| Authorization | `users.role` (`"Admin"` / `"Organization"`) drives client-side routing in `App.jsx`. Firestore Security Rules enforce per-document and per-collection access. |
| Idle timeout | `useIdleTimeout` (30 min) signs the user out client-side. |
| Privacy consent | First-time login presents `ConsentModal`; consent timestamp stored on the user document. |
| Activity log | `authActivityLogService.js` and `adminActivityLogService.js` write to dedicated Firestore collections. |
| Notifications | `notificationService.js` writes Firestore records consumed by `NotificationBell.jsx`. Server-side email reminders fire from the Admin's session post-login. |
| Tokenized review | `reviewTokens` collection — one-shot, time-limited tokens emailed to VPAA/OP/FMS/Procurement. Verified on `/review` route via `server.js`. |
| File handling | Uploaded to Firebase Storage with structured paths. PDF stamping for signed endorsements happens server-side via `server/pdfStamper.js`. |
| Error logging | `console.error` only; no centralized error tracker in this codebase. |

---

## 5. Service Layer (in `src/services/`)

Every Firestore/Storage call goes through a service module — UI components never touch the Firebase SDK directly.

| Service | Responsibility |
|---|---|
| `userService.js` | CRUD on `users`, role checks, last-login update, privacy consent |
| `organizationService.js` | Lookup and update `organizations` |
| `documentService.js` | Submit / fetch / status-transition documents; pipeline transitions (`endorseProposal`, `completeSASReview`, `releaseFromSASToISG`, `markAsDistributed`, etc.) |
| `equipmentService.js` / `equipmentRequestService.js` / `equipmentPdfService.js` | Equipment-borrowing subsystem |
| `notificationService.js` | In-app notifications, reminder scans |
| `adminService.js` / `adminActivityLogService.js` | Admin-only queries and audit log |
| `authActivityLogService.js` | Login / logout audit log |
| `otpService.js` / `emailService.js` / `apiClient.js` | Talk to the Express API (`VITE_API_BASE_URL`) |
| `storageService.js` | Upload, download URLs, delete |
| `reviewTokenService.js` | Generate/regenerate tokens; deadline-warning scans |
| `officeService.js` | `officeProfiles` (VPAA/OP/FMS/Procurement contact info) |
| `reportService.js` | Org-side reports + overdue scans |
| `commentService.js` | Inline review comments |

---

## 6. Activity-Proposal Pipeline (detail)

See `docs/activity-proposal-flow.md` for the full specification. Summary:

- **Stages**: `isg_endorsement` → `sas_review` → `vpaa_review` → `op_approval` → `sas_release` → `isg_distribution` (org-submitted). ISG-submitted proposals skip `isg_endorsement` and `isg_distribution`, and insert `fms_review` + `procurement_review` after `op_approval`.
- **Pipeline state** is embedded on the document as `pipeline.currentStage` and an append-only `pipeline.stages[]` history array.
- **VPAA / OP / FMS / Procurement** never log in — they act via tokenized email links (`/review?token=…`).
- **Returns** regress `currentStage` to the appropriate earlier stage and append a new entry; old entries are never overwritten.

---

## 7. Build, Deploy, and Environments

| Command | Purpose |
|---|---|
| `npm run dev:all` | Runs the Express API (`:3001`) and Vite dev server (`:5173`) concurrently. |
| `npm run dev` | Frontend only. |
| `npm run server` | Backend only. |
| `npm run build` | Production Vite build → `dist/`. |
| `npm run preview` | Serve the production build locally. |
| `npm run lint` | ESLint. |
| `npm run deploy:rules` | `firebase deploy --only storage,firestore:rules,firestore:indexes`. |

Required environment files: `.env` (Vite — `VITE_FIREBASE_*`, `VITE_API_BASE_URL`) and a backend `.env` (`GMAIL_USER`, `GMAIL_PASS`, `PORT`). `serviceAccountKey.json` must be present at the project root and is gitignored.

---

## 8. Architectural Constraints & Trade-offs

| Constraint | Reason |
|---|---|
| No global state library | Codebase is small enough to manage with hooks; lower learning curve. |
| Event-driven navigation, no Router | Original prototype choice; preserved because no deep-linking is required (except `/review`). |
| Firebase as the backend | Speeds development; off-loads auth, storage, and access control. |
| Single Express server (no microservices) | All server-side logic is tied to email and Firebase Admin; one service is sufficient. |
| One user per organization (1:1) | Enforced at the service layer; simplifies the data model. |
| Token-based review for external offices | Avoids onboarding non-system users while preserving an audit trail. |
