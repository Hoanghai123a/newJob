import { createFileRoute, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { fileUrl, pb } from "@/lib/pocketbase";
import { useAuth } from "@/lib/auth";
import { companyFilter, companyIdOf } from "@/lib/tenant";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { WorkerPayrollView } from "@/components/payroll/WorkerPayrollView";
import { EmptyState } from "@/components/ui/empty-state";
import { DataLoadingState } from "@/components/ui/data-loading-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatVND, type AttendanceRow, type RateBuckets, type Shift } from "@/lib/salary";
import { exportToExcel } from "@/lib/excel";
import { escapePb } from "@/lib/delegations";
import { accountIdentityKey } from "@/lib/account-identity";
import { fetchEmploymentHistories, type EmploymentHistoryRecord } from "@/lib/employment";
import { markSeen } from "@/lib/seen";
import {
  buildPayrollCalendarCells,
  fetchFactoryAttendanceCutoffDay,
  getPayrollPeriod,
  type PayrollPeriod,
} from "@/lib/payroll-cycle";
import { cn } from "@/lib/utils";
import {
  CalendarCheck,
  FileDown,
  FileSpreadsheet,
  Moon,
  Send,
  Sun,
  Upload,
  Wallet,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { getUserErrorMessage } from "@/lib/toast";

export const Route = createFileRoute("/_authenticated/check-attendance")({
  beforeLoad: () => {
    throw redirect({ to: "/staff/workers" });
  },
  component: CheckAttendancePage,
});

type BatchRecord = {
  id: string;
  month: string;
  round_no: number;
  note?: string;
  total_users?: number;
  total_rows?: number;
  source_file?: string;
  created?: string;
  collectionId: string;
  collectionName: string;
};

type CheckItemRecord = {
  id: string;
  batch: string;
  user: string;
  month: string;
  round_no: number;
  full_name?: string;
  rows: CheckAttendanceRow[];
  summary?: Partial<RateBuckets>;
  created?: string;
  expand?: { batch?: BatchRecord };
};

type SalaryPersonalInfo = {
  employee_code: string;
  company: string;
  full_name?: string;
  start_date: string;
  end_date: string;
  base_salary: number;
  standard_workdays: number;
};

type SalaryWageLine = {
  rate: string;
  hours: number;
  amount: number;
};

type SalaryMoneyLine = {
  label: string;
  amount: number;
};

type SalaryTotals = {
  wage: number;
  allowance: number;
  deduction: number;
  net: number;
};

type SalaryItemRecord = {
  id: string;
  batch: string;
  user: string;
  month: string;
  round_no: number;
  personal: SalaryPersonalInfo;
  wage_lines: SalaryWageLine[];
  allowance_lines: SalaryMoneyLine[];
  deduction_lines: SalaryMoneyLine[];
  totals: SalaryTotals;
  created?: string;
  expand?: { batch?: BatchRecord };
};

type UserRecord = {
  id: string;
  uid?: string;
  full_name?: string;
  username?: string;
  phone?: string;
};

type CheckAttendanceRow = AttendanceRow;

type ParsedRow = CheckAttendanceRow & {
  uid: string;
  employeeCode: string;
  company: string;
  fullName: string;
  rates: RateBuckets;
};

type ParsedSalaryRow = {
  uid: string;
  employeeCode: string;
  company: string;
  personal: SalaryPersonalInfo;
  wageLines: SalaryWageLine[];
  allowanceLines: SalaryMoneyLine[];
  deductionLines: SalaryMoneyLine[];
};

const EMPTY_CHECK_BUCKETS = (): RateBuckets => ({
  r100: 0,
  r130: 0,
  r150: 0,
  r200: 0,
  r270: 0,
  r300: 0,
  r390: 0,
});

function normalizeBuckets(summary?: Partial<RateBuckets>) {
  return {
    ...EMPTY_CHECK_BUCKETS(),
    ...(summary || {}),
  };
}

function hasRateValues(rates: RateBuckets) {
  return Object.values(rates).some((value) => Number(value) > 0);
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function ym(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function todayMonth() {
  return ym(new Date());
}

function monthStringToDate(month: string) {
  const [year, monthValue] = month.split("-").map(Number);
  return new Date(year || new Date().getFullYear(), (monthValue || 1) - 1, 1);
}

function formatTemplateDate(month: string, day: number) {
  const [year, monthValue] = month.split("-");
  return `${pad(day)}/${pad(Number(monthValue))}/${year}`;
}

function formatDisplayDate(value?: string) {
  if (!value) return "—";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

const normalize = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]/g, "");

const pick = (row: Record<string, unknown>, keys: string[]) => {
  const normalized = new Map(Object.keys(row).map((key) => [normalize(key), key]));
  for (const key of keys) {
    const sourceKey = normalized.get(normalize(key));
    if (sourceKey) return row[sourceKey];
  }
  return "";
};

function parseExcelDate(value: unknown) {
  if (typeof value === "number") {
    const d = XLSX.SSF.parse_date_code(value);
    if (d) return `${d.y}-${pad(d.m)}-${pad(d.d)}`;
  }
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${pad(Number(iso[2]))}-${pad(Number(iso[3]))}`;
  const vn = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (vn) return `${vn[3]}-${pad(Number(vn[2]))}-${pad(Number(vn[1]))}`;
  return raw.substring(0, 10);
}

function parseShift(value: unknown): Shift {
  const text = normalize(value);
  return text.includes("dem") || text.includes("night") ? "night" : "day";
}

function parseBool(value: unknown) {
  const text = normalize(value);
  return ["1", "x", "yes", "true", "le", "holiday"].includes(text);
}

function parseNumber(value: unknown) {
  if (typeof value === "number") return value;
  let text = String(value ?? "").trim();
  if (!text) return 0;
  text = text.replace(/\s/g, "").replace(/[^\d,.-]/g, "");
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    text = lastComma > lastDot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (lastComma >= 0) {
    text = text.replace(",", ".");
  } else if ((text.match(/\./g) || []).length > 1) {
    text = text.replace(/\./g, "");
  } else if (/^\d{1,3}\.\d{3}$/.test(text)) {
    text = text.replace(".", "");
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function calculateSalaryTotals({
  wageLines,
  allowanceLines,
  deductionLines,
}: {
  wageLines: SalaryWageLine[];
  allowanceLines: SalaryMoneyLine[];
  deductionLines: SalaryMoneyLine[];
}): SalaryTotals {
  const wage = wageLines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const allowance = allowanceLines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const deduction = deductionLines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  return {
    wage,
    allowance,
    deduction,
    net: wage + allowance - deduction,
  };
}

function formatSalaryRate(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.includes("%")) return raw;

  const numeric = parseNumber(raw);
  if (!numeric) return raw;

  const percent = numeric <= 10 ? numeric * 100 : numeric;
  return `${Number.isInteger(percent) ? percent : Number(percent.toFixed(2))}%`;
}

async function readAttendanceExcel(file: File): Promise<ParsedRow[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  return rawRows
    .map((row) => {
      const uid = String(
        pick(row, ["Mã tài khoản (UID)", "uid", "UID", "userId", "user_id"]),
      ).trim();
      const employeeCode = String(
        pick(row, ["Mã nhân viên", "Mã NV", "Ma NV", "employee_code"]),
      ).trim();
      const rates = {
        r100: parseNumber(pick(row, ["100%", "100", "r100"])),
        r130: parseNumber(pick(row, ["130%", "130", "r130"])),
        r150: parseNumber(pick(row, ["150%", "150", "r150"])),
        r200: parseNumber(pick(row, ["200%", "200", "r200"])),
        r270: parseNumber(pick(row, ["270%", "270", "r270"])),
        r300: parseNumber(pick(row, ["300%", "300", "r300"])),
        r390: parseNumber(pick(row, ["390%", "390", "r390"])),
      };
      return {
        uid,
        employeeCode,
        company: String(pick(row, ["Nhà máy", "Công ty", "company", "factory"])).trim(),
        fullName: String(pick(row, ["Họ tên", "Họ và tên", "full_name"])).trim(),
        rates,
        date: parseExcelDate(pick(row, ["Ngày", "date", "Ngày công"])),
        shift: parseShift(pick(row, ["Ca", "shift"])),
        is_holiday: parseBool(pick(row, ["Lễ", "Ngày lễ", "is_holiday", "holiday"])),
        hc_hours: parseNumber(pick(row, ["Giờ HC", "HC", "hc_hours", "Giờ hành chính"])),
        ot_hours: parseNumber(pick(row, ["Giờ TC", "TC", "ot_hours", "Giờ tăng ca"])),
      };
    })
    .filter(
      (row) =>
        (row.uid || (row.employeeCode && row.company)) && (row.date || hasRateValues(row.rates)),
    );
}

function parseRateNumber(rate: string) {
  const match = rate.replace(/\s/g, "").match(/-?\d+(?:[.,]\d+)?/);
  if (!match) return 0;
  const value = Number(match[0].replace(",", "."));
  return Number.isFinite(value) ? value : 0;
}

function stripPrefix(key: string, prefix: "HC" | "PC" | "KT") {
  const pattern = new RegExp(`^${prefix}[_\\s-]+(.+)$`, "i");
  const match = key.trim().match(pattern);
  return match ? match[1].trim() : null;
}

async function readSalaryExcel(file: File): Promise<ParsedSalaryRow[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  return rawRows
    .map((row) => {
      const uid = String(
        pick(row, ["Mã tài khoản (UID)", "uid", "UID", "userId", "user_id"]),
      ).trim();
      const employeeCode = String(
        pick(row, ["Mã nhân viên", "Mã NV", "Ma NV", "employee_code"]),
      ).trim();
      const company = String(pick(row, ["Nhà máy", "Công ty", "company", "factory"])).trim();
      const fullName = String(pick(row, ["Họ tên", "Họ và tên", "full_name"])).trim();
      const baseSalary = parseNumber(pick(row, ["Lương cơ bản", "Luong co ban", "base_salary"]));
      const unit = baseSalary / 26 / 8;

      const wageLines: SalaryWageLine[] = [];
      const allowanceLines: SalaryMoneyLine[] = [];
      const deductionLines: SalaryMoneyLine[] = [];

      for (const [key, value] of Object.entries(row)) {
        const hcLabel = stripPrefix(key, "HC");
        if (hcLabel) {
          const hours = parseNumber(value);
          if (hours > 0) {
            const rate = formatSalaryRate(hcLabel);
            const ratePercent = parseRateNumber(rate);
            wageLines.push({
              rate,
              hours,
              amount: Math.round(unit * (ratePercent / 100) * hours),
            });
          }
          continue;
        }
        const pcLabel = stripPrefix(key, "PC");
        if (pcLabel) {
          const amount = parseNumber(value);
          if (amount > 0) allowanceLines.push({ label: pcLabel, amount });
          continue;
        }
        const ktLabel = stripPrefix(key, "KT");
        if (ktLabel) {
          const amount = parseNumber(value);
          if (amount > 0) deductionLines.push({ label: ktLabel, amount });
        }
      }

      return {
        uid,
        employeeCode,
        company,
        personal: {
          employee_code: employeeCode,
          company,
          full_name: fullName,
          start_date: parseExcelDate(pick(row, ["Ngày vào làm", "Ngay vao lam", "start_date"])),
          end_date: parseExcelDate(pick(row, ["Ngày nghỉ", "Ngay nghi", "end_date"])),
          base_salary: baseSalary,
          standard_workdays: parseNumber(
            pick(row, ["Số công HC", "So cong HC", "standard_workdays"]),
          ),
        },
        wageLines,
        allowanceLines,
        deductionLines,
      };
    })
    .filter(
      (row) =>
        (row.uid || (row.employeeCode && row.company)) &&
        (row.wageLines.length || row.allowanceLines.length || row.deductionLines.length),
    );
}

function employeeCompanyKey(employeeCode?: string, company?: string) {
  const code = normalize(employeeCode);
  const factory = normalize(company);
  return code && factory ? `${code}::${factory}` : "";
}

function CheckAttendancePage() {
  const { isAdmin, user } = useAuth();
  return isAdmin ? <AdminCheckAttendance viewer={user} /> : <UserCheckAttendance />;
}

function AdminCheckAttendance({
  viewer,
}: {
  viewer: import("@/lib/pocketbase").UserRecord | null;
}) {
  const [month, setMonth] = useState(todayMonth());
  const [note, setNote] = useState("");
  const [salaryMonth, setSalaryMonth] = useState(todayMonth());
  const [salaryNote, setSalaryNote] = useState("");
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [salaryBatches, setSalaryBatches] = useState<BatchRecord[]>([]);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [histories, setHistories] = useState<EmploymentHistoryRecord[]>([]);
  const [uploading, setUploading] = useState(false);
  const [salaryUploading, setSalaryUploading] = useState(false);

  const load = async () => {
    const [batchRes, userRes, historyRows] = await Promise.all([
      pb.collection("check_attendance_batches").getList(1, 100, {
        filter: `${companyFilter(viewer)} && month="${month}"`,
        sort: "-created",
      }),
      pb.collection("workers").getList(1, 500, { filter: companyFilter(viewer, "company"), sort: "full_name" }),
      fetchEmploymentHistories(),
    ]);
    setBatches(batchRes.items as unknown as BatchRecord[]);
    setUsers(userRes.items as unknown as UserRecord[]);
    setHistories(historyRows);
    try {
      const salaryBatchRes = await pb
        .collection("check_salary_batches")
        .getList(1, 100, {
          filter: `${companyFilter(viewer)} && month="${salaryMonth}"`,
          sort: "-created",
        });
      setSalaryBatches(salaryBatchRes.items as unknown as BatchRecord[]);
    } catch {
      setSalaryBatches([]);
    }
  };

  useEffect(() => {
    load().catch((error) => toast.error(error?.message || "Không tải được dữ liệu check công"));
  }, [month, salaryMonth]);

  const monthBatches = batches.filter((batch) => batch.month === month);
  const nextRound =
    monthBatches.reduce((max, batch) => Math.max(max, Number(batch.round_no) || 0), 0) + 1;
  const salaryMonthBatches = salaryBatches.filter((batch) => batch.month === salaryMonth);
  const nextSalaryRound =
    salaryMonthBatches.reduce((max, batch) => Math.max(max, Number(batch.round_no) || 0), 0) + 1;

  const downloadTemplate = () => {
    const sampleUser = users[0];
    const sampleHistory = sampleUser
      ? histories.find((history) => history.user === sampleUser.id)
      : null;
    exportToExcel(
      `mau_check_cong_${month}`,
      {
        "Bảng kiểm công": [
          {
            "Mã tài khoản (UID)": sampleUser?.uid || "HL000000",
            "Mã nhân viên": sampleHistory?.employee_code || "NV001",
            "Nhà máy": sampleHistory?.expand?.factory?.name || "Nhà máy A",
            "Số điện thoại": sampleUser?.phone || "0900000000",
            "Họ tên": sampleUser?.full_name || "Nguyễn Văn A",
            Ngày: formatTemplateDate(month, 1),
            Ca: "Ngày",
            Lễ: "",
            "Giờ hành chính": 8,
            "Giờ tăng ca": 2,
            "100%": 10,
            "130%": 6,
            "150%": 2,
            "200%": 0,
            "270%": 0,
            "300%": 8,
            "390%": 0,
          },
          {
            "Mã tài khoản (UID)": sampleUser?.uid || "HL000000",
            "Mã nhân viên": sampleHistory?.employee_code || "NV001",
            "Nhà máy": sampleHistory?.expand?.factory?.name || "Nhà máy A",
            "Số điện thoại": sampleUser?.phone || "0900000000",
            "Họ tên": sampleUser?.full_name || "Nguyễn Văn A",
            Ngày: formatTemplateDate(month, 2),
            Ca: "Đêm",
            Lễ: "",
            "Giờ hành chính": 8,
            "Giờ tăng ca": 1,
            "100%": "",
            "130%": "",
            "150%": "",
            "200%": "",
            "270%": "",
            "300%": "",
            "390%": "",
          },
          {
            "Mã tài khoản (UID)": sampleUser?.uid || "HL000000",
            "Mã nhân viên": sampleHistory?.employee_code || "NV001",
            "Nhà máy": sampleHistory?.expand?.factory?.name || "Nhà máy A",
            "Số điện thoại": sampleUser?.phone || "0900000000",
            "Họ tên": sampleUser?.full_name || "Nguyễn Văn A",
            Ngày: formatTemplateDate(month, 3),
            Ca: "Ngày",
            Lễ: "x",
            "Giờ hành chính": 8,
            "Giờ tăng ca": 0,
            "100%": "",
            "130%": "",
            "150%": "",
            "200%": "",
            "270%": "",
            "300%": "",
            "390%": "",
          },
        ],
      },
      { "Bảng kiểm công": ["Ngày"] },
    );
  };

  const onUpload = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const parsedRows = await readAttendanceExcel(file);
      if (!parsedRows.length) {
        toast.error("File không có dòng công hợp lệ");
        return;
      }

      const [allUsers, allHistories] = await Promise.all([
        pb
          .collection("workers")
          .getFullList<UserRecord>({ filter: companyFilter(viewer, "company"), sort: "full_name" }),
        fetchEmploymentHistories(),
      ]);
      const userById = new Map(allUsers.map((user) => [user.id, user]));
      const employeeMap = new Map<string, UserRecord | null>();
      const userIdMap = new Map<string, UserRecord>();
      for (const user of allUsers) {
        if (user.uid) userIdMap.set(accountIdentityKey(user.uid), user);
      }
      for (const history of allHistories) {
        const user = userById.get(history.user);
        const employeeKey = employeeCompanyKey(
          history.employee_code,
          history.expand?.factory?.name,
        );
        if (!user || !employeeKey) continue;
        employeeMap.set(employeeKey, employeeMap.has(employeeKey) ? null : user);
      }

      const grouped = new Map<
        string,
        { user: UserRecord; fullName: string; rows: CheckAttendanceRow[]; summary: RateBuckets }
      >();
      const unmatchedRows: Array<Record<string, unknown>> = [];

      for (const row of parsedRows) {
        const user = row.uid
          ? userIdMap.get(accountIdentityKey(row.uid))
          : employeeMap.get(employeeCompanyKey(row.employeeCode, row.company));
        if (!user) {
          unmatchedRows.push({
            "Lý do lỗi": "Không khớp được nhân sự theo UID hoặc mã nhân viên + nhà máy",
            "Mã tài khoản (UID)": row.uid,
            "Mã nhân viên": row.employeeCode,
            "Nhà máy": row.company,
            Ngày: formatDisplayDate(row.date),
          });
          continue;
        }
        const current = grouped.get(user.id) || {
          user,
          fullName: "",
          rows: [],
          summary: EMPTY_CHECK_BUCKETS(),
        };
        if (!current.fullName && row.fullName) current.fullName = row.fullName;
        if (!hasRateValues(current.summary) && hasRateValues(row.rates)) {
          current.summary = row.rates;
        }
        if (row.date) {
          current.rows.push({
            date: row.date,
            shift: row.shift,
            is_holiday: row.is_holiday,
            hc_hours: row.hc_hours,
            ot_hours: row.ot_hours,
          });
        }
        grouped.set(user.id, current);
      }

      if (!grouped.size) {
        toast.error("Không khớp được nhân sự nào từ file Excel");
        return;
      }

      const formData = new FormData();
      formData.append("tenant_company", companyIdOf(viewer));
      formData.append("month", month);
      formData.append("round_no", String(nextRound));
      formData.append("note", note);
      formData.append("total_users", String(grouped.size));
      formData.append("total_rows", String(parsedRows.length));
      formData.append("source_file", file);

      const batch = (await pb
        .collection("check_attendance_batches")
        .create(formData)) as unknown as BatchRecord;

      for (const { user, fullName, rows, summary } of grouped.values()) {
        rows.sort((a, b) => a.date.localeCompare(b.date));
        await pb.collection("check_attendance_items").create({
          tenant_company: companyIdOf(viewer),
          batch: batch.id,
          user: user.id,
          month,
          round_no: nextRound,
          full_name: fullName,
          rows,
          summary,
        });
      }

      toast.success(
        `Đã gửi check công lần ${nextRound} cho ${grouped.size} nhân sự${
          unmatchedRows.length ? `, ${unmatchedRows.length} dòng chưa khớp` : ""
        }`,
      );
      if (unmatchedRows.length) {
        exportToExcel(
          `check_cong_loi_${month}_${Date.now()}`,
          { "Dòng lỗi": unmatchedRows },
          { "Dòng lỗi": ["Ngày"] },
        );
        toast.warning("Đã xuất file các dòng check công chưa khớp");
      }
      setNote("");
      await load();
    } catch (error: unknown) {
      toast.error(getUserErrorMessage(error, "Không nhập được file check công"));
    } finally {
      setUploading(false);
    }
  };

  const downloadSalaryTemplate = () => {
    const sampleUser = users[0];
    const sampleHistory = sampleUser
      ? histories.find((history) => history.user === sampleUser.id)
      : null;
    exportToExcel(
      `mau_check_luong_${salaryMonth}`,
      {
        "Bảng kiểm lương": [
          {
            "Mã tài khoản (UID)": sampleUser?.uid || "HL000000",
            "Mã nhân viên": sampleHistory?.employee_code || "NV001",
            "Nhà máy": sampleHistory?.expand?.factory?.name || "Nhà máy A",
            "Họ tên": sampleUser?.full_name || "Nguyễn Văn A",
            "Ngày vào làm": formatTemplateDate(salaryMonth, 1),
            "Ngày nghỉ": "",
            "Lương cơ bản": 5000000,
            "Số công HC": 26,
            "HC_100%": 208,
            "HC_130%": 12,
            "HC_150%": 10,
            "HC_200%": "",
            "HC_270%": "",
            "HC_300%": "",
            "HC_390%": "",
            "PC_Đời sống": 300000,
            "PC_Chuyên cần": 500000,
            KT_BHXH: 525000,
            KT_Ứng: 200000,
          },
        ],
      },
      { "Bảng kiểm lương": ["Ngày vào làm", "Ngày nghỉ"] },
    );
  };

  const onSalaryUpload = async (file?: File) => {
    if (!file) return;
    setSalaryUploading(true);
    try {
      const parsedRows = await readSalaryExcel(file);
      if (!parsedRows.length) {
        toast.error("File không có dòng lương hợp lệ");
        return;
      }

      const [allUsers, allHistories] = await Promise.all([
        pb
          .collection("workers")
          .getFullList<UserRecord>({ filter: companyFilter(viewer, "company"), sort: "full_name" }),
        fetchEmploymentHistories(),
      ]);
      const userById = new Map(allUsers.map((user) => [user.id, user]));
      const employeeMap = new Map<string, UserRecord | null>();
      const userIdMap = new Map<string, UserRecord>();
      for (const user of allUsers) {
        if (user.uid) userIdMap.set(accountIdentityKey(user.uid), user);
      }
      for (const history of allHistories) {
        const user = userById.get(history.user);
        const employeeKey = employeeCompanyKey(
          history.employee_code,
          history.expand?.factory?.name,
        );
        if (!user || !employeeKey) continue;
        employeeMap.set(employeeKey, employeeMap.has(employeeKey) ? null : user);
      }

      const grouped = new Map<
        string,
        {
          user: UserRecord;
          personal: SalaryPersonalInfo;
          wageLines: SalaryWageLine[];
          allowanceLines: SalaryMoneyLine[];
          deductionLines: SalaryMoneyLine[];
        }
      >();
      const unmatchedRows: Array<Record<string, unknown>> = [];

      for (const row of parsedRows) {
        const user = row.uid
          ? userIdMap.get(accountIdentityKey(row.uid))
          : employeeMap.get(employeeCompanyKey(row.employeeCode, row.company));
        if (!user) {
          unmatchedRows.push({
            "Lý do lỗi": "Không khớp được nhân sự theo UID hoặc mã nhân viên + nhà máy",
            "Mã tài khoản (UID)": row.uid,
            "Mã nhân viên": row.employeeCode,
            "Nhà máy": row.company,
            "Ngày vào làm": formatDisplayDate(row.personal.start_date),
            "Ngày nghỉ": formatDisplayDate(row.personal.end_date),
          });
          continue;
        }
        const current =
          grouped.get(user.id) ||
          ({
            user,
            personal: row.personal,
            wageLines: [],
            allowanceLines: [],
            deductionLines: [],
          } satisfies {
            user: UserRecord;
            personal: SalaryPersonalInfo;
            wageLines: SalaryWageLine[];
            allowanceLines: SalaryMoneyLine[];
            deductionLines: SalaryMoneyLine[];
          });

        current.personal = {
          employee_code: current.personal.employee_code || row.personal.employee_code,
          company: current.personal.company || row.personal.company,
          full_name: current.personal.full_name || row.personal.full_name,
          start_date: current.personal.start_date || row.personal.start_date,
          end_date: current.personal.end_date || row.personal.end_date,
          base_salary: current.personal.base_salary || row.personal.base_salary,
          standard_workdays: current.personal.standard_workdays || row.personal.standard_workdays,
        };
        current.wageLines.push(...row.wageLines);
        current.allowanceLines.push(...row.allowanceLines);
        current.deductionLines.push(...row.deductionLines);
        grouped.set(user.id, current);
      }

      if (!grouped.size) {
        toast.error("Không khớp được nhân sự nào từ file Excel lương");
        return;
      }

      const formData = new FormData();
      formData.append("tenant_company", companyIdOf(viewer));
      formData.append("month", salaryMonth);
      formData.append("round_no", String(nextSalaryRound));
      formData.append("note", salaryNote);
      formData.append("total_users", String(grouped.size));
      formData.append("total_rows", String(parsedRows.length));
      formData.append("source_file", file);

      const batch = (await pb
        .collection("check_salary_batches")
        .create(formData)) as unknown as BatchRecord;

      for (const item of grouped.values()) {
        const totals = calculateSalaryTotals({
          wageLines: item.wageLines,
          allowanceLines: item.allowanceLines,
          deductionLines: item.deductionLines,
        });
        await pb.collection("check_salary_items").create({
          batch: batch.id,
          user: item.user.id,
          month: salaryMonth,
          round_no: nextSalaryRound,
          personal: item.personal,
          wage_lines: item.wageLines,
          allowance_lines: item.allowanceLines,
          deduction_lines: item.deductionLines,
          totals,
        });
      }

      toast.success(
        `Đã gửi check lương lần ${nextSalaryRound} cho ${grouped.size} nhân sự${
          unmatchedRows.length ? `, ${unmatchedRows.length} dòng chưa khớp` : ""
        }`,
      );
      if (unmatchedRows.length) {
        exportToExcel(
          `check_luong_loi_${salaryMonth}_${Date.now()}`,
          {
            "Dòng lỗi": unmatchedRows,
          },
          { "Dòng lỗi": ["Ngày vào làm", "Ngày nghỉ"] },
        );
        toast.warning("Đã xuất file các dòng check lương chưa khớp");
      }
      setSalaryNote("");
      await load();
    } catch (error: unknown) {
      toast.error(getUserErrorMessage(error, "Không nhập được file check lương"));
    } finally {
      setSalaryUploading(false);
    }
  };

  return (
    <PageContainer title="Check công/lương" subtitle="Gửi bảng check công từ Excel">
      <Tabs defaultValue="attendance" className="space-y-4">
        <TabsList className="sticky top-[calc(env(safe-area-inset-top)+3.25rem)] z-20 grid w-full grid-cols-2 gap-1">
          <TabsTrigger
            value="attendance"
            className="min-w-0 w-full rounded-lg bg-muted text-xs shadow-sm"
          >
            Check công
          </TabsTrigger>
          <TabsTrigger
            value="salary"
            className="min-w-0 w-full rounded-lg bg-muted text-xs shadow-sm"
          >
            Check lương
          </TabsTrigger>
        </TabsList>

        <TabsContent value="attendance" className="mt-0 space-y-4">
          <Card className="space-y-3 p-4">
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">Gửi check công</div>
                <div className="text-[11px] text-muted-foreground">
                  Tháng {month} · lần gửi tiếp theo: {nextRound}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Tháng</Label>
                <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Ghi chú</Label>
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Tuỳ chọn"
                />
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <label className="block">
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  disabled={uploading}
                  onChange={(event) => {
                    onUpload(event.target.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                />
                <span className="inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground shadow active:scale-[0.98]">
                  <Upload className="h-4 w-4" />
                  {uploading ? "Đang gửi..." : "Chọn file Excel và gửi"}
                </span>
              </label>
              <Button type="button" variant="outline" onClick={downloadTemplate}>
                <FileDown className="h-4 w-4" />
                Tải mẫu
              </Button>
            </div>
          </Card>

          <AdminBatchHistory
            batches={batches}
            icon={CalendarCheck}
            title="Lịch sử gửi"
            emptyTitle="Chưa có lần gửi check công"
            emptyDescription="Sau khi admin nhập Excel, lịch sử gửi sẽ hiển thị tại đây."
          />
        </TabsContent>

        <TabsContent value="salary" className="mt-0 space-y-4">
          <Card className="space-y-3 p-4">
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Wallet className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">Gửi check lương</div>
                <div className="text-[11px] text-muted-foreground">
                  Tháng {salaryMonth} · lần gửi tiếp theo: {nextSalaryRound}
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  Cột động: <code>HC_&lt;hệ số&gt;</code> (số giờ), <code>PC_&lt;tên&gt;</code>{" "}
                  (tiền phụ cấp), <code>KT_&lt;tên&gt;</code> (tiền khấu trừ). Thành tiền tự tính =
                  Lương cơ bản / 26 / 8 × hệ số × số giờ.
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Tháng</Label>
                <Input
                  type="month"
                  value={salaryMonth}
                  onChange={(e) => setSalaryMonth(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Ghi chú</Label>
                <Input
                  value={salaryNote}
                  onChange={(e) => setSalaryNote(e.target.value)}
                  placeholder="Tuỳ chọn"
                />
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <label className="block">
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  disabled={salaryUploading}
                  onChange={(event) => {
                    onSalaryUpload(event.target.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                />
                <span className="inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground shadow active:scale-[0.98]">
                  <Upload className="h-4 w-4" />
                  {salaryUploading ? "Đang gửi..." : "Chọn file Excel và gửi"}
                </span>
              </label>
              <Button type="button" variant="outline" onClick={downloadSalaryTemplate}>
                <FileDown className="h-4 w-4" />
                Tải mẫu
              </Button>
            </div>
          </Card>

          <div className="hidden">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Lịch sử gửi
            </div>
            {batches.length === 0 ? (
              <EmptyState
                icon={CalendarCheck}
                title="Chưa có lần gửi check công"
                description="Sau khi admin nhập Excel, lịch sử gửi sẽ hiển thị tại đây."
              />
            ) : (
              batches.map((batch) => (
                <Card key={batch.id} className="p-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-secondary text-primary">
                      <Send className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold">
                          {batch.month} · Lần {batch.round_no}
                        </div>
                        <span className="chip chip-info">{batch.total_users || 0} người</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <span className="chip chip-neutral">{batch.total_rows || 0} dòng</span>
                        {batch.created && (
                          <span className="chip chip-neutral">
                            {new Date(batch.created).toLocaleDateString("vi-VN")}
                          </span>
                        )}
                        {batch.source_file && (
                          <a
                            href={fileUrl(batch, batch.source_file)}
                            target="_blank"
                            rel="noreferrer"
                            className="chip chip-info"
                            onClick={(event) => event.stopPropagation()}
                          >
                            File Excel
                          </a>
                        )}
                      </div>
                      {batch.note && (
                        <div className="mt-1 text-[11px] text-muted-foreground">{batch.note}</div>
                      )}
                    </div>
                  </div>
                </Card>
              ))
            )}
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Lịch sử gửi lương
            </div>
            {salaryBatches.length === 0 ? (
              <EmptyState
                icon={Wallet}
                title="Chưa có lần gửi check lương"
                description="Sau khi admin nhập Excel lương, lịch sử gửi sẽ hiển thị tại đây."
              />
            ) : (
              salaryBatches.map((batch) => (
                <Card key={batch.id} className="p-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-secondary text-primary">
                      <Send className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold">
                          {batch.month} · Lần {batch.round_no}
                        </div>
                        <span className="chip chip-info">{batch.total_users || 0} người</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <span className="chip chip-neutral">{batch.total_rows || 0} dòng</span>
                        {batch.created && (
                          <span className="chip chip-neutral">
                            {new Date(batch.created).toLocaleDateString("vi-VN")}
                          </span>
                        )}
                        {batch.source_file && (
                          <a
                            href={fileUrl(batch, batch.source_file)}
                            target="_blank"
                            rel="noreferrer"
                            className="chip chip-info"
                            onClick={(event) => event.stopPropagation()}
                          >
                            File Excel
                          </a>
                        )}
                      </div>
                      {batch.note && (
                        <div className="mt-1 text-[11px] text-muted-foreground">{batch.note}</div>
                      )}
                    </div>
                  </div>
                </Card>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}

function AdminBatchHistory({
  batches,
  icon: Icon,
  title,
  emptyTitle,
  emptyDescription,
}: {
  batches: BatchRecord[];
  icon: typeof CalendarCheck;
  title: string;
  emptyTitle: string;
  emptyDescription: string;
}) {
  const displayTitle = Icon === Wallet ? "Lịch sử gửi lương" : "Lịch sử gửi";
  const displayEmptyTitle =
    Icon === Wallet ? "Chưa có lần gửi check lương" : "Chưa có lần gửi check công";
  const displayEmptyDescription =
    Icon === Wallet
      ? "Sau khi admin nhập Excel lương, lịch sử gửi sẽ hiển thị tại đây."
      : "Sau khi admin nhập Excel, lịch sử gửi sẽ hiển thị tại đây.";

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {displayTitle || title}
      </div>
      {batches.length === 0 ? (
        <EmptyState
          icon={Icon}
          title={displayEmptyTitle || emptyTitle}
          description={displayEmptyDescription || emptyDescription}
        />
      ) : (
        batches.map((batch) => (
          <Card key={batch.id} className="p-3">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-secondary text-primary">
                <Send className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">
                    {batch.month} · Lần {batch.round_no}
                  </div>
                  <span className="chip chip-info">{batch.total_users || 0} người</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  <span className="chip chip-neutral">{batch.total_rows || 0} dòng</span>
                  {batch.created && (
                    <span className="chip chip-neutral">
                      {new Date(batch.created).toLocaleDateString("vi-VN")}
                    </span>
                  )}
                  {batch.source_file && (
                    <a
                      href={fileUrl(batch, batch.source_file)}
                      target="_blank"
                      rel="noreferrer"
                      className="chip chip-info"
                      onClick={(event) => event.stopPropagation()}
                    >
                      File Excel
                    </a>
                  )}
                </div>
                {batch.note && (
                  <div className="mt-1 text-[11px] text-muted-foreground">{batch.note}</div>
                )}
              </div>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}

function UserCheckAttendance() {
  const { user } = useAuth();
  const [items, setItems] = useState<CheckItemRecord[]>([]);
  const [salaryItems, setSalaryItems] = useState<SalaryItemRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const attendanceRes = await pb.collection("check_attendance_items").getList(1, 100, {
        filter: `user="${escapePb(user.id)}"`,
        sort: "-created",
        expand: "batch",
      });
      const salaryRes = await pb
        .collection("check_salary_items")
        .getList(1, 100, {
          filter: `user="${escapePb(user.id)}"`,
          sort: "-created",
          expand: "batch",
        })
        .catch(() => ({ items: [] }));

      const normalized = (attendanceRes.items as unknown as CheckItemRecord[]).map((item) => ({
        ...item,
        rows: Array.isArray(item.rows) ? item.rows : [],
      }));
      const normalizedSalary = (salaryRes.items as unknown as SalaryItemRecord[]).map((item) => ({
        ...item,
        wage_lines: Array.isArray(item.wage_lines) ? item.wage_lines : [],
        allowance_lines: Array.isArray(item.allowance_lines) ? item.allowance_lines : [],
        deduction_lines: Array.isArray(item.deduction_lines) ? item.deduction_lines : [],
        totals: item.totals || { wage: 0, allowance: 0, deduction: 0, net: 0 },
      }));
      setItems(normalized);
      setSalaryItems(normalizedSalary);

      const latest = [...normalized, ...normalizedSalary].reduce(
        (max, item) => Math.max(max, item.created ? new Date(item.created).getTime() : 0),
        0,
      );
      markSeen("check-attendance", user.id, latest || Date.now());
    } catch (error: unknown) {
      toast.error(getUserErrorMessage(error, "Không tải Được check công/lương"));
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <PageContainer title="Check công/lương" subtitle="Bảng check công admin gửi">
      {loading && items.length === 0 && salaryItems.length === 0 ? (
        <DataLoadingState variant="list" label="Đang tải bảng check công và lương..." rows={3} />
      ) : (
        <>
          {loading && (
            <DataLoadingState variant="inline" label="Đang cập nhật bảng check công và lương..." />
          )}
          <WorkerPayrollView attendanceItems={items} salaryItems={salaryItems} loading={loading} />
        </>
      )}
    </PageContainer>
  );
}
