import * as XLSX from "xlsx";

import { accountIdentityKey, normalizeAccountUsername } from "./account-identity";
import { accountLoginName } from "./login-identity";
import { normalizeDate } from "./date-utils";
import { deriveEmploymentStatus, type EmploymentStatus } from "./employment";
import { allocateEmploymentHistoryUids, allocateUserUids } from "./uid-counter";
import { exportToExcel } from "./excel";
import { fetchFactories, type FactoryRecord } from "./factories";
import { fetchMainHouses, type MainHouseRecord } from "./main-houses";
import { pb, type UserRecord } from "./pocketbase";
import { companyFilter, companyIdOf, resolveTenantAccountIdentity } from "./tenant";
import { resolveBankName } from "./vn-banks";

export const MAX_BULK_WORKERS = 1_000;
export const MAX_HISTORIES_PER_WORKER = 10;
export const MAX_BATCH_REQUESTS = 40;
export const DEFAULT_WORKER_PASSWORD = "12345678";

type RawExcelRow = Record<string, unknown>;

export interface WorkerSheetRow {
  rowNumber: number;
  workerKey: string;
  fullName: string;
  phoneRaw: string;
  phoneBase: string;
  cccdRaw: string;
  cccdBase: string;
  accountIdentity: string;
  gender: string;
  dateOfBirth: string;
  cccdIssueDate: string;
  address: string;
  bankName: string;
  bankAccountNumber: string;
  bankAccountName: string;
  bankAccountNote: string;
  raw: RawExcelRow;
}

export interface HistorySheetRow {
  rowNumber: number;
  workerKey: string;
  factoryName: string;
  factoryCode: string;
  mainHouseName: string;
  recruiterUsername: string;
  recruiterType: string;
  employeeCode: string;
  joinDate: string;
  leaveDate: string;
  status: EmploymentStatus;
  workerNameSnapshot: string;
  workerCccdSnapshot: string;
  workerDateOfBirthSnapshot: string;
  workerAddressSnapshot: string;
  cccdIssueDate: string;
  workerTaxCodeSnapshot: string;
  note: string;
  raw: RawExcelRow;
}

export interface PreparedEmploymentHistory {
  recordId: string;
  uid: string;
  row: HistorySheetRow;
  payload: Record<string, unknown>;
}

export interface PreparedCccdVersion {
  id: string;
  user: string;
  cccd_number: string;
  is_current: boolean;
}

export interface PreparedWorkerImport {
  workerKey: string;
  userId: string;
  uid: string;
  username: string;
  workerRow: WorkerSheetRow;
  userPayload: Record<string, unknown>;
  cccdVersions: PreparedCccdVersion[];
  histories: PreparedEmploymentHistory[];
}

export type WorkerImportStage = "Đọc file" | "Kiểm tra dữ liệu" | "PocketBase";

export interface WorkerImportError {
  workerKey: string;
  username?: string;
  phoneBase?: string;
  cccdBase?: string;
  stage: WorkerImportStage;
  reason: string;
  workerRow?: WorkerSheetRow;
  historyRows: HistorySheetRow[];
}

export interface BulkWorkerImportSummary {
  totalWorkers: number;
  createdWorkers: number;
  failedWorkers: number;
  createdHistories: number;
  durationMs: number;
}

export interface PreparedBulkWorkerImport {
  totalWorkers: number;
  workers: PreparedWorkerImport[];
  errors: WorkerImportError[];
}

export interface BulkImportExecutionResult {
  createdWorkers: PreparedWorkerImport[];
  errors: WorkerImportError[];
  createdHistoryCount: number;
}

export type MissingReferenceAction = "create" | "activate";

export interface MissingFactoryReference {
  name: string;
  code: string;
  rowNumbers: number[];
  action: MissingReferenceAction;
  existingId?: string;
}

export interface MissingMainHouseReference {
  name: string;
  rowNumbers: number[];
  action: MissingReferenceAction;
  existingId?: string;
}

export interface MissingRecruiterReference {
  username: string;
  recruiterType: string;
  workerKeys: string[];
  rowNumbers: number[];
}

export interface BulkImportReferenceInspection {
  factories: MissingFactoryReference[];
  mainHouses: MissingMainHouseReference[];
  recruiters: MissingRecruiterReference[];
}

export interface AppliedImportReference {
  id: string;
  name: string;
  collection: "factories" | "recruitment_entities";
  action: MissingReferenceAction;
  payload: Record<string, unknown>;
}

type ImportReferenceData = {
  factories: FactoryRecord[];
  mainHouses: MainHouseRecord[];
  users: UserRecord[];
};

type ParsedHistoryEntry = {
  row: HistorySheetRow;
  factory: FactoryRecord;
  mainHouse: MainHouseRecord;
  recruiterStaff?: UserRecord;
  recruiterPartner?: MainHouseRecord;
};

const WORKER_SHEET_NAMES = new Set(["nguoi lao dong", "nld"]);
const HISTORY_SHEET_NAMES = new Set(["lich su di lam", "lich su"]);
const RECORD_ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

function normalizeLabel(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .trim()
    .toLowerCase();
}

function referenceKey(value: unknown) {
  return normalizeLabel(value).replace(/\s+/g, " ");
}

function pickValue(row: RawExcelRow, keys: string[]) {
  for (const key of keys) {
    const direct = row[key];
    if (direct !== undefined && direct !== null && String(direct).trim()) {
      return String(direct).trim();
    }
    const normalizedKey = normalizeLabel(key);
    const matched = Object.entries(row).find(
      ([header]) => normalizeLabel(header) === normalizedKey,
    );
    if (matched && matched[1] !== undefined && matched[1] !== null) {
      const text = String(matched[1]).trim();
      if (text) return text;
    }
  }
  return "";
}

function parseIdentityWithSuffix(value: string, digitCount: 10 | 12, label: string) {
  const normalized = value.trim().toLowerCase();
  const match = normalized.match(new RegExp(`^(\\d{${digitCount}})([a-z._]*)$`));
  if (!match) {
    throw new Error(
      `${label} phải gồm đúng ${digitCount} chữ số, sau đó chỉ được thêm chữ a-z, dấu chấm hoặc gạch dưới.`,
    );
  }
  return { identity: normalized, base: match[1] };
}

