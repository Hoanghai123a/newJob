import { useEffect, useRef, useState } from "react";
import { pb, type UserRecord } from "@/lib/pocketbase";
import { createApprovalRequest } from "@/lib/approval-requests";
import { formatMoneyInput, parseMoneyInput } from "@/lib/money";
import { userDisplayName } from "@/lib/delegations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ResponsiveOverlay } from "@/components/layout/ResponsiveOverlay";
import { toast } from "@/lib/toast";
import { ImagePlus, FileSpreadsheet, Send, X } from "lucide-react";
import { companyFilter } from "@/lib/tenant";

export function ApprovalForm({
  open,
  onOpenChange,
  creatorId,
  currentUserId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  creatorId: string;
  currentUserId: string;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [amountText, setAmountText] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [excelFiles, setExcelFiles] = useState<File[]>([]);
  const [adminList, setAdminList] = useState<UserRecord[]>([]);
  const [selectedAdmins, setSelectedAdmins] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const imgRef = useRef<HTMLInputElement>(null);
  const excelRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    pb.collection("users")
      .getFullList<UserRecord>({
        filter: `${companyFilter(pb.authStore.record as UserRecord)} && role = "admin"`,
        sort: "full_name",
      })
      .then((admins) => setAdminList(admins.filter((a) => a.id !== currentUserId)))
      .catch(() => {});
  }, [open, currentUserId]);

  function reset() {
    setTitle("");
    setContent("");
    setAmountText("");
    setImages([]);
    setExcelFiles([]);
    setSelectedAdmins([]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return toast.error("Vui lòng nhập tiêu đề");
    if (!selectedAdmins.length) return toast.error("Vui lòng chọn ít nhất 1 quản trị viên");
    const amount = parseMoneyInput(amountText);

    setSubmitting(true);
    try {
      await createApprovalRequest({
        title: title.trim(),
        content: content.trim(),
        amount: amount > 0 ? amount : undefined,
        images,
        excelFiles,
        adminIds: selectedAdmins,
        creatorId,
      });
      toast.success("Đã gửi yêu cầu phê duyệt");
      reset();
      onOpenChange(false);
      onCreated();
    } catch {
      toast.error("Không thể gửi yêu cầu. Vui lòng thử lại.");
    } finally {
      setSubmitting(false);
    }
  }

  function toggleAdmin(id: string) {
    setSelectedAdmins((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  }

  function handleImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    setImages((prev) => [...prev, ...files].slice(0, 5));
    e.target.value = "";
  }

  function handleExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    setExcelFiles((prev) => [...prev, ...files].slice(0, 3));
    e.target.value = "";
  }

  return (
    <ResponsiveOverlay
      open={open}
      onOpenChange={onOpenChange}
      title="Tạo yêu cầu phê duyệt"
      description="Nhập nội dung, tệp đính kèm và chọn quản trị viên xử lý."
      presentation="full"
      className="desktop:max-w-lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label>Tiêu đề *</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Nhập tiêu đề yêu cầu"
            className="rounded-xl"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Nội dung</Label>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Mô tả chi tiết yêu cầu"
            className="min-h-24 rounded-xl"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Số tiền (tùy chọn)</Label>
          <Input
            value={amountText}
            onChange={(e) => setAmountText(formatMoneyInput(e.target.value))}
            placeholder="Nhập số tiền nếu có"
            inputMode="numeric"
            className="rounded-xl"
          />
          <p className="text-xs text-muted-foreground">Đơn vị: đồng</p>
        </div>

        <div className="space-y-1.5">
          <Label>Hình ảnh ({images.length}/5)</Label>
          <div className="flex flex-wrap gap-2">
            {images.map((f, i) => (
              <div key={i} className="group relative h-14 w-14 overflow-hidden rounded-lg border">
                <img src={URL.createObjectURL(f)} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                  className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100"
                >
                  <X className="h-4 w-4 text-white" />
                </button>
              </div>
            ))}
            {images.length < 5 && (
              <button
                type="button"
                onClick={() => imgRef.current?.click()}
                className="flex h-14 w-14 items-center justify-center rounded-lg border-2 border-dashed bg-white text-muted-foreground transition hover:border-primary hover:text-primary"
              >
                <ImagePlus className="h-5 w-5" />
              </button>
            )}
          </div>
          <input
            ref={imgRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleImages}
            className="hidden"
          />
        </div>

        <div className="space-y-1.5">
          <Label>File Excel ({excelFiles.length}/3)</Label>
          <div className="space-y-1">
            {excelFiles.map((f, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs"
              >
                <FileSpreadsheet className="h-4 w-4 shrink-0 text-green-600" />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <button
                  type="button"
                  onClick={() => setExcelFiles((prev) => prev.filter((_, j) => j !== i))}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {excelFiles.length < 3 && (
              <button
                type="button"
                onClick={() => excelRef.current?.click()}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border-2 border-dashed bg-white py-2 text-xs text-muted-foreground transition hover:border-primary hover:text-primary"
              >
                <FileSpreadsheet className="h-4 w-4" />
                Thêm file Excel
              </button>
            )}
          </div>
          <input
            ref={excelRef}
            type="file"
            accept=".xlsx,.xls"
            multiple
            onChange={handleExcel}
            className="hidden"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Gửi tới quản trị viên * ({selectedAdmins.length} đã chọn)</Label>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border p-2">
            {adminList.map((admin) => (
              <label
                key={admin.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/50"
              >
                <Checkbox
                  checked={selectedAdmins.includes(admin.id)}
                  onCheckedChange={() => toggleAdmin(admin.id)}
                />
                <span>{userDisplayName(admin)}</span>
              </label>
            ))}
            {!adminList.length && (
              <div className="py-2 text-center text-xs text-muted-foreground">
                Không tìm thấy quản trị viên
              </div>
            )}
          </div>
        </div>

        <Button type="submit" disabled={submitting} className="w-full gap-2 rounded-xl">
          <Send className="h-4 w-4" />
          {submitting ? "Đang gửi..." : "Gửi yêu cầu"}
        </Button>
      </form>
    </ResponsiveOverlay>
  );
}
