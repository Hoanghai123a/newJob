import { ChevronRight } from "lucide-react";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";

export interface WorkerDesktopCardProps {
  name: string;
  username?: string;
  uid?: string;
  employeeCode?: string;
  cccd?: string;
  cccdImageProgress: string;
  phone?: string;
  dateOfBirth?: string;
  gender?: string;
  address?: string;
  factoryName?: string;
  mainHouseName?: string;
  recruiterName?: string;
  joinDate?: string;
  leaveDate?: string;
  isWorking: boolean;
  onClick: () => void;
}

const AVATAR_TONES = [
  "bg-amber-500 text-white",
  "bg-sky-600 text-white",
  "bg-rose-500 text-white",
  "bg-violet-600 text-white",
  "bg-emerald-600 text-white",
  "bg-indigo-600 text-white",
];

export function WorkerDesktopCard({
  name,
  username,
  uid,
  employeeCode,
  cccd,
  cccdImageProgress,
  phone,
  dateOfBirth,
  gender,
  address,
  factoryName,
  mainHouseName,
  recruiterName,
  joinDate,
  leaveDate,
  isWorking,
  onClick,
}: WorkerDesktopCardProps) {
  const initial = name.trim().charAt(0).toLocaleUpperCase("vi-VN") || "N";
  const toneIndex = [...name].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const avatarTone = AVATAR_TONES[toneIndex % AVATAR_TONES.length];

  return (
    <button
      type="button"
      onClick={onClick}
      className="group hidden w-full grid-cols-[minmax(13rem,1.05fr)_minmax(0,1.2fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_2rem] items-center gap-4 rounded-xl border border-border/60 border-l-4 border-l-primary bg-card px-4 py-3 text-left shadow-sm transition hover:border-primary/30 hover:bg-muted/20 hover:shadow-soft desktop:grid"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div
          className={cn(
            "flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-xl font-semibold shadow-sm",
            avatarTone,
          )}
          aria-hidden="true"
        >
          {initial}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground" title={name}>
            {name}
          </div>
          <div className="mt-1 truncate text-[11px] text-muted-foreground">
            {uid || "Chưa có mã NLĐ"}
            {username ? ` · @${username}` : ""}
          </div>
          <div
            className="mt-1 truncate text-xs font-medium text-primary"
            title={factoryName || undefined}
          >
            {factoryName || "Chưa có nhà máy"}
          </div>
        </div>
      </div>

      <div className="min-w-0 space-y-1 border-l border-border/60 pl-4">
        <InfoLine label="CCCD" value={cccd} />
        <InfoLine label="Ngày sinh" value={dateOfBirth} />
        <InfoLine label="Giới tính" value={gender} />
        <InfoLine label="Địa chỉ" value={address} />
      </div>

      <div className="min-w-0 space-y-1 border-l border-border/60 pl-4">
        <div className="flex items-center gap-2 text-[11px] leading-4">
          <span className="shrink-0 text-muted-foreground">Trạng thái:</span>
          <StatusChip
            tone={isWorking ? "success" : "danger"}
            className="px-2 py-1 text-xs font-semibold shadow-sm"
          >
            {isWorking ? "Đang làm" : "Đã nghỉ"}
          </StatusChip>
        </div>
        <InfoLine label="Mã NV" value={employeeCode} />
        <InfoLine label="Ngày vào" value={joinDate} />
        <InfoLine label="Ngày nghỉ" value={leaveDate} />
      </div>

      <div className="min-w-0 space-y-1 border-l border-border/60 pl-4">
        <InfoLine label="Người tuyển" value={recruiterName} valueClassName="text-primary" />
        <InfoLine label="Nhà chính" value={mainHouseName} />
        <InfoLine label="Số điện thoại" value={phone} />
        <InfoLine label="Ảnh CCCD" value={cccdImageProgress} />
      </div>

      <ChevronRight className="h-5 w-5 justify-self-end text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
    </button>
  );
}

function InfoLine({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value?: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-1 text-[11px] leading-4">
      <span className="shrink-0 text-muted-foreground">{label}:</span>
      <span
        className={cn("min-w-0 truncate text-foreground", valueClassName)}
        title={value || undefined}
      >
        {value || "—"}
      </span>
    </div>
  );
}
