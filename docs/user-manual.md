# User Manual — EARIST SAS Portal

This manual covers everyday use of the EARIST Student Affairs System (SAS) Portal. Three audiences are addressed:

1. **Student Organization Officers** (CSG, AO, ISG)
2. **SAS Administrators**
3. **External Reviewers** (VPAA, OP, FMS, Procurement) — who act only through tokenized email links

> Throughout this manual, "the Portal" refers to the SAS web application. Open it in any modern browser (Chrome, Edge, Firefox, Safari).

---

## 1. Getting Started

### 1.1 System Requirements

| Item | Recommended |
|---|---|
| Browser | Chrome / Edge / Firefox / Safari, latest version |
| Internet | Stable broadband |
| Screen | 1280 × 720 or larger |
| Email | A working address you check daily — used for OTP and notifications |

### 1.2 Receiving Your Account

Organization accounts are created by SAS staff. You will receive an email containing:
- Your portal URL.
- Your username (an email address).
- A temporary password.

On first login the system will prompt you to:
1. Change your temporary password.
2. Accept the privacy notice.
3. Confirm your officer information (full name, role within the organization).

### 1.3 Logging In

1. Open the portal URL.
2. Enter your email and password and press **Sign In**.
3. Check your inbox for a 6-digit code (subject begins with "EARIST SAS").
4. Enter the code on the OTP screen and press **Verify**.
5. You are now signed in.

> The code expires after 10 minutes. If you do not receive it, check your spam folder or click **Resend OTP**.

### 1.4 Logging Out & Idle Timeout

- Click your profile icon (top right) → **Sign Out**.
- The portal will automatically sign you out after **30 minutes** of inactivity for your security.

### 1.5 Forgot Password

1. On the sign-in screen, click **Forgot password?**
2. Enter your registered email.
3. You will receive an OTP. Enter it, then set a new password.
4. Sign in with the new password.

---

## 2. Student Organization Officer Guide

### 2.1 Home Page

After login you land on the **Home** page. It shows:
- The latest released Memorandums from SAS.
- Quick links: **Activity Proposals**, **Equipment Borrowing**, **Reports**, **Profile**.

### 2.2 Submitting an Activity Proposal

1. From the sidebar, click **Activity Proposals**, then **New Proposal**.
2. Fill in the form:
   - Title
   - Description
   - **Has Speakers?** (Yes/No)
   - **Will collect fees?** (Yes/No)
3. Upload all required files:

| Always Required |
|---|
| Request Letter to ISG President |
| Request Letter to Institute President |
| Student Activity Proposal Form (EARIST-QSF-SAS-006) |
| Budgetary Allocation and Venue Reservation |
| Program / Event Flow |

| Conditionally Required |
|---|
| Profile of Speakers/Facilitators — if **Has Speakers** = Yes |
| Resolution on Fee Collection + meeting minutes — if **Will collect fees** = Yes |

4. Click **Submit**.

The portal stamps your proposal with a document number in the format `{orgNumber}-{year}-{seq}` (e.g., `002-2025-007`).

### 2.3 Tracking a Proposal

On the **Activity Proposals** page, each row shows the current pipeline stage:

| Stage label | What it means |
|---|---|
| ISG Endorsement | ISG is checking completeness |
| SAS Review | SAS is reviewing and preparing the endorsement letter |
| VPAA Review | Awaiting VPAA's approval (via email link) |
| OP Approval | Awaiting Office of the President |
| SAS Release | Final release by SAS |
| ISG Distribution | ISG is distributing the approved documents |
| Released / Approved | Workflow complete |

If your proposal is **Returned**, you will be notified with the reviewer's remarks.

### 2.4 Revising a Returned Proposal

1. Open the returned proposal.
2. Read the remarks shown at the top.
3. Click **Revise**.
4. Upload replacement files for the affected requirement(s).
5. Click **Resubmit**.

The pipeline restarts at the stage where it was returned. Your revision count increments by one. **Old pipeline history is preserved.**

### 2.5 Submitting Reports

From **Reports** → **New Report**:
- Select report type (Financial, Accomplishment, Fund-Utilization).
- Attach the file.
- Click **Submit**.

Reports go through a simpler flow: `pending → under_review → approved → released` (or `returned → pending`).

### 2.6 Borrowing Equipment