function parseRequiredDate(value: unknown, label: string) {
  const raw = String(value ?? "").trim();
  const normalized = normalizeDate(value);
  if (!raw || !normalized) throw new Error(`Thiếu hoặc sai ${label}.`);
  return normalized;
}

function parseOptionalDate(value: unknown, label: string) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const normalized = normalizeDate(value);
  if (!normalized) throw new Error(`${label} không hợp lệ.`);
  return normalized;
}

function createRecordId(usedIds: Set<string>) {
  for (;;) {
    const bytes = new Uint8Array(15);
    crypto.getRandomValues(bytes);
    let id = "";
    for (const byte of bytes) id += RECORD_ID_CHARS[byte % RECORD_ID_CHARS.length];
    if (!usedIds.has(id)) {
      usedIds.add(id);
      return id;
    }
  }
}

function parseWorkerRow(raw: RawExcelRow, rowNumber: number): WorkerSheetRow {
  const workerKey = pickValue(raw, ["Mã NLĐ trong file", "Mã NLĐ", "worker_key"]);
  const fullName = pickValue(raw, ["Họ và tên", "full_name"]);
  const phoneRaw = pickValue(raw, ["Số điện thoại", "SĐT", "phone"]);
  const cccdRaw = pickValue(raw, ["CCCD", "cccd"]);
  const dateOfBirthRaw = raw["Ngày sinh"] ?? raw.date_of_birth ?? "";
  const cccdIssueDateRaw = raw["Ngày cấp CCCD"] ?? raw.cccd_issue_date ?? "";
  const address = pickValue(raw, ["Địa chỉ thường trú", "Địa chỉ", "address"]);
  if (!workerKey) throw new Error("Thiếu Mã NLĐ trong file.");
  if (!fullName) throw new Error("Thiếu Họ và tên.");
  if (!cccdRaw) throw new Error("Thiếu CCCD.");
  if (!address) throw new Error("Thiếu Địa chỉ thường trú.");

  const cccd = parseIdentityWithSuffix(cccdRaw, 12, "CCCD");
  const phone = phoneRaw
    ? parseIdentityWithSuffix(phoneRaw, 10, "Số điện thoại")
    : { identity: "", base: "" };
  const accountIdentity = normalizeAccountUsername(phone.identity || cccd.identity);
  if (!/^[a-z0-9_.]{4,30}$/.test(accountIdentity)) {
    throw new Error("Tên đăng nhập sinh từ SĐT/CCCD không hợp lệ hoặc dài quá 30 ký tự.");
  }

  return {
    rowNumber,
    workerKey,
    fullName,
    phoneRaw,
    phoneBase: phone.base,
    cccdRaw,
    cccdBase: cccd.base,
    accountIdentity,
    gender: pickValue(raw, ["Giới tính", "gender"]),
    dateOfBirth: parseRequiredDate(dateOfBirthRaw, "Ngày sinh"),
    cccdIssueDate: parseRequiredDate(cccdIssueDateRaw, "Ngày cấp CCCD"),
    address,
    bankName: resolveBankName(pickValue(raw, ["Ngân hàng", "bank_name"])),
    bankAccountNumber: pickValue(raw, ["Số tài khoản", "Số TK", "bank_account_number"]).replace(
      /\D/g,
      "",
    ),
    bankAccountName: pickValue(raw, ["Tên tài khoản", "Tên TK", "bank_account_name"]),
    bankAccountNote: pickValue(raw, ["Ghi chú STK", "bank_account_note"]),
    raw,
  };
}

function makeFallbackWorkerRow(raw: RawExcelRow, rowNumber: number): WorkerSheetRow {
  return {
    rowNumber,
    workerKey: pickValue(raw, ["Mã NLĐ trong file", "Mã NLĐ", "worker_key"]),
    fullName: pickValue(raw, ["Họ và tên", "full_name"]),
    phoneRaw: pickValue(raw, ["Số điện thoại", "SĐT", "phone"]),
    phoneBase: "",
    cccdRaw: pickValue(raw, ["CCCD", "cccd"]),
    cccdBase: "",
    accountIdentity: "",
    gender: "",
    dateOfBirth: "",
    cccdIssueDate: "",
    address: "",
    bankName: "",
    bankAccountNumber: "",
    bankAccountName: "",
    bankAccountNote: "",
    raw,
  };
}

function makeFallbackHistoryRow(
  raw: RawExcelRow,
  rowNumber: number,
  fallbackKey = "",
): HistorySheetRow {
  return {
    rowNumber,
    workerKey: pickValue(raw, ["Mã NLĐ trong file", "Mã NLĐ", "worker_key"]) || fallbackKey,
    factoryName: pickValue(raw, ["Tên nhà máy", "Nhà máy", "factory_name"]),
    factoryCode: pickValue(raw, ["Mã nhà máy", "factory_code"]),
    mainHouseName: pickValue(raw, ["Nhà chính", "main_house_name"]),
    recruiterUsername: pickValue(raw, ["Người tuyển", "recruiter_username"]),
    recruiterType: pickValue(raw, ["Loại người tuyển", "recruiter_type"]),
    employeeCode: pickValue(raw, ["Mã nhân viên", "Mã NV", "employee_code"]),
    joinDate: "",
    leaveDate: "",
    status: "left",
    workerNameSnapshot: "",
    workerCccdSnapshot: "",
    workerDateOfBirthSnapshot: "",
    workerAddressSnapshot: "",
    cccdIssueDate: "",
    workerTaxCodeSnapshot: "",
    note: pickValue(raw, ["Ghi chú", "note"]),
    raw,
  };
}

function resolveFactory(
  factoryName: string,
  factoryCode: string,
  factoryByName: Map<string, FactoryRecord>,
  factoryByCode: Map<string, FactoryRecord>,
) {
  const byName = factoryName ? factoryByName.get(referenceKey(factoryName)) : undefined;
  const byCode = factoryCode ? factoryByCode.get(referenceKey(factoryCode)) : undefined;
  if (byName && byCode && byName.id !== byCode.id) {
    throw new Error("Tên và mã nhà máy không khớp cùng một nhà máy.");
  }
  const factory = byName || byCode;
  if (!factory) throw new Error("Không tìm thấy nhà máy theo tên hoặc mã.");
  return factory;
}

