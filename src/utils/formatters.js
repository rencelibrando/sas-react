const toDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value === "number" || typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
};

export const formatDate = (timestamp) => {
  const d = toDate(timestamp);
  if (!d) return "N/A";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
};

export const formatDateTime = (timestamp) => {
  const d = toDate(timestamp);
  if (!d) return "N/A";
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
};

export const getStatusBadgeClass = (status) => {
  const statusClasses = {
    pending: "status-badge-pending",
    under_review: "status-badge-review",
    approved: "status-badge-approved",
    returned: "status-badge-returned",
    rejected: "status-badge-rejected",
    released: "status-badge-released"
  };
  return statusClasses[status] || "status-badge-default";
};

export const getStatusLabel = (status) => {
  const statusLabels = {
    pending: "Pending",
    under_review: "Under Review",
    approved: "Approved",
    returned: "Returned",
    rejected: "Rejected",
    released: "Released"
  };
  return statusLabels[status] || status;
};

const STAGE_OFFICE = {
  isg_endorsement: "ISG",
  sas_review: "SAS",
  vpaa_review: "VPAA",
  op_approval: "OP",
  fms_review: "FMS",
  procurement_review: "Procurement",
  sas_release: "SAS",
  isg_distribution: "ISG"
};

const STAGE_AWAITING_LABEL = {
  isg_endorsement: "Awaiting ISG endorsement",
  sas_review: "Under SAS review",
  vpaa_review: "Awaiting VPAA review",
  op_approval: "Awaiting OP approval",
  fms_review: "Awaiting FMS review",
  procurement_review: "Awaiting Procurement review",
  sas_release: "Awaiting SAS release",
  isg_distribution: "Awaiting ISG distribution"
};

export const getPipelineStageLabel = (stageKey) =>
  STAGE_AWAITING_LABEL[stageKey] || "In progress";

const getActiveStageEntry = (proposal) => {
  const currentStage = proposal?.pipeline?.currentStage;
  if (!currentStage) return null;
  const stages = proposal?.pipeline?.stages || [];
  for (let i = stages.length - 1; i >= 0; i--) {
    if (stages[i].stage === currentStage) return stages[i];
  }
  return null;
};

const findLastReturnedStage = (proposal) => {
  const stages = proposal?.pipeline?.stages || [];
  for (let i = stages.length - 1; i >= 0; i--) {
    if (stages[i].action === "returned") return stages[i];
  }
  return null;
};

// Verb shown when a stage has been completed (passed on to the next office).
// External approvals record action "approve"; SAS/ISG hand-offs record "forwarded".
const COMPLETED_ACTION_VERB = {
  approve: "Approved",
  approved: "Approved",
  forwarded: "Reviewed",
  released: "Released",
  distributed: "Distributed"
};

const findLastCompletedApproval = (proposal) => {
  const stages = proposal?.pipeline?.stages || [];
  for (let i = stages.length - 1; i >= 0; i--) {
    const entry = stages[i];
    if (entry?.completedAt && COMPLETED_ACTION_VERB[entry.action]) return entry;
  }
  return null;
};

export const getProposalDisplayStatus = (proposal) => {
  if (!proposal) return { label: "Pending", badgeClass: "status-badge-pending" };

  if (proposal.status === "returned") {
    const returnedStage = findLastReturnedStage(proposal);
    const office = returnedStage ? STAGE_OFFICE[returnedStage.stage] : null;
    return {
      label: office ? `Returned by ${office}` : "Returned",
      badgeClass: "status-badge-returned"
    };
  }

  if (proposal.status === "approved") {
    return { label: "Approved", badgeClass: "status-badge-approved" };
  }

  if (proposal.status === "rejected") {
    return { label: "Rejected", badgeClass: "status-badge-rejected" };
  }

  const currentStage = proposal?.pipeline?.currentStage;
  if (currentStage) {
    const activeEntry = getActiveStageEntry(proposal);
    const office = STAGE_OFFICE[currentStage];
    // The office now holding the document has opened it.
    if (activeEntry?.firstViewedAt && office) {
      return {
        label: `Opened by ${office}`,
        badgeClass: "status-badge-review"
      };
    }
    // Not opened yet at the current stage — surface the most recent approval so
    // the badge reflects progress instead of falling back to a "pending" look
    // once VPAA/OP/etc. have already signed off.
    const lastApproval = findLastCompletedApproval(proposal);
    if (lastApproval) {
      const approvedOffice = STAGE_OFFICE[lastApproval.stage];
      if (approvedOffice) {
        return {
          label: `${COMPLETED_ACTION_VERB[lastApproval.action]} by ${approvedOffice}`,
          badgeClass: "status-badge-approved"
        };
      }
    }
    // Genuinely fresh — sitting at the first stage, not yet opened.
    return {
      label: getPipelineStageLabel(currentStage),
      badgeClass: "status-badge-pending"
    };
  }

  return {
    label: getStatusLabel(proposal.status || "pending"),
    badgeClass: getStatusBadgeClass(proposal.status || "pending")
  };
};

export const getStageOffice = (stageKey) => STAGE_OFFICE[stageKey] || null;
