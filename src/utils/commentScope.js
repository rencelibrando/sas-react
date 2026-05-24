// Stage-scoped commenting helpers.
//
// Each comment carries a `stage` (the pipeline stage at which it was authored)
// and an `authorScope` (the role-group of the author: submitter, sas, isg,
// vpaa, op, fms, procurement). At any given moment, only the document submitter
// and the entity that owns the current stage may post new comments / replies.
//
// "Submitter" is identified by org membership: the user is the document
// submitter if they belong to the org that filed it (which for ISG-submitted
// proposals is the ISG org itself).

export const STAGE_OWNER_SCOPE = {
  isg_endorsement: "isg",
  isg_distribution: "isg",
  sas_review: "sas",
  sas_release: "sas",
  vpaa_review: "vpaa",
  op_approval: "op",
  fms_review: "fms",
  procurement_review: "procurement",
};

// Stages where a given non-submitter scope owns the conversation. Used both to
// gate writes and to compute the `visibleStages` filter for read access.
export const SCOPE_OWNED_STAGES = {
  sas: ["sas_review", "sas_release"],
  isg: ["isg_endorsement", "isg_distribution"],
  vpaa: ["vpaa_review"],
  op: ["op_approval"],
  fms: ["fms_review"],
  procurement: ["procurement_review"],
};

// Compute the author scope for a portal viewer based on whether they submitted
// the proposal and (if not) what role they hold in the system.
export function resolvePortalAuthorScope({ isSubmitter, role }) {
  if (isSubmitter) return "submitter";
  if (role === "Admin") return "sas";
  if (role === "ISG") return "isg";
  return "submitter";
}

// Stages this scope can author comments at. Submitters can post at any stage
// (they always have a counterpart office to talk to).
export function writableStagesFor(scope) {
  if (scope === "submitter") return null; // null = unrestricted
  return SCOPE_OWNED_STAGES[scope] || [];
}

// Stages this scope can see. Submitters and SAS Admin see everything. Other
// scopes only see comments at stages they own.
export function visibleStagesFor(scope) {
  if (scope === "submitter") return null;
  if (scope === "sas") return null;
  return SCOPE_OWNED_STAGES[scope] || [];
}

// True if `scope` is allowed to post a NEW comment while the document sits at
// `currentStage`.
export function canPostAtStage(scope, currentStage) {
  if (!currentStage) return false;
  const stages = writableStagesFor(scope);
  if (stages === null) return true;
  return stages.includes(currentStage);
}

// True if `scope` is allowed to reply on a comment whose own `stage` is
// `commentStage`, given the document is currently at `currentStage`. Replies
// follow the same rule as posting: the conversation is live only while the
// stage that owns it is the current stage. (Submitters can still reply on any
// active thread; SAS Admin is treated as broad coordinator and can always
// reply during SAS-controlled stages.)
export function canReplyOnComment(scope, commentStage, currentStage) {
  if (!currentStage) return false;
  if (scope === "submitter") {
    // Submitter replies to any thread that belongs to the current stage.
    return !commentStage || commentStage === currentStage;
  }
  const owned = writableStagesFor(scope);
  if (owned === null) return true;
  if (!owned.includes(currentStage)) return false;
  return !commentStage || commentStage === currentStage;
}