function parseHistoryRow(
  raw: RawExcelRow,
  rowNumber: number,
  worker: WorkerSheetRow,
  refs: {
    factoryByName: Map<string, FactoryRecord>;
    factoryByCode: Map<string, FactoryRecord>;
    mainHouseByName: Map<string, MainHouseRecord>;
    recruiterByUsername: Map<string, UserRecord>;
  },
): ParsedHistoryEntry {
  const workerKey = pickValue(raw, ["Mã NLĐ trong file", "Mã NLĐ", "worker_key"]);
  const factoryName = pickValue(raw, ["Tên nhà máy", "Nhà máy", "factory_name"]);
  const factoryCode = pickValue(raw, ["Mã nhà máy", "factory_code"]);
  const mainHouseName = pickValue(raw, ["Nhà chính", "main_house_name"]);
  const recruiterUsername = pickValue(raw, ["Người tuyển", "recruiter_username"]);
  const recruiterType = pickValue(raw, ["Loại người tuyển", "recruiter_type"]);
  const employeeCode = pickValue(raw, ["Mã nhân viên", "Mã NV", "employee_code"]);
  const joinRaw = raw["Ngày vào làm"] ?? raw.join_date ?? raw["Ngày vào"] ?? "";
  const leaveRaw = raw["Ngày nghỉ"] ?? raw.leave_date ?? "";
  if (!workerKey) throw new Error("Thiếu Mã NLĐ trong file.");
  if (!factoryName && !factoryCode) throw new Error("Thiếu Tên nhà máy hoặc Mã nhà máy.");
  if (!mainHouseName) throw new Error("Thiếu Nhà chính.");
  if (!recruiterUsername) throw new Error("Thiếu Người tuyển.");

  const factory = resolveFactory(factoryName, factoryCode, refs.factoryByName, refs.factoryByCode);
  const mainHouse = refs.mainHouseByName.get(referenceKey(mainHouseName));
  if (!mainHouse) throw new Error(`Không tìm thấy Nhà chính "${mainHouseName}".`);
  const recruiterKey = accountIdentityKey(recruiterUsername);
  const recruiterTypeKey = referenceKey(recruiterType);
  const internalRecruiter = refs.recruiterByUsername.get(recruiterKey);
  const partnerRecruiter = refs.mainHouseByName.get(referenceKey(recruiterUsername));
  const wantsPartner = recruiterTypeKey === "partner" || recruiterTypeKey.includes("doi tac");
  const wantsInternal = recruiterTypeKey === "internal" || recruiterTypeKey.includes("noi bo");
  if (!wantsPartner && !wantsInternal && internalRecruiter && partnerRecruiter) {
    throw new Error(
      `Người tuyển "${recruiterUsername}" trùng giữa Nội bộ và Đối tác; cần cột Loại người tuyển.`,
    );
  }
  const recruiterStaff = wantsPartner ? undefined : internalRecruiter;
  const recruiterPartner = wantsInternal ? undefined : partnerRecruiter;
  if (!recruiterStaff && !recruiterPartner) {
    throw new Error(`Không tìm thấy Người tuyển "${recruiterUsername}" theo loại đã chọn.`);
  }

  const joinDate = parseRequiredDate(joinRaw, "Ngày vào làm");
  const leaveDate = parseOptionalDate(leaveRaw, "Ngày nghỉ");
  if (leaveDate && leaveDate < joinDate) throw new Error("Ngày nghỉ không thể trước Ngày vào làm.");
  const status = deriveEmploymentStatus({ leave_date: leaveDate || undefined });
  const snapshotCccdRaw = pickValue(raw, [
    "CCCD tại thời điểm đi làm",
    "CCCD tại nhà máy",
    "worker_cccd_snapshot",
  ]);
  const snapshotCccd = snapshotCccdRaw
    ? parseIdentityWithSuffix(snapshotCccdRaw, 12, "CCCD snapshot").base
    : worker.cccdBase;
  const snapshotBirthRaw =
    raw["Ngày sinh tại thời điểm đi làm"] ?? raw.worker_date_of_birth_snapshot ?? "";
  const snapshotIssueRaw = raw["Ngày cấp CCCD tại thời điểm đi làm"] ?? raw.cccd_issue_date ?? "";

  const row: HistorySheetRow = {
    rowNumber,
    workerKey,
    factoryName,
    factoryCode,
    mainHouseName,
    recruiterUsername,
    recruiterType,
    employeeCode,
    joinDate,
    leaveDate,
    status,
    workerNameSnapshot:
      pickValue(raw, ["Họ tên tại thời điểm đi làm", "worker_name_snapshot"]) || worker.fullName,
    workerCccdSnapshot: snapshotCccd,
    workerDateOfBirthSnapshot: snapshotBirthRaw
      ? parseRequiredDate(snapshotBirthRaw, "Ngày sinh snapshot")
      : worker.dateOfBirth,
    workerAddressSnapshot:
      pickValue(raw, ["Địa chỉ tại thời điểm đi làm", "worker_address_snapshot"]) || worker.address,
    cccdIssueDate: snapshotIssueRaw
      ? parseRequiredDate(snapshotIssueRaw, "Ngày cấp CCCD snapshot")
      : worker.cccdIssueDate,
    workerTaxCodeSnapshot: pickValue(raw, ["Mã số thuế", "MST", "worker_tax_code_snapshot"]),
    note: pickValue(raw, ["Ghi chú", "note"]),
    raw,
  };
  return { row, factory, mainHouse, recruiterStaff, recruiterPartner };
}

function findSheet(workbook: XLSX.WorkBook, acceptedNames: Set<string>) {
  const sheetName = workbook.SheetNames.find((name) => acceptedNames.has(normalizeLabel(name)));
  return sheetName ? workbook.Sheets[sheetName] : undefined;
}

