# System Algorithm — EARIST SAS Portal

This document specifies the principal algorithms that drive the EARIST SAS Portal. Each section presents one algorithm in pseudocode, followed by the inputs, outputs, and key invariants.

---

## 1. Login with Email OTP (2-step authentication)

**Inputs:** `email`, `password`
**Outputs:** authenticated Firebase session, or rejection.

```
ALGORITHM Login(email, password)
1.  isLocked ← POST /api/check-lockout {email}
2.  IF isLocked THEN abort("Account temporarily locked")
3.  cred ← signInWithEmailAndPassword(auth, email, password)
        // Firebase Auth verifies password; failure increments lockout counter
4.  IF authentication fails THEN
        record failed-attempt; abort("Invalid credentials")
5.  signOut(auth)                                  // step-up; require OTP next
6.  otp ← generate6DigitCode()
7.  store {email, otp, createdAt: now, expiresAt: now+10m, verified:false}
        in collection `otps` (document id = email)
8.  POST /api/send-otp {email, otp}                // sends via Gmail SMTP
9.  sessionStorage["pendingAuth"] ← {email, password}   // resume after OTP
10. user enters OTP in UI
11. POST /api/verify-otp {email, otp}
       a. fetch doc otps/{email}
       b. IF missing OR expired OR otp mismatch THEN reject
       c. ELSE delete doc; return success
12. ON success:
       signInWithEmailAndPassword(auth, email, password)  // real session
       updateLastLogin(user.uid)
       clear sessionStorage["pendingAuth"]
13. App.jsx onAuthStateChanged fires; loads `users/{uid}`;
       sets role = "Admin" | "Organization"
14. IF role = "Admin" AND first-auth-this-session AND not credential-check THEN
       markOverduePendingReports()           // non-blocking
       checkAndFireReportReminders()
       checkAndFireReviewTokenWarnings()
       checkAndFireEquipmentReturnReminders()
15. IF user has no privacy-consent timestamp THEN show ConsentModal
16. enable 30-minute idle timeout
```

**Invariants:**
- A user is only fully signed in *after* OTP verification.
- One active OTP per email at a time (document key = email).
- OTP expires after 10 minutes; expired records linger until overwritten.

---

## 2. Generating a Unique Document Number

Every incoming document and outgoing document gets a sequence number assigned inside a Firestore transaction so concurrent submissions never collide.

```
ALGORITHM GenerateDocumentNumber(direction, documentType, organizationId)

IF direction = "incoming" THEN
    key ← f"{organizationId}_{currentYear}"
    counterPath ← documentCounters/{key}

ELSE IF documentType = "endorsement_letter" THEN
    key ← f"endorsement_{organizationId}_{currentYear}"
    counterPath ← documentCounters/{key}

ELSE IF documentType = "Memorandum" THEN
    key ← f"outgoing_{currentYear}"
    counterPath ← systemCounters/{key}

TRANSACTION:
    counter ← read(counterPath) or {count: 0, year: currentYear}
    counter.count ← counter.count + 1
    write(counterPath, counter)

    IF documentType = "Memorandum" THEN
        return f"{currentYear}-{pad(counter.count, 3)}"             // 2025-012

    org ← read(organizations/{organizationId})

    IF documentType = "endorsement_letter" THEN
        return f"{org.organizationNumber}{YY}_{pad(counter.count,3)}"  // 00225_007

    return f"{org.organizationNumber}-{currentYear}-{pad(counter.count,3)}"
                                                                       // 002-2025-007
```

**Invariants:**
- Transactions guarantee uniqueness even under concurrent submits.
- `organizations.organizationNumber` itself is allocated from `systemCounters/organizationNumber` (same transactional pattern).
- Counters are *per-year*; a new year starts a new sequence.

---

## 3. Submitting an Activity Proposal

