import { type ChangeEvent, useRef, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Download,
  Factory as FactoryIcon,
  FileSpreadsheet,
  Loader2,
  Upload,
  UserRoundX,
  UsersRound,
} from "lucide-react";
import { toast } from "@/lib/toast";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  applyBulkWorkerImportReferences,
  downloadBulkWorkerTemplate,
  executePreparedBulkImport,
  exportBulkWorkerErrors,
  inspectBulkWorkerImportReferences,
  prepareBulkWorkerImport,
  type AppliedImportReference,
  type BulkImportReferenceInspection,
  type BulkWorkerImportSummary,
  type WorkerImportError,
} from "@/lib/bulk-worker-history-import";
import type { UserRecord } from "@/lib/pocketbase";
import { clearStaffCache } from "@/lib/staff-cache";
import { createStaffActionLog } from "@/lib/staff-log";
import { getUserErrorMessage } from "@/lib/toast";

type ImportPhase =
  | "idle"
  | "reading"
  | "inspecting"
  | "references"
  | "creatingReferences"
  | "validating"
  | "importing"
  | "done"
  | "error";
type ImportProgress = { total: number; processed: number; created: number; failed: number };

function phaseLabel(phase: ImportPhase) {
  if (phase === "reading") return "Đang đọc file Excel...";
  if (phase === "inspecting") return "Đang kiểm tra Nhà máy, Nhà chính và Người tuyển...";
  if (phase === "references") return "Cần bổ sung dữ liệu";
  if (phase === "creatingReferences") return "Đang tạo dữ liệu còn thiếu...";
  if (phase === "validating") return "Đang kiểm tra dữ liệu...";
  if (phase === "importing") return "Đang tạo hồ sơ và lịch sử...";
  if (phase === "done") return "Đã hoàn tất nhập dữ liệu";
  if (phase === "error") return "Không thể nhập dữ liệu";
  return "Sẵn sàng nhập dữ liệu";
}

function formatDuration(durationMs: number) {
  if (durationMs < 1_000) return `${durationMs} ms`;
  return `${(Math.round(durationMs / 100) / 10).toLocaleString("vi-VN")} giây`;
}

function hasReferenceIssues(inspection: BulkImportReferenceInspection) {
  return Boolean(
    inspection.factories.length || inspection.mainHouses.length || inspection.recruiters.length,
  );
}

function hasReferenceActions(inspection: BulkImportReferenceInspection) {
  return Boolean(inspection.factories.length || inspection.mainHouses.length);
}