function workbookRows(sheet: XLSX.WorkSheet) {
  return XLSX.utils.sheet_to_json<RawExcelRow>(sheet, { defval: "", raw: true });
}

function addWorkerError(
  errors: WorkerImportError[],
  input: Omit<WorkerImportError, "historyRows"> & { historyRows?: HistorySheetRow[] },
) {
  errors.push({ ...input, historyRows: input.historyRows || [] });
}

function appendUnique(values: string[], value: string) {
  if (value && !values.includes(value)) values.push(value);
}

function appendUniqueNumber(values: number[], value: number) {
  if (!values.includes(value)) values.push(value);
}

function recruiterTypeFlags(value: string) {
  const key = referenceKey(value);
  return {
    wantsPartner: key === "partner" || key.includes("doi tac"),
    wantsInternal: key === "internal" || key.includes("noi bo"),
  };
}

export async function inspectBulkWorkerImportReferences(
  file: File,
): Promise<BulkImportReferenceInspection> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const workerSheet = findSheet(workbook, WORKER_SHEET_NAMES);
  const historySheet = findSheet(workbook, HISTORY_SHEET_NAMES);
  if (!workerSheet || !historySheet) {
    throw new Error('File phải có đủ hai sheet "Người lao động" và "Lịch sử đi làm".');
  }

  const [factories, mainHouses, users] = await Promise.all([
    fetchFactories(),
    fetchMainHouses({ includeInactive: true }),
    pb.collection("users").getFullList<UserRecord>({
      fields: "id,username,role",
      filter: companyFilter(pb.authStore.record as UserRecord | null, "tenant_company"),
      sort: "username",
    }),
  ]);
  const factoryByName = new Map(
    factories.filter((item) => item.name).map((item) => [referenceKey(item.name), item]),
  );
  const factoryByCode = new Map(
    factories.filter((item) => item.code).map((item) => [referenceKey(item.code), item]),
  );
  const mainHouseByName = new Map(
    mainHouses.filter((item) => item.name).map((item) => [referenceKey(item.name), item]),
  );
  const recruiterByUsername = new Map(
    users
      .filter((user) => user.role === "staff" || user.role === "admin")
      .filter((user) => user.username)
      .map((user) => [accountIdentityKey(accountLoginName(user)), user]),
  );

  const missingFactories = new Map<string, MissingFactoryReference>();
  const missingMainHouses = new Map<string, MissingMainHouseReference>();
  const missingRecruiters = new Map<string, MissingRecruiterReference>();

  const addFactory = (
    factory: FactoryRecord | undefined,
    name: string,
    code: string,
    rowNumber: number,
  ) => {
    if (factory) {
      if (factory.status !== "inactive") return;
      const key = `activate:${factory.id}`;
      const current = missingFactories.get(key) || {
        name: factory.name,
        code: factory.code || code,
        rowNumbers: [],
        action: "activate" as const,
        existingId: factory.id,
      };
      appendUniqueNumber(current.rowNumbers, rowNumber);
      missingFactories.set(key, current);
      return;
    }
    if (!name) return;
    const key = `create:${referenceKey(name)}`;
    const current = missingFactories.get(key) || {
      name,
      code,
      rowNumbers: [],
      action: "create" as const,
    };
    if (!current.code && code) current.code = code;
    appendUniqueNumber(current.rowNumbers, rowNumber);
    missingFactories.set(key, current);
  };

  const addMainHouse = (name: string, rowNumber: number) => {
    if (!name) return;
    const existing = mainHouseByName.get(referenceKey(name));
    if (existing && existing.status !== "inactive") return;
    const key = existing ? `activate:${existing.id}` : `create:${referenceKey(name)}`;
    const current = missingMainHouses.get(key) || {
      name: existing?.name || name,
      rowNumbers: [],
      action: existing ? ("activate" as const) : ("create" as const),
      existingId: existing?.id,
    };
    appendUniqueNumber(current.rowNumbers, rowNumber);
    missingMainHouses.set(key, current);
  };

  for (const [index, raw] of workbookRows(historySheet).entries()) {
    const rowNumber = index + 2;
    const workerKey = pickValue(raw, ["Mã NLĐ trong file", "Mã NLĐ", "worker_key"]);
    const factoryName = pickValue(raw, ["Tên nhà máy", "Nhà máy", "factory_name"]);
    const factoryCode = pickValue(raw, ["Mã nhà máy", "factory_code"]);
    const byName = factoryName ? factoryByName.get(referenceKey(factoryName)) : undefined;
    const byCode = factoryCode ? factoryByCode.get(referenceKey(factoryCode)) : undefined;
    if (!(byName && byCode && byName.id !== byCode.id)) {
      addFactory(byName || byCode, factoryName, factoryCode, rowNumber);
    }

    const mainHouseName = pickValue(raw, ["Nhà chính", "main_house_name"]);
    addMainHouse(mainHouseName, rowNumber);

    const recruiterUsername = pickValue(raw, ["Người tuyển", "recruiter_username"]);
    if (!recruiterUsername) continue;
    const recruiterType = pickValue(raw, ["Loại người tuyển", "recruiter_type"]);
    const { wantsPartner, wantsInternal } = recruiterTypeFlags(recruiterType);
    const internalRecruiter = recruiterByUsername.get(accountIdentityKey(recruiterUsername));
    const partnerRecruiter = mainHouseByName.get(referenceKey(recruiterUsername));

    if (wantsPartner) {
      addMainHouse(recruiterUsername, rowNumber);
      continue;
    }
    if (!wantsInternal && (internalRecruiter || partnerRecruiter)) {
      if (partnerRecruiter?.status === "inactive") addMainHouse(recruiterUsername, rowNumber);
      continue;
    }
    if (internalRecruiter) continue;

    const key = `${accountIdentityKey(recruiterUsername)}|${referenceKey(recruiterType)}`;
    const current = missingRecruiters.get(key) || {
      username: recruiterUsername,
      recruiterType,
      workerKeys: [],
      rowNumbers: [],
    };
    appendUnique(current.workerKeys, workerKey);
    appendUniqueNumber(current.rowNumbers, rowNumber);
    missingRecruiters.set(key, current);
  }

  return {
    factories: [...missingFactories.values()].sort((a, b) => a.name.localeCompare(b.name, "vi")),
    mainHouses: [...missingMainHouses.values()].sort((a, b) => a.name.localeCompare(b.name, "vi")),
    recruiters: [...missingRecruiters.values()].sort((a, b) =>
      a.username.localeCompare(b.username, "vi"),
    ),
  };
}

