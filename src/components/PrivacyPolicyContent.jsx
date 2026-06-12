/**
 * Reusable privacy-policy body. Rendered standalone on PrivacyPolicyPage and
 * inside the first-login ConsentModal. Keep it plain-text-ish — institutional
 * audiences read this on phones, in browsers, and inside the consent modal,
 * so heavy styling adds nothing.
 */
const PrivacyPolicyContent = () => (
  <div className="privacy-policy-body">
    <p className="privacy-policy-effective">
      Effective date: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
    </p>

    <p>
      The EARIST Student Affairs System (SAS) Portal is operated by the
      Student Affairs Services office of the Eulogio "Amang" Rodriguez
      Institute of Science and Technology. This notice explains what
      personal information we collect when you use the portal, why we use
      it, how long we keep it, and what rights you have under the
      Philippines Data Privacy Act of 2012 (RA 10173).
    </p>

    <h3>1. What we collect</h3>
    <ul>
      <li><strong>Account information:</strong> full name, EARIST email, role, the organization you represent, position/title.</li>
      <li><strong>Submitted documents:</strong> activity proposals, supporting attachments, post-activity reports, equipment borrowing forms, memorandums.</li>
      <li><strong>Activity and audit data:</strong> sign-in events (success/failure, OTP), administrator actions, status-history entries on the documents you submit.</li>
      <li><strong>Technical data:</strong> browser identifier (user-agent) recorded with authentication events.</li>
    </ul>

    <h3>2. Why we collect it</h3>
    <ul>
      <li>To verify your identity and authorize you to act on behalf of your organization.</li>
      <li>To route activity proposals through the required SAS, VPAA, OP, FMS, and Procurement review stages.</li>
      <li>To track equipment loans and post-activity reporting compliance.</li>
      <li>To detect and respond to misuse of the portal (failed logins, lock-outs, damage reports).</li>
    </ul>

    <h3>3. Who can see your data</h3>
    <p>
      Your submitted documents are visible to: members of your own
      organization, the SAS office (administrators), and any reviewing
      office to which your proposal has been routed. Released
      memorandums are visible to all signed-in users. Tokenized review
      links sent to external offices grant access only to the document
      under review and only until the link is used or expires.
    </p>

    <h3>4. How long we keep it</h3>
    <p>
      Account records, submitted documents, and audit logs are retained
      while your account is active and for the duration required by EARIST
      academic-records policy. Authentication-event logs are retained for
      operational and security review purposes.
    </p>

    <h3>5. How we protect it</h3>
    <ul>
      <li>Access is restricted by role and organization through Firebase
        Authentication and database access rules.</li>
      <li>One-time passwords are required to sign in and to reset your
        password, and to confirm a change to your registered email address.</li>
      <li>Administrator actions (account changes, document state changes)
        are recorded in an immutable audit log.</li>
      <li>Sessions automatically end after 30 minutes of inactivity.</li>
    </ul>

    <h3>6. Your rights</h3>
    <p>
      You may at any time request access to, correction of, or deletion of
      the personal information we hold about you, withdraw consent for
      future processing, or file a complaint with the National Privacy
      Commission (privacy.gov.ph).
    </p>

    <h3>7. Contact</h3>
    <p>
      For data-privacy concerns, contact the EARIST Student Affairs office
      directly or email{" "}
      <a href="mailto:sas.webapp.portal@gmail.com">sas.webapp.portal@gmail.com</a>.
    </p>
  </div>
);

export default PrivacyPolicyContent;
