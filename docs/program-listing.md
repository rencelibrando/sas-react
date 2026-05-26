# Program Listing — EARIST SAS Portal

A catalogue of every source file in the repository, organized by layer. For each file, a one-line description of its role is given.

---

## 1. Project Root

| File | Description |
|---|---|
| `package.json` | npm manifest — declares scripts (`dev`, `server`, `dev:all`, `build`, `lint`, `preview`, `seed`, `deploy:rules`, `set-cors`) and dependencies (React 19, Vite 7, Express 5, Firebase 12, firebase-admin, nodemailer, multer, pdf-lib, helmet, express-rate-limit). |
| `package-lock.json` | npm lockfile. |
| `vite.config.js` | Vite configuration. |
| `eslint.config.js` | ESLint configuration. |
| `index.html` | SPA HTML shell loaded by Vite. |
| `firebase.json` | Firebase CLI configuration. |
| `firestore.rules` | Firestore Security Rules. |
| `firestore.indexes.json` | Firestore composite indexes. |
| `storage.rules` | Cloud Storage Security Rules. |
| `serviceAccountKey.json` | Firebase Admin credentials (gitignored). |
| `.env.example` | Template for required environment variables. |
| `.gitignore` | Git ignore list. |
| `.mcp.json` | Firebase MCP server configuration for tooling. |
| `CLAUDE.md` | Project guidance for the Claude Code assistant. |
| `README.md` | Repo overview. |
| `documentation.md` | Earlier prose documentation. |
| `todo.md` | Working task list. |
| `server.js` | Express 5 API entry point. See §4. |

---

## 2. Application Entry & Top-Level

| File | Description |
|---|---|
| `src/main.jsx` | React entry — mounts `<App/>` in `#root`. |
| `src/App.jsx` | Root component. Wires Firebase auth state, OTP gate, role-based routing, idle timeout, privacy consent, and admin background scans. |
| `src/App.css` | App-level CSS. |
| `src/index.css` | Global base styles. |

### Styles

| File | Description |
|---|---|
| `src/styles/colors.css` | Global CSS variables (primary maroon `#800020`, secondary cream `#f5f5dc`, accent gold `#ffd700`). |
| `src/styles/auth.css` | Authentication-screen shared styles. |

### Config

| File | Description |
|---|---|
| `src/config/firebase.jsx` | Initializes the Firebase Web SDK (Auth, Firestore, Storage) using `VITE_FIREBASE_*` env vars. |

---

## 3. Pages (`src/pages/`)

| File | Description |
|---|---|
| `AuthPage.jsx` | Sign-in, OTP verification, forgot-password, first-login profile setup. |
| `HomePage.jsx` | Default landing for student-org users — shows latest Memorandums and quick links. |
| `ActivityProposalsPage.jsx` | Org-facing list and submission view for activity proposals. |
| `ISGEndorsementPage.jsx` | ISG's `isg_endorsement` queue and actions. |
| `ISGDistributionPage.jsx` | ISG's `isg_distribution` queue and actions. |
| `MemorandumsPage.jsx` | Org view of released Memorandums. |
| `ReportsPage.jsx` | Org list/submit/view for reports. |
| `EquipmentBorrowingPage.jsx` | Org-facing equipment borrowing form and history. |
| `ProfilePage.jsx` | Org profile, password change, notification preferences, officer info. |
| `PrivacyPolicyPage.jsx` | Full privacy policy text. |
| `ReviewPage.jsx` | Tokenized review page mounted at `/review` — used by VPAA, OP, FMS, Procurement. |
| `AdminDashboard.jsx` | Admin landing — counts, KPIs, quick links. |
| `AdminActivityProposals.jsx` | Admin pipeline dashboard for activity proposals (SAS Review, SAS Release). |
| `AdminMemorandums.jsx` | Admin draft / publish Memorandums. |
| `AdminReports.jsx` | Admin reports queue. |
| `AdminEquipmentInventory.jsx` | Admin equipment catalogue management. |
| `AdminEquipmentRequests.jsx` | Admin equipment-request approvals and tracking. |
| `AdminAccountManagement.jsx` | Admin create/update organization and admin accounts; office profiles. |
| `AdminActivityLog.jsx` | Admin audit-log viewer. |
| `AdminProfilePage.jsx` | Admin profile and notification settings. |

Each page has a paired `.css` file of the same name.

---

## 4. Components (`src/components/`)

### Layout & Chrome

| File | Description |
|---|---|
| `DashboardLayout.jsx` | Outer chrome for organization pages (sidebar + content). |
| `Navbar.jsx` | Top navigation bar with notifications and profile menu. |
| `NotificationBell.jsx` | Notification dropdown subscribing to the user's notification stream. |
| `LoadingScreen.jsx` | Full-screen spinner. |
| `Icon.jsx` | Inline SVG icon registry. |
| `ConsentModal.jsx` | First-login privacy-consent modal. |
| `PrivacyPolicyContent.jsx` | Reusable rendering of the privacy policy text. |
| `MemorandumsSection.jsx` | Reusable Memorandums list block (used in HomePage). |