export async function applyBulkWorkerImportReferences(
  inspection: BulkImportReferenceInspection,
): Promise<AppliedImportReference[]> {
  const applied: AppliedImportReference[] = [];

  for (const item of inspection.factories) {
    const payload =
      item.action === "create"
        ? {
            name: item.name.trim(),
            code: item.code.trim(),
            address: "",
            hotline: "",
            advance_limit: 0,
            status: "active",
            note: "Tạo từ import NLĐ và lịch sử đi làm",
          }
        : { status: "active" };
    const record = item.existingId
      ? await pb.collection("factories").update(item.existingId, payload)
      : await pb.collection("factories").create({
          ...payload,
          tenant_company: companyIdOf(pb.authStore.record as UserRecord | null),
        });
    applied.push({
      id: record.id,
      name: item.name,
      collection: "factories",
      action: item.action,
      payload,
    });
  }

  for (const item of inspection.mainHouses) {
    const payload =
      item.action === "create"
        ? {
            name: item.name.trim(),
            address: "",
            hotline: "",
            status: "active",
            note: "Tạo từ import NLĐ và lịch sử đi làm",
          }
        : { status: "active" };
    const record = item.existingId
      ? await pb.collection("recruitment_entities").update(item.existingId, payload)
      : await pb.collection("recruitment_entities").create({
          ...payload,
          tenant_company: companyIdOf(pb.authStore.record as UserRecord | null),
        });
    applied.push({
      id: record.id,
      name: item.name,
      collection: "recruitment_entities",
      action: item.action,
      payload,
    });
  }

  return applied;
}

async function fetchReferenceData(): Promise<ImportReferenceData> {
  const [factories, mainHouses, users] = await Promise.all([
    fetchFactories(),
    fetchMainHouses(),
    pb.collection("users").getFullList<UserRecord>({
      fields: "id,username,uid,role",
      filter: companyFilter(pb.authStore.record as UserRecord | null, "tenant_company"),
      sort: "username",
    }),
  ]);
  return {
    factories,
    mainHouses,
    users,
  };
}

