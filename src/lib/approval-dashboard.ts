export const APPROVAL_DASHBOARD_STATUSES = [
  "pending",
  "approved",
  "completed",
  "rejected",
] as const;

export type ApprovalDashboardStatus = (typeof APPROVAL_DASHBOARD_STATUSES)[number];

export type ApprovalDashboardStats = Record<ApprovalDashboardStatus, number> & {
  totalAmount: number;
  amountByStatus: Record<ApprovalDashboardStatus, number>;
};

export function createEmptyApprovalDashboardStats(): ApprovalDashboardStats {
  return {
    pending: 0,
    approved: 0,
    completed: 0,
    rejected: 0,
    totalAmount: 0,
    amountByStatus: {
      pending: 0,
      approved: 0,
      completed: 0,
      rejected: 0,
    },
  };
}

export function isApprovalDashboardStatus(value?: string): value is ApprovalDashboardStatus {
  return Boolean(value && APPROVAL_DASHBOARD_STATUSES.includes(value as ApprovalDashboardStatus));
}