export function BulkWorkerHistoryImportCard({ actor }: { actor: UserRecord }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<ImportPhase>("idle");
  const [fileName, setFileName] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<BulkImportReferenceInspection | null>(null);
  const [progress, setProgress] = useState<ImportProgress>({
    total: 0,
    processed: 0,
    created: 0,
    failed: 0,
  });
  const [summary, setSummary] = useState<BulkWorkerImportSummary | null>(null);
  const [errors, setErrors] = useState<WorkerImportError[]>([]);
  const [fatalError, setFatalError] = useState("");
  const busy =
    phase === "reading" ||
    phase === "inspecting" ||
    phase === "creatingReferences" ||
    phase === "validating" ||
    phase === "importing";
  const progressValue = progress.total
    ? Math.min(100, Math.round((progress.processed / progress.total) * 100))
    : 0;

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && busy) return;
    setOpen(nextOpen);
    if (!nextOpen) {
      setPhase("idle");
      setPendingFile(null);
      setInspection(null);
    }
  };

  const logAppliedReferences = async (items: AppliedImportReference[]) => {
    await Promise.all(
      items.map((item) =>
        createStaffActionLog({
          actor,
          targetCollection: item.collection,
          targetRecord: item.id,
          action: item.action === "create" ? "create" : "update",
          after: item.payload,
          note:
            item.collection === "factories"
              ? `Admin ${item.action === "create" ? "tạo" : "kích hoạt lại"} Nhà máy từ import NLĐ: ${item.name}`
              : `Admin ${item.action === "create" ? "tạo" : "kích hoạt lại"} Nhà chính & Đối tác từ import NLĐ: ${item.name}`,
        }),
      ),
    );
  };

  const runImport = async (file: File, referenceInspection: BulkImportReferenceInspection) => {
    const startedAt = performance.now();
    try {
      if (hasReferenceActions(referenceInspection)) {
        setPhase("creatingReferences");
        const applied = await applyBulkWorkerImportReferences(referenceInspection);
        await logAppliedReferences(applied).catch(() =>
          toast.warning("Đã tạo dữ liệu tham chiếu nhưng chưa ghi được đầy đủ nhật ký thao tác"),
        );
      }

      setPhase("validating");
      const prepared = await prepareBulkWorkerImport(file);
      const validationFailed = Math.max(0, prepared.totalWorkers - prepared.workers.length);
      setProgress({
        total: prepared.totalWorkers,
        processed: validationFailed,
        created: 0,
        failed: validationFailed,
      });
      setPhase("importing");

      const executed = await executePreparedBulkImport(
        prepared.workers,
        (processedWorkers, createdWorkers, failedWorkers) => {
          setProgress({
            total: prepared.totalWorkers,
            processed: validationFailed + processedWorkers,
            created: createdWorkers,
            failed: validationFailed + failedWorkers,
          });
        },
      );

      const allErrors = [...prepared.errors, ...executed.errors];
      const createdWorkers = executed.createdWorkers.length;
      const result: BulkWorkerImportSummary = {
        totalWorkers: prepared.totalWorkers,
        createdWorkers,
        failedWorkers: Math.max(0, prepared.totalWorkers - createdWorkers),
        createdHistories: executed.createdHistoryCount,
        durationMs: Math.round(performance.now() - startedAt),
      };
      const missingRecruiterWorkers = new Set(
        referenceInspection.recruiters.flatMap((item) => item.workerKeys).filter(Boolean),
      ).size;

      if (createdWorkers > 0) await clearStaffCache();
      const logPayload = {
        file: file.name,
        total_workers: result.totalWorkers,
        created_workers: result.createdWorkers,
        failed_workers: result.failedWorkers,
        created_histories: result.createdHistories,
        missing_recruiters: referenceInspection.recruiters.length,
        skipped_workers_due_to_missing_recruiter: missingRecruiterWorkers,
        exported_errors: allErrors.length,
      };
      await Promise.all([
        createStaffActionLog({
          actor,
          targetCollection: "users",
          action: "import",
          after: logPayload,
          note: "Admin tạo hàng loạt NLĐ và lịch sử đi làm từ Excel",
        }),
        createStaffActionLog({
          actor,
          targetCollection: "employment_histories",
          action: "import",
          after: logPayload,
          note: "Admin tạo hàng loạt NLĐ và nhiều lịch sử đi làm từ Excel",
        }),
      ]).catch(() => toast.warning("Đã nhập dữ liệu nhưng chưa ghi được đầy đủ nhật ký thao tác"));

      setSummary(result);
      setErrors(allErrors);
      setProgress({
        total: result.totalWorkers,
        processed: result.totalWorkers,
        created: result.createdWorkers,
        failed: result.failedWorkers,
      });
      setPendingFile(null);
      setPhase("done");

      if (allErrors.length) {
        exportBulkWorkerErrors(allErrors);
        toast.warning(
          `Đã tạo ${result.createdWorkers} NLĐ, ${result.failedWorkers} NLĐ lỗi. Đã xuất file lỗi.`,
        );
      } else {
        toast.success(
          `Đã tạo ${result.createdWorkers} NLĐ và ${result.createdHistories} lịch sử đi làm.`,
        );
      }
    } catch (error) {
      const message = getUserErrorMessage(error, "Không thể xử lý file Excel.");
      setFatalError(message);
      setPhase("error");
      toast.error(message);
    }
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setSummary(null);
    setErrors([]);
    setFatalError("");
    setInspection(null);
    setProgress({ total: 0, processed: 0, created: 0, failed: 0 });
    setFileName(file.name);
    setPendingFile(file);
    setOpen(true);
    setPhase("reading");

    try {
      setPhase("inspecting");
      const inspected = await inspectBulkWorkerImportReferences(file);
      setInspection(inspected);
      if (hasReferenceIssues(inspected)) {
        setPhase("references");
        return;
      }
      await runImport(file, inspected);
    } catch (error) {
      const message = getUserErrorMessage(error, "Không thể kiểm tra file Excel.");
      setFatalError(message);
      setPhase("error");
      toast.error(message);
    }
  };

  const confirmReferences = () => {
    if (!pendingFile || !inspection) return;
    void runImport(pendingFile, inspection);
  };
  return (
    <>
      <Card className="relative overflow-hidden rounded-3xl border-primary/25 bg-gradient-to-br from-primary/10 via-card to-emerald-500/10 p-5 shadow-soft desktop:col-span-2">
        <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative space-y-4">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              <UsersRound className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="font-semibold">Tạo hàng loạt NLĐ và lịch sử đi làm</div>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">
                File gồm hai sheet Người lao động và Lịch sử đi làm. Một NLĐ có thể có tối đa 10
                lịch sử; toàn bộ dữ liệu của từng NLĐ được tạo trong cùng một giao dịch.
              </p>
            </div>
          </div>
          <div className="rounded-2xl border border-border/60 bg-background/70 p-3 text-xs leading-5 text-muted-foreground backdrop-blur">
            Có thể thêm hậu tố chữ a-z, dấu chấm hoặc gạch dưới vào SĐT/CCCD để phân biệt tên đăng
            nhập. Hậu tố không được lưu vào SĐT, CCCD hoặc lịch sử đi làm.
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button
              type="button"
              variant="outline"
              className="w-full rounded-full sm:w-auto"
              onClick={downloadBulkWorkerTemplate}
              disabled={busy}
            >
              <FileSpreadsheet className="h-4 w-4" /> Tải file mẫu
            </Button>
            <Button
              type="button"
              className="w-full rounded-full sm:w-auto"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {busy ? "Đang xử lý..." : "Chọn file Excel"}
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleFile}
              disabled={busy}
            />
          </div>
        </div>
      </Card>

      <BulkWorkerHistoryImportDialog
        open={open}
        onOpenChange={handleOpenChange}
        busy={busy}
        phase={phase}
        fileName={fileName}
        progress={progress}
        progressValue={progressValue}
        summary={summary}
        errors={errors}
        fatalError={fatalError}
        inspection={inspection}
        onConfirmReferences={confirmReferences}
      />
    </>
  );
}

type ImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  phase: ImportPhase;
  fileName: string;
  progress: ImportProgress;
  progressValue: number;
  summary: BulkWorkerImportSummary | null;
  errors: WorkerImportError[];
  fatalError: string;
  inspection: BulkImportReferenceInspection | null;
  onConfirmReferences: () => void;
};

function BulkWorkerHistoryImportDialog({
  open,
  onOpenChange,
  busy,
  phase,
  fileName,
  progress,
  progressValue,
  summary,
  errors,
  fatalError,
  inspection,
  onConfirmReferences,
}: ImportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90dvh] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl desktop:max-w-2xl"
        onEscapeKeyDown={(event) => busy && event.preventDefault()}
        onInteractOutside={(event) => busy && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Nhập NLĐ và lịch sử đi làm</DialogTitle>
          <DialogDescription>
            {fileName ? `File: ${fileName}` : "Theo dõi tiến độ tạo dữ liệu từ Excel."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-muted/30 p-4">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
              {busy ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : phase === "done" ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : (
                <AlertTriangle className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold">{phaseLabel(phase)}</div>
              {busy && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Không đóng ứng dụng trong khi đang tạo dữ liệu.
                </div>
              )}
            </div>
          </div>

          {phase === "references" && inspection && (
            <ReferenceInspectionPanel inspection={inspection} />
          )}

          {(phase === "importing" || phase === "done") && progress.total > 0 && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  Đã xử lý {progress.processed}/{progress.total} NLĐ
                </span>
                <span>{progressValue}%</span>
              </div>
              <Progress value={progressValue} className="h-2.5" />
              <div className="grid grid-cols-2 gap-2 pt-1 text-center text-xs sm:grid-cols-3">
                <ResultStat label="Đã tạo" value={progress.created} tone="success" />
                <ResultStat label="Bị lỗi" value={progress.failed} tone="danger" />
                <ResultStat label="Tổng NLĐ" value={progress.total} tone="neutral" />
              </div>
            </div>
          )}

          {summary && (
            <div className="grid grid-cols-2 gap-2">
              <ResultStat label="NLĐ thành công" value={summary.createdWorkers} tone="success" />
              <ResultStat label="Lịch sử đã tạo" value={summary.createdHistories} tone="success" />
              <ResultStat label="NLĐ thất bại" value={summary.failedWorkers} tone="danger" />
              <ResultStat
                label="Thời gian"
                value={formatDuration(summary.durationMs)}
                tone="neutral"
              />
            </div>
          )}

          {fatalError && (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              {fatalError}
            </div>
          )}

          {errors.length > 0 && phase === "done" && (
            <div className="space-y-2 rounded-2xl border border-amber-300/60 bg-amber-50 p-4 text-amber-900">
              <div className="text-sm font-semibold">Một số NLĐ chưa được tạo</div>
              <div className="space-y-1 text-xs leading-5">
                {errors.slice(0, 5).map((error, index) => (
                  <div key={`${error.workerKey}-${index}`}>
                    {error.workerKey || "Không rõ mã NLĐ"}: {error.reason}
                  </div>
                ))}
                {errors.length > 5 && (
                  <div>Và {errors.length - 5} lỗi khác trong file Excel lỗi.</div>
                )}
              </div>
            </div>
          )}
        </div>

        {!busy && (
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => onOpenChange(false)}
            >
              {phase === "references" ? "Hủy" : "Đóng"}
            </Button>
            {phase === "references" && inspection && (
              <Button type="button" className="w-full sm:w-auto" onClick={onConfirmReferences}>
                {hasReferenceActions(inspection)
                  ? "Tạo đơn vị và nhập phần hợp lệ"
                  : "Nhập phần hợp lệ"}
              </Button>
            )}
            {errors.length > 0 && phase !== "references" && (
              <Button
                type="button"
                className="w-full sm:w-auto"
                onClick={() => exportBulkWorkerErrors(errors)}
              >
                <Download className="h-4 w-4" /> Tải lại file lỗi
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReferenceInspectionPanel({ inspection }: { inspection: BulkImportReferenceInspection }) {
  return (
    <div className="space-y-4">
      {(inspection.factories.length > 0 || inspection.mainHouses.length > 0) && (
        <div className="space-y-3 rounded-2xl border border-sky-200 bg-sky-50/80 p-4 text-sky-950">
          <div>
            <div className="text-sm font-semibold">Đơn vị cần tạo hoặc kích hoạt lại</div>
            <p className="mt-1 text-xs leading-5 text-sky-800">
              Kiểm tra danh sách trước khi xác nhận. Hệ thống chỉ tạo dữ liệu sau khi Admin bấm nút
              tiếp tục.
            </p>
          </div>

          {inspection.factories.length > 0 && (
            <ReferenceGroup
              icon={<FactoryIcon className="h-4 w-4" />}
              title={`Nhà máy (${inspection.factories.length})`}
              items={inspection.factories.map((item) => ({
                key: `${item.action}-${item.existingId || item.name}`,
                name: item.code ? `${item.name} · ${item.code}` : item.name,
                meta: `${item.action === "create" ? "Tạo mới" : "Kích hoạt lại"} · Dòng ${item.rowNumbers.join(", ")}`,
              }))}
            />
          )}

          {inspection.mainHouses.length > 0 && (
            <ReferenceGroup
              icon={<Building2 className="h-4 w-4" />}
              title={`Nhà chính & Đối tác (${inspection.mainHouses.length})`}
              items={inspection.mainHouses.map((item) => ({
                key: `${item.action}-${item.existingId || item.name}`,
                name: item.name,
                meta: `${item.action === "create" ? "Tạo mới" : "Kích hoạt lại"} · Dòng ${item.rowNumbers.join(", ")}`,
              }))}
            />
          )}
        </div>
      )}

      {inspection.recruiters.length > 0 && (
        <div className="space-y-3 rounded-2xl border border-amber-300/70 bg-amber-50 p-4 text-amber-950">
          <div className="flex items-start gap-2">
            <UserRoundX className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="text-sm font-semibold">
                Người tuyển chưa có tài khoản ({inspection.recruiters.length})
              </div>
              <p className="mt-1 text-xs leading-5 text-amber-800">
                Admin cần chủ động tạo tài khoản Staff. Các NLĐ liên quan sẽ được bỏ qua; những NLĐ
                hợp lệ khác vẫn được nhập.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-amber-200 bg-white/70">
            <table className="w-full min-w-[32rem] text-left text-xs">
              <thead className="bg-amber-100/80 text-amber-900">
                <tr>
                  <th className="px-3 py-2 font-semibold">Người tuyển</th>
                  <th className="px-3 py-2 font-semibold">Mã NLĐ</th>
                  <th className="px-3 py-2 font-semibold">Dòng Excel</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-100">
                {inspection.recruiters.map((item) => (
                  <tr key={`${item.username}-${item.recruiterType}`}>
                    <td className="px-3 py-2 align-top font-medium">
                      {item.username}
                      {item.recruiterType && (
                        <div className="mt-0.5 text-[11px] font-normal text-amber-700">
                          {item.recruiterType}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">{item.workerKeys.join(", ") || "—"}</td>
                    <td className="px-3 py-2 align-top">{item.rowNumbers.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ReferenceGroup({
  icon,
  title,
  items,
}: {
  icon: React.ReactNode;
  title: string;
  items: Array<{ key: string; name: string; meta: string }>;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold">
        {icon}
        {title}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item.key} className="rounded-xl border border-sky-200 bg-white/70 px-3 py-2">
            <div className="text-xs font-semibold">{item.name}</div>
            <div className="mt-0.5 text-[11px] text-sky-700">{item.meta}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
function ResultStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: "success" | "danger" | "neutral";
}) {
  const toneClass =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "danger"
        ? "border-rose-200 bg-rose-50 text-rose-700"
        : "border-border bg-muted/30 text-foreground";
  return (
    <div className={`rounded-2xl border p-3 ${toneClass}`}>
      <div className="text-lg font-semibold">{value}</div>
      <div className="mt-0.5 text-[11px]">{label}</div>
    </div>
  );
}
