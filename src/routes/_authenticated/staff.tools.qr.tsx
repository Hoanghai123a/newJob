import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileArchive,
  FileSpreadsheet,
  Loader2,
  QrCode,
  RefreshCw,
  Upload,
} from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { QrBankPicker } from "@/components/staff/QrBankPicker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import {
  buildQrTransferData,
  createQrZip,
  downloadQrCard,
  downloadQrExcelTemplate,
  getQrImageUrl,
  normalizeAccountName,
  normalizeAccountNumber,
  normalizeTransferDescription,
  parseQrExcel,
  QR_DESCRIPTION_MAX_BYTES,
  type QrImportError,
  type QrImportResult,
  type QrTransferData,
} from "@/lib/bank-qr";
import { getQrBankLabel } from "@/lib/vn-banks";

export const Route = createFileRoute("/_authenticated/staff/tools/qr")({ component: BankQrPage });

type FormState = {
  bankCode: string;
  accountNumber: string;
  accountName: string;
  amount: string;
  description: string;
};
const EMPTY_FORM: FormState = {
  bankCode: "",
  accountNumber: "",
  accountName: "",
  amount: "",
  description: "",
};

function BankQrPage() {
  return (
    <PageContainer
      title="Tạo mã QR"
      subtitle="Tạo nhanh mã QR chuyển khoản ngân hàng"
      desktopWidth="wide"
    >
      <div className="rounded-3xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50 via-white to-cyan-50 p-4 shadow-soft desktop:p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-sm">
            <QrCode className="h-6 w-6" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-900">QR chuyển khoản VietQR</h2>
            <p className="mt-1 text-sm leading-5 text-slate-600">
              Dữ liệu được chuẩn hóa trên thiết bị. Cần kết nối mạng để tải ảnh QR từ VietQR.
            </p>
          </div>
        </div>
      </div>
      <Tabs defaultValue="single">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="single">Tạo QR đơn</TabsTrigger>
          <TabsTrigger value="bulk">Tạo hàng loạt</TabsTrigger>
        </TabsList>
        <TabsContent value="single">
          <SingleQr />
        </TabsContent>
        <TabsContent value="bulk">
          <BulkQr />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}

function SingleQr() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [result, setResult] = useState<QrTransferData | null>(null);
  const [signature, setSignature] = useState("");
  const [imageState, setImageState] = useState<"loading" | "ready" | "error">("loading");
  const [downloading, setDownloading] = useState(false);
  const currentSignature = JSON.stringify(form);
  const stale = Boolean(result && signature !== currentSignature);
  const normalized = useMemo(
    () => ({
      accountNumber: normalizeAccountNumber(form.accountNumber),
      accountName: normalizeAccountName(form.accountName),
      description: normalizeTransferDescription(form.description),
    }),
    [form.accountName, form.accountNumber, form.description],
  );

  const setField = (field: keyof FormState, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));
  const create = () => {
    const built = buildQrTransferData(form);
    if (!built.data) return toast.error(built.errors.join(". "));
    setResult(built.data);
    setSignature(currentSignature);
    setImageState("loading");
  };
  const qrUrl = result ? getQrImageUrl(result) : null;

  return (
    <div className="grid gap-4 desktop:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle>Thông tin chuyển khoản</CardTitle>
          <CardDescription>Chọn ngân hàng và nhập thông tin trước khi tạo mã.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Ngân hàng">
            <QrBankPicker value={form.bankCode} onChange={(value) => setField("bankCode", value)} />
          </Field>
          <Field label="Số tài khoản">
            <Input
              className="h-12 rounded-xl"
              inputMode="numeric"
              value={form.accountNumber}
              onChange={(e) => setField("accountNumber", e.target.value)}
              placeholder="Ví dụ: 0012 345 678"
            />
            <Hint value={normalized.accountNumber} />
          </Field>
          <Field label="Chủ tài khoản">
            <Input
              className="h-12 rounded-xl"
              value={form.accountName}
              onChange={(e) => setField("accountName", e.target.value)}
              placeholder="Nguyễn Văn Ánh"
            />
            <Hint value={normalized.accountName} />
          </Field>
          <Field label="Số tiền">
            <Input
              className="h-12 rounded-xl"
              inputMode="numeric"
              value={form.amount}
              onChange={(e) => setField("amount", e.target.value)}
              placeholder="Để trống nếu không cố định"
            />
          </Field>
          <Field label="Nội dung chuyển khoản">
            <Textarea
              value={form.description}
              onChange={(e) => setField("description", e.target.value)}
              placeholder="Thanh toán tháng 8"
            />
            <div
              className={`text-right text-xs ${new TextEncoder().encode(normalized.description).length > QR_DESCRIPTION_MAX_BYTES ? "text-destructive" : "text-muted-foreground"}`}
            >
              {new TextEncoder().encode(normalized.description).length}/{QR_DESCRIPTION_MAX_BYTES}{" "}
              byte VietQR
            </div>
            <Hint value={normalized.description} />
            {new TextEncoder().encode(normalized.description).length > QR_DESCRIPTION_MAX_BYTES && (
              <p className="text-xs text-destructive">
                Nội dung quá dài để đóng gói theo cấu trúc VietQR. Hãy rút gọn nội dung.
              </p>
            )}
          </Field>
          <Button
            className="h-12 w-full rounded-xl"
            onClick={create}
            disabled={!form.bankCode || !normalized.accountNumber}
          >
            <QrCode className="h-4 w-4" /> Tạo mã QR
          </Button>
        </CardContent>
      </Card>
      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle>Kết quả</CardTitle>
          <CardDescription>Mã QR chỉ xuất hiện sau khi bạn nhấn tạo.</CardDescription>
        </CardHeader>
        <CardContent>
          {!result ? (
            <EmptyQr />
          ) : (
            <div className="space-y-4">
              {stale && (
                <Alert className="border-amber-300 bg-amber-50">
                  <RefreshCw className="h-4 w-4" />
                  <AlertTitle>Thông tin đã thay đổi</AlertTitle>
                  <AlertDescription>Nhấn “Tạo mã QR” để cập nhật kết quả.</AlertDescription>
                </Alert>
              )}
              <QrCard
                data={result}
                url={qrUrl}
                imageState={imageState}
                onLoad={() => setImageState("ready")}
                onError={() => setImageState("error")}
              />
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={create}>
                  <RefreshCw className="h-4 w-4" /> Tạo lại
                </Button>
                <Button
                  disabled={imageState !== "ready" || downloading}
                  onClick={async () => {
                    setDownloading(true);
                    try {
                      await downloadQrCard(result);
                    } catch (e) {
                      toast.error(e);
                    } finally {
                      setDownloading(false);
                    }
                  }}
                >
                  {downloading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}{" "}
                  Tải PNG
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BulkQr() {
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<QrImportResult | null>(null);
  const [reading, setReading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [runtimeErrors, setRuntimeErrors] = useState<QrImportError[]>([]);
  const loadFile = async (file?: File) => {
    if (!file) return;
    setReading(true);
    setResult(null);
    setRuntimeErrors([]);
    setFileName(file.name);
    try {
      setResult(await parseQrExcel(file));
    } catch (e) {
      toast.error(e);
    } finally {
      setReading(false);
    }
  };
  const generate = async () => {
    if (!result?.valid.length) return;
    setCreating(true);
    setProgress(0);
    setRuntimeErrors([]);
    try {
      const failures = await createQrZip(result.valid, (done, total) =>
        setProgress(Math.round((done / total) * 100)),
      );
      setRuntimeErrors(failures);
      if (failures.length)
        toast.error(`Đã tạo ZIP, nhưng có ${failures.length} dòng không tạo được ảnh.`);
      else toast.success("Đã tạo file ZIP mã QR.");
    } catch (e) {
      toast.error(e);
    } finally {
      setCreating(false);
    }
  };
  return (
    <div className="space-y-4">
      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle>Nhập file Excel</CardTitle>
          <CardDescription>Tối đa 200 dòng. Dùng mã ngân hàng như ICB, SHBVN, MB.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 desktop:grid-cols-2">
            <Button variant="outline" className="h-12" onClick={downloadQrExcelTemplate}>
              <FileSpreadsheet className="h-4 w-4" /> Tải file Excel mẫu
            </Button>
            <Label className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
              <Upload className="h-4 w-4" /> {reading ? "Đang đọc file..." : "Chọn file Excel"}
              <Input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                disabled={reading || creating}
                onChange={(e) => void loadFile(e.target.files?.[0])}
              />
            </Label>
          </div>
          {fileName && (
            <div className="text-sm text-muted-foreground">
              File đã chọn: <strong className="text-foreground">{fileName}</strong>
            </div>
          )}
        </CardContent>
      </Card>
      {result && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Dòng hợp lệ" value={result.valid.length} good />
            <Stat label="Dòng lỗi" value={result.errors.length} />
          </div>
          {result.valid.length > 0 && (
            <Card className="rounded-3xl">
              <CardHeader>
                <CardTitle>Xem trước dữ liệu chuẩn hóa</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-80 space-y-2 overflow-auto">
                  {result.valid.slice(0, 30).map((row) => (
                    <div key={row.row} className="rounded-xl border p-3 text-sm">
                      <div className="font-semibold">
                        Dòng {row.row} · {getQrBankLabel(row.bank)}
                      </div>
                      <div className="mt-1 text-muted-foreground">
                        {row.accountNumber} · {row.accountName || "Không cố định"}
                      </div>
                      <div className="text-muted-foreground">
                        {row.amount
                          ? `${row.amount.toLocaleString("vi-VN")} đ`
                          : "Không cố định số tiền"}{" "}
                        · {row.description || "Không có nội dung"}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          {(result.errors.length > 0 || runtimeErrors.length > 0) && (
            <ErrorList errors={[...result.errors, ...runtimeErrors]} />
          )}
          {creating && (
            <div className="space-y-2 rounded-2xl border bg-card p-4">
              <div className="flex justify-between text-sm">
                <span>Đang tạo ảnh và đóng gói ZIP...</span>
                <strong>{progress}%</strong>
              </div>
              <Progress value={progress} />
            </div>
          )}
          <Button
            className="h-12 w-full rounded-xl"
            disabled={!result.valid.length || creating}
            onClick={generate}
          >
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileArchive className="h-4 w-4" />
            )}{" "}
            Tạo ZIP mã QR ({result.valid.length})
          </Button>
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
function Hint({ value }: { value: string }) {
  return value ? (
    <div className="text-xs text-emerald-700">
      Dữ liệu dùng cho QR: <strong>{value}</strong>
    </div>
  ) : null;
}
function EmptyQr() {
  return (
    <div className="flex min-h-80 flex-col items-center justify-center rounded-2xl border border-dashed bg-muted/30 p-6 text-center">
      <QrCode className="h-16 w-16 text-muted-foreground/40" />
      <div className="mt-3 font-semibold">Chưa có mã QR</div>
      <p className="mt-1 text-sm text-muted-foreground">Điền thông tin và nhấn “Tạo mã QR”.</p>
    </div>
  );
}
function QrCard({
  data,
  url,
  imageState,
  onLoad,
  onError,
}: {
  data: QrTransferData;
  url: string | null;
  imageState: string;
  onLoad: () => void;
  onError: () => void;
}) {
  return (
    <div className="rounded-2xl border bg-white p-4 text-slate-900 shadow-sm">
      <div className="relative mx-auto flex aspect-square max-w-72 items-center justify-center overflow-hidden rounded-xl bg-slate-50">
        {imageState === "loading" && <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />}
        {imageState === "error" && (
          <div className="p-4 text-center text-sm text-destructive">
            Không tải được ảnh QR. Hãy kiểm tra mạng và tạo lại.
          </div>
        )}
        {url && (
          <img
            src={url}
            alt="Mã QR chuyển khoản"
            className={
              imageState === "ready"
                ? "h-full w-full object-contain"
                : "absolute h-full w-full opacity-0"
            }
            onLoad={onLoad}
            onError={onError}
          />
        )}
      </div>
      <div className="mt-4 space-y-2 text-sm">
        <Info label="Ngân hàng" value={getQrBankLabel(data.bank)} />
        <Info label="Số tài khoản" value={data.accountNumber} />
        <Info label="Chủ tài khoản" value={data.accountName || "Không cố định"} />
        <Info
          label="Số tiền"
          value={data.amount ? `${data.amount.toLocaleString("vi-VN")} đ` : "Không cố định"}
        />
        <Info label="Nội dung" value={data.description || "Không cố định"} />
      </div>
    </div>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-2 last:border-0">
      <span className="shrink-0 text-slate-500">{label}</span>
      <strong className="text-right break-words">{value}</strong>
    </div>
  );
}
function Stat({ label, value, good }: { label: string; value: number; good?: boolean }) {
  return (
    <div
      className={`rounded-2xl border p-4 ${good ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}
    >
      <div className="flex items-center gap-2 text-sm">
        {good ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        ) : (
          <AlertCircle className="h-4 w-4 text-amber-600" />
        )}
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}
function ErrorList({ errors }: { errors: QrImportError[] }) {
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Các dòng chưa thể xử lý</AlertTitle>
      <AlertDescription>
        <div className="mt-2 max-h-52 space-y-1 overflow-auto">
          {errors.map((error, index) => (
            <div key={`${error.row}-${index}`}>
              {error.row ? `Dòng ${error.row}: ` : ""}
              {error.message}
            </div>
          ))}
        </div>
      </AlertDescription>
    </Alert>
  );
}
