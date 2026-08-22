import { pb, type UserRecord } from "./pocketbase";
import { escapePb } from "./delegations";
import { notifyApprovalCreated, notifyApprovalResolved } from "./push-notifications";
import { companyFilter, companyPayload, joinTenantFilters } from "./tenant";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "completed";
export type ResponseStatus = "pending" | "approved" | "rejected";

function currentTenantUser() {
  return pb.authStore.record as UserRecord | null;
}

export interface ApprovalRequestRecord {
  id: string;
  tenant_company: string;
  title: string;
  content: string;
  amount?: number;
  images: string[];
  excel_files: string[];
  creator: string;
  admins: string[];
  status: ApprovalStatus;
  completed_at?: string;
  created: string;
  updated: string;
  expand?: {
    creator?: UserRecord;
    admins?: UserRecord[];
  };
}

export interface ApprovalResponseRecord {
  id: string;
  tenant_company: string;
  request: string;
  admin: string;
  status: ResponseStatus;
  note: string;
  responded_at?: string;
  created: string;
  updated: string;
  expand?: {
    admin?: UserRecord;
    request?: ApprovalRequestRecord;
  };
}

export async function createApprovalRequest(data: {
  title: string;
  content: string;
  amount?: number;
  images: File[];
  excelFiles: File[];
  adminIds: string[];
  creatorId: string;
}): Promise<ApprovalRequestRecord> {
  const currentUser = pb.authStore.record as UserRecord | null;
  const tenantPayload = companyPayload(currentUser);
  const formData = new FormData();
  formData.append("tenant_company", tenantPayload.tenant_company);
  formData.append("title", data.title);
  formData.append("content", data.content);
  if (data.amount !== undefined && data.amount > 0) {
    formData.append("amount", String(data.amount));
  }
  formData.append("creator", data.creatorId);
  formData.append("status", "pending");
  for (const id of data.adminIds) formData.append("admins", id);
  for (const img of data.images) formData.append("images", img);
  for (const file of data.excelFiles) formData.append("excel_files", file);

  const request = await pb.collection("approval_requests").create<ApprovalRequestRecord>(formData);

  await Promise.all(
    data.adminIds.map((adminId) =>
      pb.collection("approval_responses").create({
        ...tenantPayload,
        request: request.id,
        admin: adminId,
        status: "pending",
        note: "",
      }),
    ),
  );

  notifyApprovalCreated(request.id).catch(() => undefined);

  return request;
}

export async function respondToApproval(
  responseId: string,
  status: "approved" | "rejected",
  note: string,
): Promise<void> {
  const response = await pb
    .collection("approval_responses")
    .update<ApprovalResponseRecord>(responseId, {
      status,
      note,
      responded_at: new Date().toISOString(),
    });

  const allResponses = await pb
    .collection("approval_responses")
    .getFullList<ApprovalResponseRecord>({
      filter: joinTenantFilters(currentTenantUser(), `request = "${escapePb(response.request)}"`),
    });

  let overall: ApprovalStatus = "pending";
  if (allResponses.some((r) => r.status === "rejected")) {
    overall = "rejected";
  } else if (allResponses.every((r) => r.status === "approved")) {
    overall = "approved";
  }

  if (overall !== "pending") {
    const previousRequest = await pb
      .collection("approval_requests")
      .getOne<ApprovalRequestRecord>(response.request, { fields: "status" })
      .catch(() => null);

    await pb.collection("approval_requests").update(response.request, { status: overall });

    if (!previousRequest || previousRequest.status === "pending") {
      notifyApprovalResolved(response.request).catch(() => undefined);
    }
  }
}

export async function markRequestCompleted(requestId: string): Promise<void> {
  await pb.collection("approval_requests").update(requestId, {
    status: "completed",
    completed_at: new Date().toISOString(),
  });
}

export async function getPendingApprovalCount(adminId: string): Promise<number> {
  const res = await pb.collection("approval_responses").getList(1, 1, {
    filter: joinTenantFilters(
      currentTenantUser(),
      `admin = "${escapePb(adminId)}" && status = "pending"`,
    ),
  });
  return res.totalItems;
}

export async function withdrawApprovalRequest(requestId: string): Promise<void> {
  const responses = await pb.collection("approval_responses").getFullList<ApprovalResponseRecord>({
    filter: joinTenantFilters(currentTenantUser(), `request = "${escapePb(requestId)}"`),
  });

  await Promise.all(responses.map((r) => pb.collection("approval_responses").delete(r.id)));
  await pb.collection("approval_requests").delete(requestId);
}

export async function deleteOldRequests(beforeDate: string): Promise<number> {
  const requests = await pb.collection("approval_requests").getFullList<ApprovalRequestRecord>({
    filter: joinTenantFilters(currentTenantUser(), `created < "${escapePb(beforeDate)}"`),
  });

  await Promise.all(requests.map((r) => pb.collection("approval_requests").delete(r.id)));

  return requests.length;
}

export function getRequestFileUrl(
  record: ApprovalRequestRecord,
  filename: string,
  thumb?: string,
): string {
  return pb.files.getURL(record as any, filename, thumb ? { thumb } : undefined);
}
