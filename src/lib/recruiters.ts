import type { EmploymentHistoryRecord } from "./employment";
import type { UserRecord } from "./pocketbase";
import type { RecruitmentEntityRecord } from "./recruitment-entities";

export type RecruiterType = "internal" | "partner";
export type RecruiterSelectionValue = "" | `${RecruiterType}:${string}`;

export function encodeInternalRecruiter(id?: string): RecruiterSelectionValue {
  return id ? `internal:${id}` : "";
}

export function encodePartnerRecruiter(id?: string): RecruiterSelectionValue {
  return id ? `partner:${id}` : "";
}

export function parseRecruiterSelection(value: string): { type: RecruiterType; id: string } | null {
  const separator = value.indexOf(":");
  if (separator <= 0) return null;
  const type = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (!id || (type !== "internal" && type !== "partner")) return null;
  return { type, id };
}

export function recruiterSelectionFromHistory(
  history?: Pick<EmploymentHistoryRecord, "recruiter_staff" | "recruiter_partner"> | null,
): RecruiterSelectionValue {
  if (history?.recruiter_partner) return encodePartnerRecruiter(history.recruiter_partner);
  return encodeInternalRecruiter(history?.recruiter_staff);
}

export function buildRecruiterPayload(value: string) {
  const selected = parseRecruiterSelection(value);
  return {
    recruiter_staff: selected?.type === "internal" ? selected.id : "",
    recruiter_partner: selected?.type === "partner" ? selected.id : "",
  };
}

export function getRecruiterDisplay(history?: EmploymentHistoryRecord | null) {
  const partner = history?.expand?.recruiter_partner;
  if (partner) {
    return {
      id: partner.id,
      type: "partner" as const,
      name: partner.name || "Đối tác chưa xác định",
      detail: partner.hotline || partner.address || "",
      label: "Đối tác",
    };
  }

  const staff = history?.expand?.recruiter_staff;
  if (staff || history?.recruiter_staff) {
    return {
      id: staff?.id || history?.recruiter_staff || "",
      type: "internal" as const,
      name: staff?.full_name || staff?.username || "Nhân sự chưa xác định",
      detail: [staff?.username, staff?.phone, staff?.uid].filter(Boolean).join(" · "),
      label: "Nội bộ",
    };
  }

  return null;
}

export function filterInternalRecruiters(users: UserRecord[], selectedId?: string) {
  const activeUsers = users.filter(
    (user) => (user.role === "staff" || user.role === "admin") && user.status !== "disabled",
  );
  if (!selectedId) return activeUsers;

  const selectedUser = users.find((user) => user.id === selectedId);
  if (!selectedUser || selectedUser.status !== "disabled") return activeUsers;

  return [...activeUsers, selectedUser];
}

export function findRecruitmentEntity(entities: RecruitmentEntityRecord[], id?: string) {
  return id ? entities.find((entity) => entity.id === id) : undefined;
}
