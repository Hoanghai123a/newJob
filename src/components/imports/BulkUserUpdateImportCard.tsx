import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { AlertTriangle, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { ResponsiveOverlay } from "@/components/layout/ResponsiveOverlay";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { exportToExcel } from "@/lib/excel";
import { normalizeDate } from "@/lib/date-utils";
import { createStaffActionLog } from "@/lib/staff-log";
import { updateUserAndCache } from "@/lib/employment";
import { pb, type UserRecord } from "@/lib/pocketbase";
import { accountIdentityKey } from "@/lib/account-identity";
import { toast } from "@/lib/toast";

const CLEAR_VALUE = "[x\u00f3a]";
const UID_HEADER = "M\u00e3 t\u00e0i kho\u1ea3n (UID)";

type FieldKind = "text" | "date" | "number";
type FieldSpec = { field: string; label: string; kind: FieldKind; min?: number; max?: number };

const FIELD_SPECS: FieldSpec[] = [
  { field: "full_name", label: "H\u1ecd v\u00e0 t\u00ean", kind: "text" },
  { field: "phone", label: "S\u1ed1 \u0111i\u1ec7n tho\u1ea1i", kind: "text" },
  { field: "cccd", label: "S\u1ed1 CCCD", kind: "text" },
  { field: "cccd_issue_date", label: "Ng\u00e0y c\u1ea5p CCCD", kind: "date" },
  { field: "gender", label: "Gi\u1edbi t\u00ednh", kind: "text" },
  { field: "date_of_birth", label: "Ng\u00e0y sinh", kind: "date" },
  { field: "address", label: "\u0110\u1ecba ch\u1ec9 th\u01b0\u1eddng tr\u00fa", kind: "text" },
  { field: "bank_name", label: "Ng\u00e2n h\u00e0ng", kind: "text" },
  {
    field: "bank_account_number",
    label: "S\u1ed1 t\u00e0i kho\u1ea3n ng\u00e2n h\u00e0ng",
    kind: "text",
  },
  { field: "bank_account_name", label: "T\u00ean ch\u1ee7 t\u00e0i kho\u1ea3n", kind: "text" },
  {
    field: "bank_account_note",
    label: "Ghi ch\u00fa t\u00e0i kho\u1ea3n ng\u00e2n h\u00e0ng",
    kind: "text",
  },
];

const FIELD_BY_LABEL = new Map(FIELD_SPECS.map((spec) => [spec.label, spec]));

function cellText(value: unknown) {
  return String(value ?? "").trim();
}

function isClearValue(value: unknown) {
  return cellText(value).toLowerCase() === CLEAR_VALUE;
}

function normalizeUid(value: unknown) {
  return accountIdentityKey(cellText(value));
}

function formatErrorRow(
  row: Record<string, unknown>,
  rowNumber: number,
  uid: string,
  reason: string,
) {
  return {
    ...row,
    "D\u00f2ng": rowNumber,
    "UID \u0111\u00e3 chu\u1ea9n h\u00f3a": uid,
    "L\u00fd do l\u1ed7i": reason,
  };
}

function parseValue(spec: FieldSpec, value: unknown) {
  if (isClearValue(value)) return { value: spec.kind === "number" ? null : "" };
  const text = cellText(value);
  if (!text) return { skipped: true } as const;

  if (spec.kind === "date") {
    const normalized = normalizeDate(value);
    return normalized
      ? { value: normalized }
      : { error: `${spec.label} kh\u00f4ng h\u1ee3p l\u1ec7` };
  }

  if (spec.kind === "number") {
    const number = typeof value === "number" ? value : Number(text.replace(/,/g, ""));
    if (!Number.isFinite(number)) return { error: `${spec.label} ph\u1ea3i l\u00e0 s\u1ed1` };
    if (spec.min !== undefined && number < spec.min)
      return {
        error: `${spec.label} kh\u00f4ng \u0111\u01b0\u1ee3c nh\u1ecf h\u01a1n ${spec.min}`,
      };
    if (spec.max !== undefined && number > spec.max)
      return {
        error: `${spec.label} kh\u00f4ng \u0111\u01b0\u1ee3c l\u1edbn h\u01a1n ${spec.max}`,
      };
    return { value: number };
  }

  return { value: text };
}

function downloadErrorFile(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return;
  exportToExcel(`cap_nhat_tai_khoan_loi_${Date.now()}`, { "D\u00f2ng l\u1ed7i": rows });
}

function downloadTemplate() {
  const sample: Record<string, unknown> = { [UID_HEADER]: "HL000001" };
  for (const spec of FIELD_SPECS) sample[spec.label] = "";
  sample["H\u1ecd v\u00e0 t\u00ean"] = "Nguy\u1ec5n V\u0103n A";
  sample["Ng\u00e2n h\u00e0ng"] = "VietinBank - NH TMCP C\u00f4ng th\u01b0\u01a1ng Vi\u1ec7t Nam";
  sample["Ghi ch\u00fa t\u00e0i kho\u1ea3n ng\u00e2n h\u00e0ng"] = CLEAR_VALUE;

  const instructionRows = [
    {
      "N\u1ed9i dung": "C\u1ed9t \u0111\u1ea7u ti\u00ean",
      "H\u01b0\u1edbng d\u1eabn": `B\u1eaft bu\u1ed9c l\u00e0 ${UID_HEADER}.`,
    },
    {
      "N\u1ed9i dung": "\u00d4 tr\u1ed1ng",
      "H\u01b0\u1edbng d\u1eabn":
        "B\u1ecf qua, gi\u1eef nguy\u00ean d\u1eef li\u1ec7u hi\u1ec7n t\u1ea1i.",
    },
    {
      "N\u1ed9i dung": CLEAR_VALUE,
      "H\u01b0\u1edbng d\u1eabn":
        "X\u00f3a d\u1eef li\u1ec7u c\u1ee7a tr\u01b0\u1eddng t\u01b0\u01a1ng \u1ee9ng.",
    },
    {
      "N\u1ed9i dung": "UID",
      "H\u01b0\u1edbng d\u1eabn":
        "Kh\u00f4ng ph\u00e2n bi\u1ec7t ch\u1eef hoa/th\u01b0\u1eddng v\u00e0 t\u1ef1 b\u1ecf kho\u1ea3ng tr\u1eafng \u0111\u1ea7u/cu\u1ed1i.",
    },
    {
      "N\u1ed9i dung": "S\u1ed1 \u0111i\u1ec7n tho\u1ea1i, CCCD, s\u1ed1 t\u00e0i kho\u1ea3n",
      "H\u01b0\u1edbng d\u1eabn":
        "N\u00ean \u0111\u1ecbnh d\u1ea1ng \u00f4 l\u00e0 Text \u0111\u1ec3 gi\u1eef s\u1ed1 0 \u0111\u1ea7u.",
    },
    {
      "N\u1ed9i dung": "Ng\u00e0y",
      "H\u01b0\u1edbng d\u1eabn":
        "D\u00f9ng \u0111\u1ecbnh d\u1ea1ng ng\u00e0y h\u1ee3p l\u1ec7, v\u00ed d\u1ee5 15/01/1990 ho\u1eb7c 1990-01-15.",
    },
    {
      "N\u1ed9i dung": "L\u1ed7i",
      "H\u01b0\u1edbng d\u1eabn":
        "C\u00e1c d\u00f2ng l\u1ed7i s\u1ebd \u0111\u01b0\u1ee3c xu\u1ea5t th\u00e0nh file Excel ri\u00eang sau khi import.",
    },
  ];

  exportToExcel("mau_cap_nhat_thong_tin_tai_khoan", {
    "C\u1eadp nh\u1eadt t\u00e0i kho\u1ea3n": [sample],
    "H\u01b0\u1edbng d\u1eabn": instructionRows,
  });
}

export function BulkUserUpdateImportCard({ actor }: { actor: UserRecord }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [result, setResult] = useState<{ open: boolean; text: string; errors: number }>({
    open: false,
    text: "",
    errors: 0,
  });
  const [lastErrors, setLastErrors] = useState<Array<Record<string, unknown>>>([]);

  const importFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setProcessing(true);
    setResult({ open: false, text: "", errors: 0 });
    setLastErrors([]);

    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new Error("File kh\u00f4ng c\u00f3 sheet d\u1eef li\u1ec7u");
      const sheet = workbook.Sheets[sheetName];
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
      const headerRow = (matrix[0] || []).map(cellText);
      if (headerRow[0] !== UID_HEADER) {
        throw new Error(`C\u1ed9t \u0111\u1ea7u ti\u00ean ph\u1ea3i l\u00e0 "${UID_HEADER}"`);
      }

      const specs: Array<FieldSpec | null> = headerRow.slice(1).map((header) => {
        if (!header) return null;
        return FIELD_BY_LABEL.get(header) || null;
      });
      const invalidHeaders = headerRow
        .slice(1)
        .filter((header) => header && !FIELD_BY_LABEL.has(header));
      const rawRows = matrix.slice(1).map((values) => {
        const row: Record<string, unknown> = {};
        headerRow.forEach((header, index) => {
          if (header) row[header] = values[index] ?? "";
        });
        return row;
      });
      const errors: Array<Record<string, unknown>> = [];
      if (invalidHeaders.length) {
        for (let index = 0; index < rawRows.length; index++) {
          errors.push(
            formatErrorRow(
              rawRows[index],
              index + 2,
              normalizeUid(rawRows[index][UID_HEADER]),
              `C\u1ed9t kh\u00f4ng \u0111\u01b0\u1ee3c h\u1ed7 tr\u1ee3: ${invalidHeaders.join(", ")}`,
            ),
          );
        }
        downloadErrorFile(errors);
        throw new Error(
          `File c\u00f3 c\u1ed9t kh\u00f4ng \u0111\u01b0\u1ee3c h\u1ed7 tr\u1ee3: ${invalidHeaders.join(", ")}`,
        );
      }

      const users = await pb.collection("users").getFullList<UserRecord>({
        fields: ["id", "uid", ...FIELD_SPECS.map((spec) => spec.field)].join(","),
      });
      const usersByUid = new Map<string, UserRecord[]>();
      for (const user of users) {
        const uid = normalizeUid(user.uid);
        if (uid) usersByUid.set(uid, [...(usersByUid.get(uid) || []), user]);
      }
      const fileUidCounts = new Map<string, number>();
      for (const row of rawRows) {
        const uid = normalizeUid(row[UID_HEADER]);
        if (uid) fileUidCounts.set(uid, (fileUidCounts.get(uid) || 0) + 1);
      }

      let updated = 0;
      let skipped = 0;
      let failed = 0;
      setProgress({ current: 0, total: rawRows.length });

      for (const [index, row] of rawRows.entries()) {
        const rowNumber = index + 2;
        const uid = normalizeUid(row[UID_HEADER]);
        const fail = (reason: string) => {
          failed++;
          errors.push(formatErrorRow(row, rowNumber, uid, reason));
        };

        if (!uid) {
          fail(`Thi\u1ebfu ${UID_HEADER}`);
          setProgress({ current: index + 1, total: rawRows.length });
          continue;
        }
        if ((fileUidCounts.get(uid) || 0) > 1) {
          fail("UID b\u1ecb l\u1eb7p trong file Excel");
          setProgress({ current: index + 1, total: rawRows.length });
          continue;
        }
        const matches = usersByUid.get(uid) || [];
        if (matches.length === 0) {
          fail("Kh\u00f4ng t\u00ecm th\u1ea5y user theo UID");
          setProgress({ current: index + 1, total: rawRows.length });
          continue;
        }
        if (matches.length > 1) {
          fail("UID b\u1ecb tr\u00f9ng trong PocketBase");
          setProgress({ current: index + 1, total: rawRows.length });
          continue;
        }

        const payload: Record<string, unknown> = {};
        let rowError = "";
        for (const [columnIndex, spec] of specs.entries()) {
          if (!spec) continue;
          const parsed = parseValue(spec, row[headerRow[columnIndex + 1]]);
          if ("error" in parsed) {
            rowError = parsed.error;
            break;
          }
          if (!("skipped" in parsed)) payload[spec.field] = parsed.value;
        }
        if (rowError) {
          fail(rowError);
          setProgress({ current: index + 1, total: rawRows.length });
          continue;
        }
        if (!Object.keys(payload).length) {
          skipped++;
          setProgress({ current: index + 1, total: rawRows.length });
          continue;
        }

        try {
          await updateUserAndCache(matches[0].id, payload);
          updated++;
        } catch (error) {
          fail(
            error instanceof Error
              ? error.message
              : "Kh\u00f4ng c\u1eadp nh\u1eadt \u0111\u01b0\u1ee3c user",
          );
        }
        setProgress({ current: index + 1, total: rawRows.length });
      }

      if (errors.length) downloadErrorFile(errors);
      const summary = `\u0110\u00e3 c\u1eadp nh\u1eadt ${updated} user; b\u1ecf qua ${skipped} d\u00f2ng; l\u1ed7i ${failed} d\u00f2ng.`;
      setLastErrors(errors);
      setResult({ open: true, text: summary, errors: errors.length });
      toast[errors.length ? "warning" : "success"](summary);
      await createStaffActionLog({
        actor,
        targetCollection: "users",
        action: "import",
        after: { updated, skipped, failed, file: file.name, exported_errors: errors.length },
        note: "Admin c\u1eadp nh\u1eadt th\u00f4ng tin t\u00e0i kho\u1ea3n theo UID t\u1eeb Excel",
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Kh\u00f4ng \u0111\u1ecdc \u0111\u01b0\u1ee3c file Excel";
      setResult({ open: true, text: message, errors: lastErrors.length });
      toast.error(message);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <>
      <Card className="space-y-3 rounded-2xl p-4 shadow-soft">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <FileSpreadsheet className="h-4 w-4 text-primary" />{" "}
          {"C\u1eadp nh\u1eadt th\u00f4ng tin t\u00e0i kho\u1ea3n"}
        </div>
        <p className="text-sm text-muted-foreground">
          {
            "C\u1eadp nh\u1eadt ngay c\u00e1c c\u1ed9t c\u00f3 d\u1eef li\u1ec7u theo M\u00e3 t\u00e0i kho\u1ea3n (UID). \u00d4 tr\u1ed1ng gi\u1eef nguy\u00ean; nh\u1eadp [x\u00f3a] \u0111\u1ec3 x\u00f3a."
          }
        </p>
        {processing && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-primary">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> {"\u0110ang x\u1eed l\u00fd"}{" "}
            {progress.current}/{progress.total} {"d\u00f2ng..."}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="rounded-full"
            onClick={downloadTemplate}
            disabled={processing}
          >
            <Download className="h-4 w-4" /> {"T\u1ea3i file m\u1eabu"}
          </Button>
          <Button
            className="rounded-full"
            onClick={() => inputRef.current?.click()}
            disabled={processing}
          >
            <Upload className="h-4 w-4" /> {"Ch\u1ecdn file c\u1eadp nh\u1eadt"}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={importFile}
          />
        </div>
      </Card>

      <ResponsiveOverlay
        open={result.open}
        onOpenChange={(open) => setResult((current) => ({ ...current, open }))}
        title={"K\u1ebft qu\u1ea3 c\u1eadp nh\u1eadt t\u00e0i kho\u1ea3n"}
        description={
          "C\u00e1c d\u00f2ng h\u1ee3p l\u1ec7 \u0111\u00e3 \u0111\u01b0\u1ee3c c\u1eadp nh\u1eadt ngay v\u00e0o PocketBase."
        }
        presentation="dialog"
        footer={
          <Button
            className="rounded-xl"
            onClick={() => setResult((current) => ({ ...current, open: false }))}
          >
            {"\u0110\u00f3ng"}
          </Button>
        }
      >
        <div className="space-y-3 text-sm">
          <div className="rounded-xl border border-border/60 bg-muted/30 p-3">{result.text}</div>
          {result.errors > 0 && (
            <div className="space-y-3 rounded-xl border border-warning/30 bg-warning/10 p-3 text-warning-foreground">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Đã tự tải file Excel chứa các dòng lỗi để bạn sửa và import lại.</span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() => downloadErrorFile(lastErrors)}
              >
                <Download className="h-4 w-4" /> Tải lại file lỗi
              </Button>
            </div>
          )}
        </div>
      </ResponsiveOverlay>
    </>
  );
}