### Admin (`src/components/admin/`)

| File | Description |
|---|---|
| `AdminLayout.jsx` | Outer chrome for admin pages. |
| `AdminNavbar.jsx` | Admin top bar. |
| `AdminSidebar.jsx` | Admin left sidebar. |
| `StatsCard.jsx` | KPI tile used on the admin dashboard. |

### Documents (`src/components/documents/`)

| File | Description |
|---|---|
| `DocumentPreviewModal.jsx` | PDF preview modal with comment panel. |
| `PdfViewer.jsx` | `pdfjs-dist`-based viewer. |
| `PdfCommentLayer.jsx` | Overlay for inline comments on the PDF. |
| `CommentThreadPanel.jsx` | Thread UI for inline comments. |
| `RevisionUploadModal.jsx` | Upload modal for revising a returned document. |

### Proposals (`src/components/proposals/`)

| File | Description |
|---|---|
| `ProposalSubmission.jsx` | Submission form with required-file checklist driven by `proposalFlags`. |

### Equipment (`src/components/equipment/`)

| File | Description |
|---|---|
| `EquipmentItemPicker.jsx` | Selects items from inventory with quantity. |
| `EquipmentRequestForm.jsx` | Equipment borrowing form. |

### Chatbot (`src/components/Chatbot/`)

| File | Description |
|---|---|
| `Chatbot.jsx` | In-app help chatbot widget. |
| `MessageList.jsx` | Chat message renderer. |
| `intents.js` | Intent → response routing table. |
| `knowledge.js` | Static FAQ knowledge base. |

---

## 5. Services (`src/services/`)

All Firestore / Storage / API calls are encapsulated here — UI components never call the Firebase SDK directly.

| File | Description |
|---|---|
| `userService.js` | CRUD on `users`; `getUserById`, `createOrganizationAccount`, `updateLastLogin`, `recordPrivacyConsent`, `updateNotificationPreferences`, `updateUserPassword`, `updateUserEmail`, `getAllAdminUsers`, `getAllOrgUsers`, `deleteUserAccount`. |
| `organizationService.js` | `getOrganizationById`, list/update; counter-driven `organizationNumber` allocation. |
| `documentService.js` | Central document service — `submitActivityProposal`, `submitDocument`, `assignDocumentNumber`, `updateDocumentStatus`, `releaseDocument`, `searchDocuments`, `getDocumentStatusHistory`, pipeline operations (`endorseProposal`, `returnProposalFromISG`, `completeSASReview`, `releaseFromSASToISG`, `returnFromSAS`, `markAsDistributed`), `createOutgoingDocument`, `uploadRevision`, and the additional-document-request flow. |
| `storageService.js` | Firebase Storage upload/download/delete with structured paths. |
| `notificationService.js` | `createNotification`, `notifyOrganization`, `notifyAdmins`, `subscribeToNotifications`, read/unread; reminder scans (`checkAndFireReportReminders`); `NOTIFICATION_TYPES`, `NOTIFICATION_CATEGORIES`, `REMINDER_TIERS`. |
| `reportService.js` | Org-side reports CRUD; `markOverduePendingReports`. |
| `equipmentService.js` | Inventory CRUD. |
| `equipmentRequestService.js` | Equipment-request lifecycle; `checkAndFireEquipmentReturnReminders`. |
| `equipmentPdfService.js` | Generates equipment-borrowing PDF forms. |
| `reviewTokenService.js` | Issue / consume / regenerate review tokens; `checkAndFireReviewTokenWarnings`. |
| `officeService.js` | `officeProfiles` CRUD (VPAA, OP, FMS, Procurement). |
| `adminService.js` | Admin-specific aggregate queries. |
| `adminActivityLogService.js` | Writes / reads the admin audit log. |
| `authActivityLogService.js` | Writes / reads login/logout audit log. |
| `commentService.js` | Inline document-comment CRUD. |
| `otpService.js` | Generates OTPs and calls the Express `/api/send-otp` endpoint. |
| `emailService.js` | Convenience wrappers around `/api/send-credentials`, `/api/send-notification-email`, `/api/send-review-link`, `/api/send-additional-doc-request`. |
| `apiClient.js` | Thin `fetch()` wrapper that attaches the current user's ID token and uses `VITE_API_BASE_URL`. |

---

## 6. Utilities (`src/utils/`)