```
ALGORITHM SubmitActivityProposal(org, files, flags, title, description)
1.  Validate flags: requireBool(hasSpeakers), requireBool(collectsFees)
2.  requiredKeys ← {request_letter_isg, request_letter_president,
                    activity_form, budgetary_allocation, program_flow}
    IF flags.hasSpeakers  THEN add speaker_profile
    IF flags.collectsFees THEN add resolution
3.  FOR each requirementKey in requiredKeys:
        require files[requirementKey] is present
        upload to Storage at documents/{TBD}/{requirementKey}/{filename}
4.  TRANSACTION:
        docId ← create empty document in `documents`
        documentNumber ← GenerateDocumentNumber("incoming", "activity_proposal", org.id)
        write documents/{docId} ←
            { documentId, documentNumber,
              direction: "incoming",
              documentType: "activity_proposal",
              organizationId: org.id,
              submittedBy: user.uid, createdBy: user.uid,
              status: "in_pipeline",
              proposalFlags: flags,
              files: [...uploaded file refs with requirementKey],
              revisionCount: 0,
              pipeline: {
                currentStage: org.type = "ISG" ? "sas_review" : "isg_endorsement",
                stages: [ { stage: <currentStage>, startedAt: now } ]
              },
              dateSubmitted: now,
              lastUpdated: now }
        append documentStatusHistory(docId, "pending"→"in_pipeline")
5.  notifyAdmins(...)   // and ISG via notifyOrganization for org-submitted
```

**Invariants:**
- Files are uploaded *before* the document record is committed (no orphan rows).
- The required-files set is evaluated at the `isg_endorsement` completeness gate; an incomplete document cannot advance.

---

## 4. Activity-Proposal Pipeline State Machine

```
ALGORITHM AdvancePipeline(doc, actorUserId, action, remarks, payload)

requireRoleForStage(actorUserId, doc.pipeline.currentStage)

SWITCH (doc.pipeline.currentStage, action):

  ("isg_endorsement", "endorse"):
      IF NOT completenessGate(doc) THEN reject("missing required files")
      closeStage("isg_endorsement", action="endorsed", actor=actorUserId)
      openStage("sas_review")

  ("isg_endorsement", "return"):
      closeStage("isg_endorsement", action="returned", remarks)
      status ← "returned"; currentStage ← null

  ("sas_review", "complete"):
      uploadEndorsementLetterPDF(payload.signedFile)
      letterId ← createOutgoingDocument({
          documentType: "endorsement_letter",
          documentNumber: GenerateDocumentNumber("outgoing",
                                                 "endorsement_letter",
                                                 doc.organizationId),
          ...
      })
      closeStage("sas_review", action="approved",
                 generatedDocId=letterId)
      openStage("vpaa_review")
      token ← issueReviewToken(doc.documentId, "vpaa_review", VPAA.email)
      stages[last].token ← token
      POST /api/send-review-link {token, recipient: VPAA.email}

  ("sas_review", "return"):
      closeStage("sas_review", action="returned", remarks)
      status ← "returned"; currentStage ← null

  ("vpaa_review" | "op_approval" | "fms_review" | "procurement_review",
   "approve"):
      consumeReviewToken(stage.token, action="approved")
      closeStage(currentStage, action="approved",
                 completedBy=stage.sentToEmail)
      openStage(nextStage(doc.submitterRole, currentStage))
      IF nextStage requires email THEN
          issueAndSendToken(...)

  (anyTokenStage, "return"):
      consumeReviewToken(stage.token, action="returned", remarks)
      closeStage(currentStage, action="returned", remarks)
      currentStage ← "sas_review"       // regress; SAS handles
      openStage("sas_review")            // APPEND new entry; history preserved

  ("sas_release", "release"):
      closeStage("sas_release", action="approved")
      IF submitterRole = "ISG" THEN
          status ← "approved"; currentStage ← null
      ELSE
          openStage("isg_distribution")
          notifyOrganization(ISG_org, "distribute")

  ("isg_distribution", "distribute"):
      closeStage("isg_distribution", action="approved")
      status ← "released"; currentStage ← null
      notifyOrganization(doc.organizationId, "approved")

writeDocumentStatusHistory(doc, previousStatus, newStatus, actorUserId, remarks)
```