1. Click **Equipment Borrowing**.
2. Browse the inventory and add items to your request.
3. Provide expected pickup and return dates.
4. Submit. SAS Admin approves, releases, and (later) marks the items returned.

### 2.7 Profile Page

Use **Profile** to:
- Change your password.
- Update officer handover info (when a new officer takes over).
- Manage notification preferences.

> **Officer handover:** When officers change, SAS Admin updates `fullName`, `userRole`, and `email` in place on your organization's account.

---

## 3. ISG Officer Guide

ISG has the regular Student Organization features **plus** two pipeline pages.

### 3.1 ISG Default Landing — Endorsement Page

After login, ISG lands directly on **ISG Endorsement**. Each row is an activity proposal from another student organization awaiting ISG's completeness check.

To endorse:
1. Open the proposal.
2. Verify that every required file is attached and addresses the activity properly.
3. Click **Endorse → Forward to SAS**.
   - *Optional:* add remarks.

To return:
1. Click **Return**.
2. Enter remarks explaining what's missing or incorrect.
3. Confirm.

The system **blocks** endorsement if a required file (per `proposalFlags`) is missing.

### 3.2 ISG Distribution Page

At the end of the pipeline, SAS releases documents back to ISG for distribution.

1. Click **ISG Distribution**.
2. Open a released proposal.
3. After delivering the approved copy to the submitting organization, click **Mark Distributed**.
4. The submitter is notified that the proposal is fully approved.

### 3.3 Submitting ISG's Own Activity Proposals

ISG-submitted proposals **skip** the ISG endorsement and ISG distribution stages and instead route through FMS and Procurement after the OP approves. Submit them the same way as any student organization on the **Activity Proposals** page; the system handles the pipeline difference automatically.

---

## 4. SAS Administrator Guide

The admin sidebar shows:

| Section | Purpose |
|---|---|
| Dashboard | Overall counts and quick links |
| Activity Proposals | Full pipeline view for all proposals |
| Memorandums | Draft / publish broadcast Memorandums |
| Reports | Review organization reports |
| Equipment Inventory | Manage borrowable items |
| Equipment Requests | Approve / release / return equipment |
| Account Management | Create and update organization and office accounts |
| Activity Log | Audit log of admin actions |
| Profile | Admin profile and notifications |

### 4.1 Reviewing an Activity Proposal (SAS Review stage)

1. Open **Activity Proposals**. The "SAS Review" tab lists items awaiting your action.
2. Open a proposal. Review all attached files and ISG's remarks.
3. Click **Generate Endorsement Letter**.
   - The system auto-fills a draft endorsement letter PDF.
   - Download it, sign it offline, scan or stamp it, and re-upload.
4. Confirm the OFFICE PROFILES → **VPAA** email address.
5. Click **Send to VPAA**. The system:
   - Allocates an Endorsement Letter number (`{orgNumber}{YY}_{seq}`).
   - Creates the outgoing document.
   - Issues a one-shot review token.
   - Emails the link to VPAA.

> If you need to return instead of approve, click **Return** and enter remarks. The proposal goes back to the submitting organization (no terminal "rejected" state — your remarks should clearly say whether revision is invited or the request is denied).

### 4.2 Monitoring External Reviews

The proposal detail page shows, for each tokenized stage:

- When the link was sent.
- The recipient email.
- Whether the link has been clicked / consumed.
- Days remaining until expiry (default 7 days).
- A **Resend** button.

When a token approaches expiry, you'll receive an in-app notification on your next login.

### 4.3 Resending an Expired Token

1. Open the proposal.
2. In the stage card (VPAA, OP, FMS, or Procurement), click **Resend**.
3. The old token is invalidated; a new token is generated and emailed.

### 4.4 Final Release & Distribution

When all external reviews approve, the pipeline lands on **SAS Release**.

1. Open the proposal.
2. Verify the stamped/signed letter looks correct.
3. Click **Release**.
4. For org-submitted proposals, the proposal moves to **ISG Distribution**. ISG officers then mark it distributed.
5. For ISG-submitted proposals, the proposal is now **Approved** — no distribution step.

### 4.5 Publishing a Memorandum

1. Click **Memorandums** → **New Memorandum**.
2. Fill in title and body. Attach a PDF if applicable.
3. Choose:
   - **Save as Draft** — number reserved later, no broadcast yet.
   - **Publish (Release)** — allocates a number (`{year}-{seq}`) and notifies all organizations.

