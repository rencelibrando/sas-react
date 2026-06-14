export const REQUIREMENT_KEYS = [
  "request_letter_isg",
  "request_letter_president",
  "activity_form",
  "budgetary_allocation",
  "program_flow",
  "speaker_profile",
  "resolution",
  "fund_utilization",
];

export const REQUIREMENT_LABELS = {
  request_letter_isg: "Request Letter to ISG President",
  request_letter_president: "Request Letter to Institute President",
  activity_form: "Student Activity Proposal Form (EARIST-QSF-SAS-006)",
  budgetary_allocation: "Budgetary Allocation and Venue Reservation",
  program_flow: "Program / Event Flow",
  speaker_profile: "Profile of Speakers/Facilitators",
  resolution: "Resolution on fee collection + minutes of meeting",
  fund_utilization: "Fund Utilization",
  sas_endorsement_letter: "SAS Endorsement Letter",
};

const ALWAYS_REQUIRED = [
  "request_letter_isg",
  "request_letter_president",
  "activity_form",
  "budgetary_allocation",
  "program_flow",
];

export const getRequiredKeys = (proposalFlags, { isISG = false } = {}) => {
  const keys = [...ALWAYS_REQUIRED];
  if (proposalFlags?.hasSpeakers) keys.push("speaker_profile");
  if (proposalFlags?.collectsFees) keys.push("resolution");
  if (isISG) keys.push("fund_utilization");
  return keys;
};

export const isConditionalKey = (key) =>
  key === "speaker_profile" || key === "resolution" || key === "fund_utilization";

export const isISGSubmitter = (role) => role === "ISG";

// ── Reviewer "Request from Submitter" feature ────────────────────────────────
// What a reviewer can ask the submitter to provide in response to a request.
export const REQUEST_TYPES = ["clarification", "document", "both"];

export const REQUEST_TYPE_LABELS = {
  clarification: "Written clarification only",
  document: "Document upload only",
  both: "Clarification and/or document",
};

// Submitter-facing status labels for a request lifecycle.
export const REQUEST_STATUS_LABELS = {
  pending: "Awaiting your response",
  uploaded: "Response sent — under review", // legacy entries
  responded: "Response sent — under review",
  resolved: "Resolved by reviewer",
  cancelled: "Cancelled",
};

// A request still blocks the pipeline until the reviewer resolves or cancels it.
export const isOpenRequest = (r) =>
  r && r.status !== "resolved" && r.status !== "cancelled";