export async function prepareBulkWorkerImport(file: File): Promise<PreparedBulkWorkerImport> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const workerSheet = findSheet(workbook, WORKER_SHEET_NAMES);
  const historySheet = findSheet(workbook, HISTORY_SHEET_NAMES);
  if (!workerSheet || !historySheet) {
    throw new Error('File phải có đủ hai sheet "Người lao động" và "Lịch sử đi làm".');
  }

  const rawWorkerRows = workbookRows(workerSheet);
  const rawHistoryRows = workbookRows(historySheet);
  if (!rawWorkerRows.length) throw new Error('Sheet "Người lao động" không có dữ liệu.');
  if (rawWorkerRows.length > MAX_BULK_WORKERS) {
    throw new Error(`Mỗi file chỉ được chứa tối đa ${MAX_BULK_WORKERS} NLĐ.`);
  }

  const refs = await fetchReferenceData();
  const errors: WorkerImportError[] = [];
  const parsedWorkers: WorkerSheetRow[] = [];
  for (const [index, raw] of rawWorkerRows.entries()) {
    try {
      parsedWorkers.push(parseWorkerRow(raw, index + 2));
    } catch (error) {
      const workerRow = makeFallbackWorkerRow(raw, index + 2);
      addWorkerError(errors, {
        workerKey: workerRow.workerKey,
        stage: "Kiểm tra dữ liệu",
        reason: error instanceof Error ? error.message : "Dòng NLĐ không hợp lệ.",
        workerRow,
      });
    }
  }

  const invalidWorkerRows = new Set(errors.map((error) => error.workerRow?.rowNumber));
  const workersByKey = new Map<string, WorkerSheetRow[]>();
  const workersByUsername = new Map<string, WorkerSheetRow[]>();
  for (const worker of parsedWorkers) {
    const key = accountIdentityKey(worker.workerKey);
    workersByKey.set(key, [...(workersByKey.get(key) || []), worker]);
    const usernameKey = accountIdentityKey(worker.accountIdentity);
    workersByUsername.set(usernameKey, [...(workersByUsername.get(usernameKey) || []), worker]);
  }

  const markDuplicates = (groups: Map<string, WorkerSheetRow[]>, label: string) => {
    for (const duplicates of groups.values()) {
      if (duplicates.length < 2) continue;
      for (const worker of duplicates) {
        invalidWorkerRows.add(worker.rowNumber);
        addWorkerError(errors, {
          workerKey: worker.workerKey,
          username: worker.accountIdentity,
          phoneBase: worker.phoneBase,
          cccdBase: worker.cccdBase,
          stage: "Kiểm tra dữ liệu",
          reason: `${label} bị trùng ở các dòng ${duplicates.map((item) => item.rowNumber).join(", ")}.`,
          workerRow: worker,
        });
      }
    }
  };
  markDuplicates(workersByKey, "Mã NLĐ trong file");
  markDuplicates(workersByUsername, "Tên đăng nhập");

  const existingUsernames = new Set(
    refs.users.map((user) => accountIdentityKey(accountLoginName(user))).filter(Boolean),
  );
  for (const worker of parsedWorkers) {
    if (!existingUsernames.has(accountIdentityKey(worker.accountIdentity))) continue;
    invalidWorkerRows.add(worker.rowNumber);
    addWorkerError(errors, {
      workerKey: worker.workerKey,
      username: worker.accountIdentity,
      phoneBase: worker.phoneBase,
      cccdBase: worker.cccdBase,
      stage: "Kiểm tra dữ liệu",
      reason: `Tên đăng nhập "${worker.accountIdentity}" đã tồn tại.`,
      workerRow: worker,
    });
  }

  const validWorkerByKey = new Map(
    parsedWorkers
      .filter((worker) => !invalidWorkerRows.has(worker.rowNumber))
      .map((worker) => [accountIdentityKey(worker.workerKey), worker]),
  );
  const factoryByName = new Map(
    refs.factories.map((factory) => [referenceKey(factory.name), factory]),
  );
  const factoryByCode = new Map(
    refs.factories
      .filter((factory) => factory.code)
      .map((factory) => [referenceKey(factory.code), factory]),
  );
  const mainHouseByName = new Map(refs.mainHouses.map((item) => [referenceKey(item.name), item]));
  const recruiterByUsername = new Map(
    refs.users
      .filter((user) => user.role === "staff" || user.role === "admin")
      .filter((user) => user.username)
      .map((user) => [accountIdentityKey(accountLoginName(user)), user]),
  );

  const historiesByWorkerKey = new Map<string, ParsedHistoryEntry[]>();
  const historyParseErrorsByKey = new Map<
    string,
    Array<{ raw: RawExcelRow; rowNumber: number; reason: string }>
  >();
  for (const [index, raw] of rawHistoryRows.entries()) {
    const rowNumber = index + 2;
    const rawKey = pickValue(raw, ["Mã NLĐ trong file", "Mã NLĐ", "worker_key"]);
    const key = accountIdentityKey(rawKey);
    const worker = validWorkerByKey.get(key);
    if (!worker) {
      historyParseErrorsByKey.set(key, [
        ...(historyParseErrorsByKey.get(key) || []),
        {
          raw,
          rowNumber,
          reason: rawKey
            ? `Không tìm thấy NLĐ hợp lệ có Mã NLĐ trong file "${rawKey}".`
            : "Thiếu Mã NLĐ trong file.",
        },
      ]);
      continue;
    }
    try {
      const parsed = parseHistoryRow(raw, rowNumber, worker, {
        factoryByName,
        factoryByCode,
        mainHouseByName,
        recruiterByUsername,
      });
      historiesByWorkerKey.set(key, [...(historiesByWorkerKey.get(key) || []), parsed]);
    } catch (error) {
      historyParseErrorsByKey.set(key, [
        ...(historyParseErrorsByKey.get(key) || []),
        {
          raw,
          rowNumber,
          reason: error instanceof Error ? error.message : "Dòng lịch sử không hợp lệ.",
        },
      ]);
    }
  }

  const usedRecordIds = new Set<string>();
  const preparedWorkers: PreparedWorkerImport[] = [];

  for (const worker of parsedWorkers) {
    if (invalidWorkerRows.has(worker.rowNumber)) continue;
    const key = accountIdentityKey(worker.workerKey);
    const historyParseErrors = historyParseErrorsByKey.get(key) || [];
    const historyEntries = historiesByWorkerKey.get(key) || [];
    const historyRows = historyEntries.map((entry) => entry.row);
    const invalidHistoryRows = historyParseErrors.map((item) =>
      makeFallbackHistoryRow(item.raw, item.rowNumber, worker.workerKey),
    );
    let reason = "";

    if (historyParseErrors.length) {
      reason = historyParseErrors
        .map((item) => `Dòng ${item.rowNumber}: ${item.reason}`)
        .join(" | ");
    } else if (!historyEntries.length) {
      reason = "NLĐ phải có ít nhất một lịch sử đi làm.";
    } else if (historyEntries.length > MAX_HISTORIES_PER_WORKER) {
      reason = `Mỗi NLĐ chỉ được có tối đa ${MAX_HISTORIES_PER_WORKER} lịch sử đi làm.`;
    }

    historyEntries.sort((a, b) => a.row.joinDate.localeCompare(b.row.joinDate));
    if (!reason) {
      const duplicateKeys = new Map<string, number[]>();
      for (const entry of historyEntries) {
        const duplicateKey = `${entry.factory.id}|${entry.row.joinDate}`;
        duplicateKeys.set(duplicateKey, [
          ...(duplicateKeys.get(duplicateKey) || []),
          entry.row.rowNumber,
        ]);
      }
      const duplicate = [...duplicateKeys.values()].find((rows) => rows.length > 1);
      if (duplicate) reason = `Trùng nhà máy và ngày vào làm ở các dòng ${duplicate.join(", ")}.`;
    }

    if (!reason) {
      for (let index = 0; index < historyEntries.length; index++) {
        const current = historyEntries[index].row;
        const next = historyEntries[index + 1]?.row;
        if (next && !current.leaveDate) {
          reason = `Lịch sử dòng ${current.rowNumber} phải có Ngày nghỉ trước lịch sử tiếp theo.`;
          break;
        }
        if (next && current.leaveDate > next.joinDate) {
          reason = `Lịch sử dòng ${current.rowNumber} chồng ngày với dòng ${next.rowNumber}.`;
          break;
        }
      }
    }

    if (reason) {
      addWorkerError(errors, {
        workerKey: worker.workerKey,
        username: worker.accountIdentity,
        phoneBase: worker.phoneBase,
        cccdBase: worker.cccdBase,
        stage: "Kiểm tra dữ liệu",
        reason,
        workerRow: worker,
        historyRows: [...historyRows, ...invalidHistoryRows],
      });
      continue;
    }

    const uid = "";
    const userId = createRecordId(usedRecordIds);
    const latestEntry = historyEntries[historyEntries.length - 1];
    const cccdVersionByNumber = new Map<string, PreparedCccdVersion>();
    let hasInvalidHistoryCccd = false;
    for (const entry of historyEntries) {
      const cccdNumber = entry.row.workerCccdSnapshot.replace(/\D/g, "");
      if (![9, 12].includes(cccdNumber.length)) {
        errors.push({
          workerKey: worker.workerKey,
          username: worker.accountIdentity,
          cccdBase: worker.cccdBase,
          stage: "Kiểm tra dữ liệu",
          reason: `Lịch sử dòng ${entry.row.rowNumber} có số CMND/CCCD không hợp lệ.`,
          workerRow: worker,
          historyRows: [entry.row],
        });
        hasInvalidHistoryCccd = true;
        continue;
      }
      if (!cccdVersionByNumber.has(cccdNumber)) {
        cccdVersionByNumber.set(cccdNumber, {
          id: createRecordId(usedRecordIds),
          user: userId,
          cccd_number: cccdNumber,
          is_current: cccdNumber === worker.cccdBase.replace(/\D/g, ""),
        });
      }
    }
    if (hasInvalidHistoryCccd) continue;
    const cccdVersions = [...cccdVersionByNumber.values()];
    const histories: PreparedEmploymentHistory[] = [];
    for (const entry of historyEntries) {
      const historyUid = "";
      const historyId = createRecordId(usedRecordIds);
      histories.push({
        recordId: historyId,
        uid: historyUid,
        row: entry.row,
        payload: {
          id: historyId,
          uid: historyUid,
          user: userId,
          factory: entry.factory.id,
          main_house: entry.mainHouse.id,
          employee_code: entry.row.employeeCode,
          worker_name_snapshot: entry.row.workerNameSnapshot,
          worker_cccd_snapshot: entry.row.workerCccdSnapshot.replace(/\D/g, ""),
          cccd_version: cccdVersionByNumber.get(entry.row.workerCccdSnapshot.replace(/\D/g, ""))
            ?.id,
          worker_date_of_birth_snapshot: entry.row.workerDateOfBirthSnapshot,
          worker_address_snapshot: entry.row.workerAddressSnapshot,
          hometown_snapshot: entry.row.workerAddressSnapshot,
          cccd_issue_date: entry.row.cccdIssueDate,
          worker_tax_code_snapshot: entry.row.workerTaxCodeSnapshot,
          recruiter_staff: entry.recruiterStaff?.id || "",
          recruiter_partner: entry.recruiterPartner?.id || "",
          join_date: entry.row.joinDate,
          leave_date: entry.row.leaveDate || "",
          status: entry.row.status,
          note: entry.row.note,
        },
      });
    }

    preparedWorkers.push({
      workerKey: worker.workerKey,
      userId,
      uid,
      username: worker.accountIdentity,
      workerRow: worker,
      userPayload: {
        id: userId,
        username: worker.accountIdentity,
        uid,
        emailVisibility: false,
        password: DEFAULT_WORKER_PASSWORD,
        passwordConfirm: DEFAULT_WORKER_PASSWORD,
        full_name: worker.fullName,
        phone: worker.phoneBase,
        cccd: worker.cccdBase,
        cccd_issue_date: worker.cccdIssueDate,
        date_of_birth: worker.dateOfBirth,
        gender: worker.gender,
        address: worker.address,
        bank_name: worker.bankName,
        bank_account_number: worker.bankAccountNumber,
        bank_account_name: worker.bankAccountName,
        bank_account_note: worker.bankAccountNote,
        company: latestEntry.factory.name,
        employee_code: latestEntry.row.employeeCode,
        role: "user",
        approvalStatus: "approved",
        approved: "true",
        status: "active",
        must_change_password: true,
      },
      cccdVersions,
      histories,
    });
  }

  for (const [key, parseErrors] of historyParseErrorsByKey) {
    if (validWorkerByKey.has(key)) continue;
    for (const item of parseErrors) {
      addWorkerError(errors, {
        workerKey: pickValue(item.raw, ["Mã NLĐ trong file", "Mã NLĐ", "worker_key"]),
        stage: "Kiểm tra dữ liệu",
        reason: `Dòng lịch sử ${item.rowNumber}: ${item.reason}`,
        historyRows: [makeFallbackHistoryRow(item.raw, item.rowNumber)],
      });
    }
  }

  if (preparedWorkers.length) {
    const historyCount = preparedWorkers.reduce(
      (total, worker) => total + worker.histories.length,
      0,
    );
    const [userUids, historyUids] = await Promise.all([
      allocateUserUids(preparedWorkers.length),
      allocateEmploymentHistoryUids(historyCount),
    ]);
    let historyIndex = 0;
    preparedWorkers.forEach((worker, workerIndex) => {
      worker.uid = userUids[workerIndex];
      worker.userPayload.uid = worker.uid;
      worker.histories.forEach((history) => {
        history.uid = historyUids[historyIndex++];
        history.payload.uid = history.uid;
      });
    });
  }

  return { totalWorkers: rawWorkerRows.length, workers: preparedWorkers, errors };
}