You can edit a draft and release it later.

### 4.6 Account Management

- **Create Organization Account**: Provide organization name, type (ISG/CSG/AO), and the new officer's email and full name. The system creates the Firestore user, generates a temporary password, and emails the credentials.
- **Update Officer**: For handover, update the existing user document in place — do not create a new user.
- **Create Admin Account**: Same flow with `role = "Admin"`.
- **Office Profiles** (VPAA / OP / FMS / Procurement): Keep these email addresses current — review links go here.
- **Soft Delete**: Marks the user inactive but keeps historical references intact.

### 4.7 Equipment Requests

1. Click **Equipment Requests**. New requests appear at the top.
2. Approve → release → mark returned, in that order.
3. The borrowing form is generated as a stamped PDF.

### 4.8 Reports & Activity Log

- **Reports**: Filter pending, approved, overdue, or returned. Open to download and decide.
- **Activity Log**: Read-only audit of admin actions (account changes, status transitions, etc.).

---

## 5. External Reviewer Guide (VPAA / OP / FMS / Procurement)

External reviewers do **not** log in. They act through tokenized links emailed to them by SAS Admin.

### 5.1 Receiving the Review Email

You will receive an email from EARIST SAS containing:
- The proposal title and submitting organization.
- A **Review Document** link of the form `https://<portal>/review?token=...`.

### 5.2 Reviewing

1. Click the link. You will see a read-only review page showing:
   - The activity proposal and all attached files.
   - The SAS-generated Endorsement Letter.
2. Choose **Approve** or **Return**.
3. If returning, fill in remarks explaining the reason.
4. (VPAA/OP) Upload your signature image (PNG with transparent background works best). The system stamps it onto the Endorsement Letter PDF.
5. Click **Submit**.

Once submitted, the link is consumed and can no longer be used. If you need a fresh link, contact SAS Admin to resend.

### 5.3 If Your Link Expired

A red banner reads "This link has expired." Email or message SAS Admin to request a new link.

### 5.4 Security

The link is effectively a single-use credential. Do not forward it.

---

## 6. Notifications & Reminders

- **In-app**: The bell icon at the top of the page lists unread notifications. Click an item to jump to the relevant document.
- **Email reminders** are sent automatically for:
  - Report deadlines approaching (7, 3, 1 days out).
  - Review tokens nearing expiry.
  - Overdue equipment returns.

### Notification Preferences

In **Profile** → **Notification Preferences**, toggle which categories you want to receive. Critical security notifications (e.g., password change) cannot be disabled.

---

## 7. Troubleshooting

| Symptom | Try |
|---|---|
| "Account temporarily locked" | Too many failed logins. Wait 15 minutes or contact SAS Admin. |
| OTP did not arrive | Check spam folder. Click **Resend OTP**. Verify your registered email. |
| "OTP expired" | Codes last 10 minutes. Request a new one. |
| "Required file missing" on submit | Confirm all checkmarks are green; conditional files appear only when the corresponding flag is "Yes". |
| Proposal stuck in VPAA Review for many days | SAS Admin can resend the token from the proposal detail page. |
| Cannot find an old activity log entry | Filter by date or organization on the Activity Log page; logs are append-only and never deleted. |
| Forgot password and OTP also not arriving | Contact SAS Admin to trigger an admin-initiated reset. |

---

## 8. Glossary

| Term | Meaning |
|---|---|
| **SAS** | Office of Student Affairs |
| **ISG** | Institute Student Government |
| **CSG** | College Student Government |
| **AO** | Accredited Organization |
| **VPAA** | Vice President for Academic Affairs |
| **OP** | Office of the President |
| **FMS** | Financial Management Services |
| **Endorsement Letter** | Outgoing document generated by SAS as part of the activity-proposal pipeline |
| **Memorandum** | Broadcast outgoing document, sent to all organizations |
| **Tokenized Review** | One-shot email link used by external offices to act on a document |
| **Pipeline Stage** | Named step in the activity-proposal workflow (e.g., `vpaa_review`) |
| **Completeness Gate** | The check at the ISG stage that all required files are attached |

---

## 9. Support

For account issues, lost passwords, or questions about a specific document, contact the SAS office. For technical issues with the portal, file a ticket with your IT support team and include:
- The URL of the page where the issue occurred.
- A screenshot of any error message.
- The approximate time the issue happened (for activity-log lookup).