**Next-stage table (`nextStage`):**

| Current | Submitter = ISG | Submitter = student org |
|---|---|---|
| `vpaa_review` | `op_approval` | `op_approval` |
| `op_approval` | `fms_review` | `sas_release` |
| `fms_review` | `procurement_review` | — |
| `procurement_review` | `sas_release` | — |
| `sas_release` | (terminal) | `isg_distribution` |

**Invariants:**
- `pipeline.stages` is **append-only**. A return creates a new entry for the restarted stage; the original is preserved with `action: "returned"`.
- A stage can be advanced only by its registered actor (role or token).
- Tokens are single-use; consumed tokens cannot move the pipeline.

---

## 5. Tokenized External Review (VPAA / OP / FMS / Procurement)

```
ALGORITHM IssueReviewToken(documentId, stage, recipientEmail)
1.  token ← cryptoRandomBase64Url(32)
2.  TRANSACTION:
        write reviewTokens/{auto} ←
            { token, documentId, stage,
              officeId: officeForStage(stage),
              sentToEmail: recipientEmail,
              sentAt: now,
              expiresAt: now + 7 days,
              consumed: false }
3.  update document.pipeline.stages[last] with
        { token, tokenSentAt: now, tokenExpiresAt: now+7d }
4.  return token


ALGORITHM HandleReviewerAction(tokenFromURL, decision, remarks, signaturePNG)
1.  rec ← lookup reviewTokens where token = tokenFromURL
2.  IF rec missing                  → 404
3.  IF rec.consumed                 → 409 "Already acted"
4.  IF rec.expiresAt < now          → 410 "Expired" (Admin can resend)
5.  doc ← documents/{rec.documentId}
6.  IF doc.pipeline.currentStage ≠ rec.stage → 409 "Stale token"
7.  IF decision = "approve" THEN
        IF signaturePNG present THEN
            stampSignature(endorsementLetter.pdf, signaturePNG)
        consumeToken(rec, "approved")
        AdvancePipeline(doc, rec.sentToEmail, "approve")
   ELSE  // return
        consumeToken(rec, "returned", remarks)
        AdvancePipeline(doc, rec.sentToEmail, "return", remarks)
8.  redirect/render confirmation page
```

**Token resend** (Admin only): mark old token `consumed=true, action="expired"`, then `IssueReviewToken` again.

---

## 6. Returned-Document Revision

```
ALGORITHM ReviseAndResubmit(doc, replacementFilesByKey, newRemarks)
PRECONDITION: doc.status = "returned"
1.  FOR each (key, file) in replacementFilesByKey:
        upload to Storage at documents/{doc.id}/{key}/{filename}
        replace the entry in doc.files where requirementKey = key
2.  doc.revisionCount ← doc.revisionCount + 1
3.  doc.dateLastRevised ← now
4.  IF documentType = "activity_proposal" THEN
        doc.status         ← "in_pipeline"
        doc.pipeline.currentStage ← regressionTarget(doc)
              // typically "isg_endorsement" or "sas_review"
        append a new stages[] entry for that stage
   ELSE
        doc.status ← "pending"
5.  writeDocumentStatusHistory(...)
6.  notifyAdmins / notifyOrganization(ISG) as appropriate
```

---

## 7. Memorandum Publication (Broadcast Outgoing)

```
ALGORITHM PublishMemorandum(adminUserId, title, body, attachment, mode)
1.  upload attachment (optional) to Storage
2.  TRANSACTION:
        docId ← create documents document
        number ← GenerateDocumentNumber("outgoing", "Memorandum", null)
                  // uses systemCounters/outgoing_{year}
        write documents/{docId} ←
          { documentType: "Memorandum",
            direction: "outgoing",
            documentNumber: number,
            organizationId: null,         // broadcast
            createdBy: adminUserId,
            status: mode = "draft" ? "draft" : "released",
            files: [...],
            dateReleased: mode="draft" ? null : now,
            lastUpdated: now }
3.  IF status = "released" THEN
        notifyAllOrganizations(...)
```