function errorMessage(error: unknown) {
  if (typeof error === "object" && error !== null && "response" in error) {
    const response = (error as { response?: { message?: string; data?: Record<string, unknown> } })
      .response;
    const fieldMessages = Object.entries(response?.data || {})
      .map(([field, value]) => {
        const message =
          typeof value === "object" && value !== null && "message" in value
            ? String((value as { message?: unknown }).message || "")
            : String(value || "");
        return message ? `${field}: ${message}` : "";
      })
      .filter(Boolean);
    if (fieldMessages.length) return fieldMessages.join("; ");
    if (response?.message) return response.message;
  }
  return error instanceof Error ? error.message : "PocketBase từ chối giao dịch.";
}

function packWorkers(workers: PreparedWorkerImport[]) {
  const groups: PreparedWorkerImport[][] = [];
  let current: PreparedWorkerImport[] = [];
  let requestCount = 0;
  for (const worker of workers) {
    const workerRequestCount = 1 + worker.cccdVersions.length + worker.histories.length;
    if (current.length && requestCount + workerRequestCount > MAX_BATCH_REQUESTS) {
      groups.push(current);
      current = [];
      requestCount = 0;
    }
    current.push(worker);
    requestCount += workerRequestCount;
  }
  if (current.length) groups.push(current);
  return groups;
}

async function sendWorkerBatch(workers: PreparedWorkerImport[]) {
  const currentUser = pb.authStore.record as UserRecord | null;
  const tenantCompany = companyIdOf(currentUser);
  if (!tenantCompany) throw new Error("Tài khoản chưa được gán công ty hợp lệ.");
  const batch = pb.createBatch();
  for (const worker of workers) {
    const identity = await resolveTenantAccountIdentity(currentUser, worker.username);
    batch.collection("users").create({
      ...worker.userPayload,
      username: identity.username,
      ...(identity.hasLoginName ? { login_name: identity.loginName } : {}),
      tenant_company: tenantCompany,
    });
    for (const version of worker.cccdVersions) batch.collection("cccd_versions").create(version);
    for (const history of worker.histories)
      batch
        .collection("employment_histories")
        .create({ ...history.payload, tenant_company: tenantCompany });
  }
  await batch.send();
}