| File | Description |
|---|---|
| `useIdleTimeout.js` | Hook that signs the user out after N minutes of inactivity. |
| `formatters.js` | Date and number formatting helpers. |
| `passwordGenerator.js` | Generates secure temporary passwords for new accounts. |
| `passwordValidation.js` | Password-strength rules. |
| `proposalConstants.js` | Stage keys, requirement-key labels, status labels for activity proposals. |
| `reportConstants.js` | Report types, status labels, reminder tiers. |
| `commentScope.js` | Constants for comment-thread scope (proposal vs endorsement letter). |

---

## 7. Backend (`server.js`, `server/`, `scripts/`)

### `server.js` — Express 5 API

Bootstrap: loads env, initializes Firebase Admin SDK from `serviceAccountKey.json`, applies `helmet`, `cors` (with localhost-friendly allowlist), `express-rate-limit`. Middlewares: `requireAuth` and `requireAdmin` (verify Firebase ID tokens).

| Endpoint | Purpose |
|---|---|
| `POST /api/send-otp` | Send 6-digit OTP via Gmail SMTP. |
| `POST /api/check-lockout` | Lockout status for an email. |
| `POST /api/verify-otp` | Verify and consume an OTP. |
| `POST /api/reset-password` | OTP-gated password reset via Admin SDK. |
| `POST /api/admin-reset-password` | Admin-initiated reset for another user. |
| `POST /api/create-account` | Create user (Auth + Firestore) and email credentials. |
| `POST /api/send-credentials` | Resend credentials email. |
| `POST /api/send-additional-doc-request` | Email org for extra documents. |
| `POST /api/notify-admins` | Broadcast notification to all admins. |
| `POST /api/send-notification-email` | Email a notification to a specific user. |
| `POST /api/send-review-link` | Email a tokenized review link to VPAA/OP/FMS/Procurement. |
| `POST /api/admin/regenerate-review-token` | Mark old token expired and issue a new one. |
| `GET /api/review/:token` | Fetch document + signature status for a tokenized reviewer. |
| `GET /api/review/:token/signature-status` | Whether the document has been signature-stamped. |
| `POST /api/review/:token/signature` | Upload reviewer signature PNG (multer). |
| `POST /api/review/:token/decision` | Approve or return the document; advances the pipeline. |
| `GET /api/review/:token/comments` | List inline comments accessible to the reviewer. |
| `POST /api/review/:token/comments` | Post a comment. |
| `POST /api/review/:token/comments/:commentId/replies` | Reply to a comment. |
| `POST /api/review/:token/comments/:commentId/resolve` | Resolve a comment thread. |
| `DELETE /api/review/:token/comments/:commentId` | Delete a comment. |
| `GET /health` | Health check. |

### `server/pdfStamper.js`

Stamps a reviewer's signature PNG onto the Endorsement Letter PDF using `pdf-lib` and `@napi-rs/canvas`.

### Scripts (`scripts/`)

| File | Description |
|---|---|
| `seedTestData.js` | Seeds Firestore with sample organizations, users, and documents. Run with `npm run seed`. |
| `cleanupFirestore.js` | Cleanup utility (one-off). |
| `setCors.js` | Configures CORS on the Cloud Storage bucket (`npm run set-cors`). |

---

## 8. Documentation (`docs/`)

| File | Description |
|---|---|
| `erd-planning.md` | Canonical ERD specification with field-by-field schema, status flows, and design decisions. |
| `activity-proposal-flow.md` | Detailed activity-proposal pipeline specification. |
| `CS3B-SOFTENG PAPER.md` | Academic paper / report on the project. |
| `architecture-design.md` | High-level architecture (this manual's companion). |
| `system-algorithm.md` | Pseudocode for principal algorithms. |
| `entity-relationship-diagram.md` | ASCII ERD. |
| `dataflow-diagram.md` | Context + Level-1 DFDs. |
| `user-manual.md` | End-user instructions. |
| `program-listing.md` | This file. |

---

## 9. Build Outputs & Vendor (not part of the source listing)

| Path | Description |
|---|---|
| `dist/` | Vite production build output. |
| `node_modules/` | Installed dependencies. |
| `public/` | Static assets copied verbatim into the build. |
| `src/assets/` | Imported assets bundled by Vite. |

---

## 10. Lines-of-Code Snapshot (informational)

Approximate counts (the repository evolves quickly):

| Layer | Approx. files | Note |
|---|---|---|
| Pages | ~21 JSX + 21 CSS | One CSS per page |
| Components | ~20 JSX + CSS | Across `admin`, `documents`, `equipment`, `proposals`, `Chatbot`, and root |
| Services | 17 JS | All Firebase and Express access funnelled here |
| Utilities | 7 JS | Hooks and pure helpers |
| Backend | 1 Express server + 1 PDF helper + 3 scripts | `server.js` is large; helper logic factored out into `server/` |
| Config / Rules | 4 (`firebase.json`, `firestore.rules`, `firestore.indexes.json`, `storage.rules`) | Deployed via `npm run deploy:rules` |