A draft Memorandum may later be edited and released; releasing transitions `draft → released` and writes `dateReleased`.

---

## 8. Background Reminder Scans

Triggered the first time an Admin authenticates in a session (`App.jsx`):

```
ALGORITHM AdminBackgroundScans()
1.  markOverduePendingReports()
        FOR each report with status = "pending" AND deadline < now:
            set status = "overdue"; write notification
2.  checkAndFireReportReminders()
        FOR each tier in REMINDER_TIERS (e.g., -7d, -3d, -1d):
            FOR each report whose deadline matches:
                if reminder not yet fired → notify and stamp `remindedAt[tier]`
3.  checkAndFireReviewTokenWarnings()
        FOR each reviewTokens record where consumed=false:
            IF expiresAt-now in {2d, 1d} AND warning not stamped:
                notify Admin "Token approaching expiry"
4.  checkAndFireEquipmentReturnReminders()
        FOR each active equipment request past expectedReturn date:
            notify borrower and Admin
```

Scans are non-blocking; failures are logged.

---

## 9. Role-Based Routing (Client)

```
ALGORITHM RouteUser(user, userDoc, orgDoc, currentPage, adminPage)
1.  IF window.pathname = "/review" THEN return <ReviewPage/>
2.  IF loading OR checkingRole THEN return <LoadingScreen/>
3.  IF NOT user OR otpInProgress THEN return <AuthPage/>
4.  IF userDoc.role = "Admin" THEN
        SWITCH adminPage IN { dashboard, activity-proposals, account-management,
                              equipment-inventory, equipment-requests, profile,
                              activity-log, memorandums, reports, privacy }
        return matching admin page
5.  IF NOT hasOrgInfo THEN return <AuthPage/>   // setup incomplete
6.  IF orgDoc.type = "ISG" AND currentPage = "home" THEN
        return <ISGEndorsementPage/>            // ISG default landing
7.  SWITCH currentPage IN { activity-proposals, equipment-borrowing,
                            isg-endorsement, isg-distribution, memorandums,
                            reports, profile, privacy, home }
    return matching page
```

Navigation is fired with `window.dispatchEvent(new CustomEvent('pageNavigate' | 'adminNavigate', { detail: 'pageKey' }))`.

---

## 10. Idle-Timeout & Privacy-Consent Gates

```
HOOK useIdleTimeout(minutes, callback)
    timer ← null
    onActivity(): reset(timer, minutes)
    on(timer expired): callback()  // App: setSession idleSignedOut; signOut

ALGORITHM PrivacyGate(userDoc)
    IF userDoc.privacyConsentAt is null THEN
        render <ConsentModal>
        on Accept: recordPrivacyConsent()   // writes timestamp
        on Decline: signOut(auth)
```

---

## Algorithm Index

| # | Algorithm | Where implemented |
|---|---|---|
| 1 | Login with OTP | `AuthPage.jsx`, `server.js`, `otpService.js` |
| 2 | Document numbering | `documentService.js` (`submitDocument`, `submitActivityProposal`, `completeSASReview`, `createOutgoingDocument`) |
| 3 | Proposal submission | `documentService.js#submitActivityProposal`, `ActivityProposalsPage.jsx` |
| 4 | Pipeline FSM | `documentService.js` (`endorseProposal`, `completeSASReview`, `releaseFromSASToISG`, `returnFromSAS`, `markAsDistributed`, …) + `server.js /api/review/:token/decision` |
| 5 | Tokenized review | `reviewTokenService.js`, `server.js /api/review/*` |
| 6 | Revision | `documentService.js#uploadRevision` |
| 7 | Memorandum publish | `documentService.js#createOutgoingDocument`, `AdminMemorandums.jsx` |
| 8 | Background scans | `notificationService.js`, `reportService.js`, `reviewTokenService.js`, `equipmentRequestService.js` |
| 9 | Routing | `App.jsx` |
| 10 | Idle / consent | `useIdleTimeout.js`, `ConsentModal.jsx`, `userService.js#recordPrivacyConsent` |