async function assertBulkEmploymentHistoryCapacity(workers: PreparedWorkerImport[]) {
  const adding = workers.reduce((total, worker) => total + worker.histories.length, 0);
  if (!adding) return;
  const response = await fetch("/api/employment-histories/capacity", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${pb.authStore.token}` },
    body: JSON.stringify({ adding }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(body?.message || "Không kiểm tra được hạn mức lịch sử lao động.");
}

export async function executePreparedBulkImport(
  workers: PreparedWorkerImport[],
  onProgress?: (processedWorkers: number, createdWorkers: number, failedWorkers: number) => void,
): Promise<BulkImportExecutionResult> {
  await assertBulkEmploymentHistoryCapacity(workers);
  const createdWorkers: PreparedWorkerImport[] = [];
  const errors: WorkerImportError[] = [];
  let processedWorkers = 0;
  const runGroup = async (group: PreparedWorkerImport[]): Promise<void> => {
    try {
      await sendWorkerBatch(group);
      createdWorkers.push(...group);
      processedWorkers += group.length;
      onProgress?.(processedWorkers, createdWorkers.length, errors.length);
    } catch (error) {
      if (group.length > 1) {
        const middle = Math.ceil(group.length / 2);
        await runGroup(group.slice(0, middle));
        await runGroup(group.slice(middle));
        return;
      }
      const worker = group[0];
      processedWorkers += 1;
      addWorkerError(errors, {
        workerKey: worker.workerKey,
        username: worker.username,
        phoneBase: worker.workerRow.phoneBase,
        cccdBase: worker.workerRow.cccdBase,
        stage: "PocketBase",
        reason: errorMessage(error),
        workerRow: worker.workerRow,
        historyRows: worker.histories.map((history) => history.row),
      });
      onProgress?.(processedWorkers, createdWorkers.length, errors.length);
    }
  };
  for (const group of packWorkers(workers)) await runGroup(group);
  return {
    createdWorkers,
    errors,
    createdHistoryCount: createdWorkers.reduce(
      (total, worker) => total + worker.histories.length,
      0,
    ),
  };
}

export function downloadBulkWorkerTemplate() {
  exportToExcel(
    "mau_tao_nld_va_lich_su_di_lam",
    {
      "Người lao động": [
        {
          "Mã NLĐ trong file": "NLD001",
          "Họ và tên": "Nguyễn Văn A",
          "Số điện thoại": "0901234567_nva",
          CCCD: "001234567890.a",
          "Ngày sinh": "15/01/1990",
          "Ngày cấp CCCD": "01/01/2020",
          "Địa chỉ thường trú": "Hà Nội",
          "Giới tính": "Nam",
          "Ngân hàng": "VCB",
          "Số tài khoản": "1234567890",
          "Tên tài khoản": "NGUYEN VAN A",
          "Ghi chú STK": "Tài khoản nhận lương",
        },
      ],
      "Lịch sử đi làm": [
        {
          "Mã NLĐ trong file": "NLD001",
          "Tên nhà máy": "Nhà máy A",
          "Mã nhà máy": "",
          "Nhà chính": "Nhà chính HN",
          "Người tuyển": "staff01",
          "Mã nhân viên": "NM001",
          "Ngày vào làm": "01/01/2025",
          "Ngày nghỉ": "31/12/2025",
          "Mã số thuế": "0123456789",
          "Ghi chú": "Lịch sử cũ",
        },
        {
          "Mã NLĐ trong file": "NLD001",
          "Tên nhà máy": "Nhà máy B",
          "Mã nhà máy": "",
          "Nhà chính": "Nhà chính HN",
          "Người tuyển": "staff01",
          "Mã nhân viên": "NM002",
          "Ngày vào làm": "01/01/2026",
          "Ngày nghỉ": "",
          "Mã số thuế": "0123456789",
          "Ghi chú": "Lịch sử hiện tại",
        },
      ],
    },
    {
      "Người lao động": ["Ngày sinh", "Ngày cấp CCCD"],
      "Lịch sử đi làm": ["Ngày vào làm", "Ngày nghỉ"],
    },
  );
}

export function exportBulkWorkerErrors(errors: WorkerImportError[], filename = "") {
  const workerRows = errors.map((error) => ({
    Dòng: error.workerRow?.rowNumber || "",
    "Mã NLĐ trong file": error.workerKey,
    "Tên đăng nhập dự kiến": error.username || error.workerRow?.accountIdentity || "",
    "SĐT đã chuẩn hóa": error.phoneBase || error.workerRow?.phoneBase || "",
    "CCCD đã chuẩn hóa": error.cccdBase || error.workerRow?.cccdBase || "",
    "Giai đoạn lỗi": error.stage,
    "Lý do lỗi": error.reason,
    ...(error.workerRow?.raw || {}),
  }));
  const historyRows = errors.flatMap((error) =>
    error.historyRows.map((history) => ({
      Dòng: history.rowNumber,
      "Mã NLĐ trong file": error.workerKey,
      "Tên đăng nhập dự kiến": error.username || "",
      "Giai đoạn lỗi": error.stage,
      "Lý do lỗi": error.reason,
      ...history.raw,
    })),
  );
  exportToExcel(
    filename || `import_nld_lich_su_loi_${Date.now()}`,
    {
      "NLĐ lỗi": workerRows.length ? workerRows : [{ "Lý do lỗi": "Không có dòng NLĐ lỗi" }],
      "Lịch sử lỗi": historyRows.length
        ? historyRows
        : [{ "Lý do lỗi": "Không có dòng lịch sử lỗi" }],
    },
    {
      "NLĐ lỗi": ["Ngày sinh", "Ngày cấp CCCD", "date_of_birth", "cccd_issue_date"],
      "Lịch sử lỗi": ["Ngày vào làm", "Ngày nghỉ", "join_date", "leave_date"],
    },
  );
}
