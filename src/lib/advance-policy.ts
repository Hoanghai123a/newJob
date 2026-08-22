import { pb } from "./pocketbase";
import { escapePb } from "./delegations";
import { fetchAppSettings, fetchAppSettingsStrict, type AppSettings } from "./app-settings";
import {
  fetchEmploymentHistories,
  getLatestEmploymentHistory,
  isCurrentlyWorking,
  type EmploymentHistoryRecord,
} from "./employment";
import type { FactoryRecord } from "./factories";
import type { Role, UserRecord } from "./pocketbase";
import { joinTenantFilters } from "./tenant";

export const ADVANCE_INTERACTION_DISABLED_MESSAGE =
  "Chức năng báo ứng đang tạm khóa. User và Staff hiện chỉ có thể xem dữ liệu.";

export const PARTNER_RECRUITED_ADVANCE_DISABLED_MESSAGE =
  "Người lao động do đối tác tuyển không được sử dụng chức năng ứng tiền.";

export function isAdvanceInteractionAllowed(
  settings: Pick<AppSettings, "advance_reporting_enabled"> | null | undefined,
  role?: Role,
) {
  return role === "admin" || settings?.advance_reporting_enabled !== false;
}

export async function assertAdvanceInteractionAllowed(role?: Role) {
  if (role === "admin") return;
  const settings = await fetchAppSettingsStrict();
  if (!isAdvanceInteractionAllowed(settings, role)) {
    throw new Error(ADVANCE_INTERACTION_DISABLED_MESSAGE);
  }
}

export type AdvancePolicy = {
  employment: EmploymentHistoryRecord;
  factory: FactoryRecord;
  factoryName: string;
  isWorking: boolean;
  allowAfterLeave: boolean;
  limit: number;
  outstanding: number;
  available: number;
};

export type AdvancePolicyOptions = {
  allowAfterLeave?: boolean;
  actorRole?: Role;
};

const OUTSTANDING_FILTER =
  '(status="pending" || status="recruiter_approved" || (status="accepted" && (recovery_status="" || recovery_status="none")))';

export async function loadAdvanceOutstanding(userId: string) {
  const rows = await pb.collection("advances").getFullList<{ amount?: number }>({
    filter: joinTenantFilters(
      pb.authStore.record as UserRecord | null,
      `user="${escapePb(userId)}" && ${OUTSTANDING_FILTER}`,
    ),
    fields: "amount",
  });
  return rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
}

export async function resolveAdvancePolicy(
  userId: string,
  options: AdvancePolicyOptions = {},
): Promise<AdvancePolicy> {
  const [histories, settings, outstanding] = await Promise.all([
    fetchEmploymentHistories([userId]),
    options.allowAfterLeave === undefined ? fetchAppSettings() : Promise.resolve(null),
    loadAdvanceOutstanding(userId),
  ]);

  const employment = getLatestEmploymentHistory(histories);
  if (!employment) {
    throw new Error("Người lao động chưa có lịch sử đi làm, không thể báo ứng");
  }

  if (!String(employment.employee_code || "").trim()) {
    throw new Error("Người lao động chưa có mã nhân viên tại nhà máy gần nhất, không thể báo ứng.");
  }

  if (employment.recruiter_partner && options.actorRole !== "admin") {
    throw new Error(PARTNER_RECRUITED_ADVANCE_DISABLED_MESSAGE);
  }

  const allowAfterLeave = options.allowAfterLeave ?? Boolean(settings?.allow_advance_after_leave);
  const isWorking = isCurrentlyWorking(employment);
  if (!isWorking && !allowAfterLeave) {
    throw new Error("Người lao động đã nghỉ, hệ thống hiện không cho phép báo ứng");
  }

  if (!employment.factory) {
    throw new Error("Lịch sử đi làm gần nhất chưa có nhà máy");
  }

  const factory = await pb.collection("factories").getOne<FactoryRecord>(employment.factory);
  const factoryName = factory.name || employment.expand?.factory?.name || "Nhà máy";
  const limit = Math.max(0, Number(factory.advance_limit || 0));
  if (limit <= 0) {
    throw new Error(`Nhà máy ${factoryName} chưa được cài hạn mức ứng tiền`);
  }

  return {
    employment,
    factory,
    factoryName,
    isWorking,
    allowAfterLeave,
    limit,
    outstanding,
    available: Math.max(0, limit - outstanding),
  };
}

export function validateAdvanceAmount(policy: AdvancePolicy, amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Số tiền ứng không hợp lệ");
  }
  if (policy.outstanding + amount > policy.limit) {
    throw new Error(
      `Vượt hạn mức ứng tiền của ${policy.factoryName}. Đã ứng chưa thu hồi ${policy.outstanding.toLocaleString("vi-VN")} đ, còn có thể ứng ${policy.available.toLocaleString("vi-VN")} đ`,
    );
  }
}
