/**
 * Report Constants
 *
 * Centralized definitions for the post-activity reports module.
 * Aligns with the paper's §1.3 Problem 1 and Table 3.9 (Reports).
 *
 * Report rules:
 * - Accomplishment Report: required for ALL orgs (AO, CSG, ISG).
 * - Financial Report: ISG-only.
 * - Financial Statement: ISG-only.
 *
 * Deadlines are computed as a fixed offset (in days) from the proposal's
 * activity date (or activityEndDate if present).
 */

export const REPORT_TYPES = {
  ACCOMPLISHMENT: "accomplishment_report",
  FINANCIAL_REPORT: "financial_report",
  FINANCIAL_STATEMENT: "financial_statement",
};

export const REPORT_TYPE_LABELS = {
  [REPORT_TYPES.ACCOMPLISHMENT]: "Accomplishment Report",
  [REPORT_TYPES.FINANCIAL_REPORT]: "Financial Report",
  [REPORT_TYPES.FINANCIAL_STATEMENT]: "Financial Statement",
};

export const REPORT_TYPE_DESCRIPTIONS = {
  [REPORT_TYPES.ACCOMPLISHMENT]:
    "Narrative summary of the completed activity — objectives, attendance, outcomes.",
  [REPORT_TYPES.FINANCIAL_REPORT]:
    "Income and expenses for the specific activity.",
  [REPORT_TYPES.FINANCIAL_STATEMENT]:
    "Financial position summary covering the period of the activity.",
};

export const REPORT_DEADLINE_OFFSET_DAYS = {
  [REPORT_TYPES.ACCOMPLISHMENT]: 7,
  [REPORT_TYPES.FINANCIAL_REPORT]: 14,
  [REPORT_TYPES.FINANCIAL_STATEMENT]: 30,
};

export const REPORT_STATUS = {
  PENDING: "pending",
  SUBMITTED: "submitted",
  LATE: "late",
  REVIEWED: "reviewed",
  NEEDS_REVISION: "needs_revision",
};

export const REPORT_STATUS_LABELS = {
  [REPORT_STATUS.PENDING]: "Pending",
  [REPORT_STATUS.SUBMITTED]: "Submitted",
  [REPORT_STATUS.LATE]: "Late",
  [REPORT_STATUS.REVIEWED]: "Reviewed",
  [REPORT_STATUS.NEEDS_REVISION]: "Needs Revision",
};

/**
 * Returns the list of report types required for a given submitter role.
 * @param {string} submitterRole - One of "ISG", "CSG", "AO" (or anything else).
 * @returns {string[]} Array of REPORT_TYPES values.
 */
export const getRequiredReportTypes = (submitterRole) => {
  if (submitterRole === "ISG") {
    return [
      REPORT_TYPES.ACCOMPLISHMENT,
      REPORT_TYPES.FINANCIAL_REPORT,
      REPORT_TYPES.FINANCIAL_STATEMENT,
    ];
  }
  return [REPORT_TYPES.ACCOMPLISHMENT];
};

/**
 * Compute the due date for a report type from a base activity date.
 * @param {Date} baseDate - Activity date (or end date) as a JS Date.
 * @param {string} reportType - REPORT_TYPES value.
 * @returns {Date} Due date as a JS Date.
 */
export const computeReportDueDate = (baseDate, reportType) => {
  const offset = REPORT_DEADLINE_OFFSET_DAYS[reportType] ?? 7;
  const due = new Date(baseDate);
  due.setDate(due.getDate() + offset);
  return due;
};
