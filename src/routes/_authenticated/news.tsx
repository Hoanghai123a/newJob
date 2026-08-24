import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { pb, fileUrl } from "@/lib/pocketbase";
import { useAuth } from "@/lib/auth";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";
import { escapePb } from "@/lib/delegations";
import { markSeen } from "@/lib/seen";
import { PageContainer } from "@/components/layout/PageContainer";
import { ResponsiveOverlay } from "@/components/layout/ResponsiveOverlay";
import { FilterBar } from "@/components/ui/filter-bar";
import { toneBorder, ChipTone } from "@/components/ui/status-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { DataLoadingState } from "@/components/ui/data-loading-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/lib/toast";
import {
  Phone,
  Plus,
  Pencil,
  Trash2,
  Building2,
  MapPin,
  Clock,
  Banknote,
  CalendarDays,
  ClipboardCheck,
  Gift,
  ImagePlus,
  PersonStanding,
  ShieldCheck,
  SlidersHorizontal,
  Briefcase,
  FileText,
  Users,
  Wallet,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { companyFilter, companyIdOf, joinTenantFilters } from "@/lib/tenant";

export const Route = createFileRoute("/_authenticated/news")({
  beforeLoad: () => {
    throw redirect({ to: "/staff/workers" });
  },
  component: NewsPage,
});

interface Recruitment {
  id: string;
  tenant_company: string;
  company: string;
  area: string;
  images: string[];
  map_url: string;
  introduction: string;
  interview_time: string;
  recruitment_deadline: string;
  employment_type?: string;
  is_active?: boolean;
  gender: string[];
  salary_base: string;
  allowance: string;
  bonus_other: string;
  short_term_salary: string;
  environment: string;
  work_posture: string;
  production_qc: string;
  production_qc_note: string;
  documents: string;
  notes: string;
  admin_phone: string;
  collectionId: string;
  collectionName: string;
  created?: string;
}

const EMPTY: Recruitment = {
  id: "",
  company: "",
  area: "",
  images: [],
  map_url: "",
  introduction: "",
  interview_time: "",
  recruitment_deadline: "",
  employment_type: "official",
  is_active: true,
  gender: ["male", "female"],
  salary_base: "",
  allowance: "",
  bonus_other: "",
  short_term_salary: "",
  environment: "",
  work_posture: "",
  production_qc: "",
  production_qc_note: "",
  documents: "",
  notes: "",
  admin_phone: "",
  collectionId: "",
  collectionName: "",
};

const genderLabel = (g?: string[]) => {
  if (!g || g.length === 0) return "—";
  if (g.length === 2) return "Nam & Nữ";
  return g[0] === "male" ? "Nam" : "Nữ";
};

const ENVIRONMENT_OPTIONS = [
  {
    value: "normal_room",
    label: "Phòng thường",
  },
  {
    value: "clean_room",
    label: "Phòng sạch",
  },
  { value: "both", label: "Cả 2" },
] as const;

const WORK_POSTURE_OPTIONS = [
  {
    value: "standing",
    label: "Làm đứng",
  },
  {
    value: "sitting",
    label: "Làm ngồi",
  },
  { value: "both", label: "Cả 2" },
] as const;

const PRODUCTION_QC_OPTIONS = [
  {
    value: "production",
    label: "Sản xuất",
  },
  { value: "qc", label: "QC" },
  { value: "both", label: "Cả 2" },
] as const;

const EMPLOYMENT_TYPE_OPTIONS = [
  {
    value: "official",
    label: "Chính thức",
  },
  {
    value: "temporary",
    label: "Thời vụ",
  },
] as const;

type SelectOption = { value: string; label: string };

const optionLabel = (options: readonly SelectOption[], value?: string) =>
  options.find((option) => option.value === value)?.label || "";

type FactoryOption = { id: string; name: string; address?: string; hotline?: string };
type RecruitmentAreaOption = { id: string; name: string; note?: string };

const normalizeArea = (value?: string) => value?.trim() || "";
const normalizeLookupValue = (value?: string) => value?.trim().toLowerCase() || "";

const isRecruitmentActive = (item: Recruitment) => item.is_active !== false;

const recruitmentEmploymentType = (item: Recruitment) => item.employment_type || "official";

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

function joinPbFilters(parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" && ");
}

function inclusiveOptionFilter(field: string, selected: string) {
  if (selected === "all" || selected === "both") return "";
  return `(${field}="${escapePb(selected)}" || ${field}="both")`;
}

function buildRecruitmentFilter(input: {
  isAdmin: boolean;
  search: string;
  gender: string;
  area: string;
  employmentType: string;
  environment: string;
  posture: string;
  productionQc: string;
}) {
  const q = escapePb(input.search.trim());
  const searchFilter = q ? `(company~"${q}" || area~"${q}")` : "";
  return joinPbFilters([
    input.isAdmin ? "" : "is_active!=false",
    searchFilter,
    input.area === "all" ? "" : `area="${escapePb(input.area)}"`,
    input.gender === "all" ? "" : `gender~"${escapePb(input.gender)}"`,
    input.employmentType === "all" ? "" : `employment_type="${escapePb(input.employmentType)}"`,
    inclusiveOptionFilter("environment", input.environment),
    inclusiveOptionFilter("work_posture", input.posture),
    inclusiveOptionFilter("production_qc", input.productionQc),
  ]);
}

const factoryMapUrl = (factory?: FactoryOption | null) => {
  const query = factory?.address?.trim() || factory?.name?.trim() || "";
  if (!query) return "";
  if (/^https?:\/\//i.test(query)) return query;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
};

const findFactoryByCompany = (factories: FactoryOption[], company?: string) => {
  const normalizedCompany = normalizeLookupValue(company);
  if (!normalizedCompany) return null;
  return (
    factories.find((factory) => normalizeLookupValue(factory.name) === normalizedCompany) || null
  );
};

function useFactoryOptions() {
  const { user } = useAuth();
  const [factories, setFactories] = useState<FactoryOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    pb.collection("factories")
      .getList(1, 300, { filter: companyFilter(user), sort: "name" })
      .then((res) => {
        if (!cancelled) setFactories(res.items as unknown as FactoryOption[]);
      })
      .catch(() => {
        if (!cancelled) setFactories([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  return { factories, loading };
}

function useRecruitmentAreaOptions() {
  const { user } = useAuth();
  const [areas, setAreas] = useState<RecruitmentAreaOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    pb.collection("recruitment_areas")
      .getList(1, 300, { filter: companyFilter(user), sort: "name" })
      .then((res) => {
        if (!cancelled) setAreas(res.items as unknown as RecruitmentAreaOption[]);
      })
      .catch(() => {
        if (!cancelled) setAreas([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  return { areas, loading };
}

const formatMoneyInput = (value: string) => {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  return new Intl.NumberFormat("vi-VN").format(Number(digits));
};

function NewsPage() {
  const { user, isAdmin } = useAuth();
  const { areas: configuredAreas, loading: areasLoading } = useRecruitmentAreaOptions();
  const { factories, loading: factoriesLoading } = useFactoryOptions();
  const [items, setItems] = useState<Recruitment[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Recruitment | null>(null);
  const [editing, setEditing] = useState<Recruitment | null>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedSearch(search);
  const [filter, setFilter] = useState("all");
  const [areaFilter, setAreaFilter] = useState("all");
  const [employmentTypeFilter, setEmploymentTypeFilter] = useState("all");
  const [environmentFilter, setEnvironmentFilter] = useState("all");
  const [postureFilter, setPostureFilter] = useState("all");
  const [productionQcFilter, setProductionQcFilter] = useState("all");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await pb.collection("recruitments").getList(1, 200, {
        filter: joinTenantFilters(
          user,
          buildRecruitmentFilter({
            isAdmin,
            search: debouncedSearch,
            gender: filter,
            area: areaFilter,
            employmentType: employmentTypeFilter,
            environment: environmentFilter,
            posture: postureFilter,
            productionQc: productionQcFilter,
          }),
        ),
        sort: "-created",
      });
      const rows = res.items as unknown as Recruitment[];
      setItems(rows);
      const latest = rows.reduce(
        (max, row) => Math.max(max, row.created ? new Date(row.created).getTime() : 0),
        0,
      );
      markSeen("news", user?.id, latest || Date.now());
    } catch (e: unknown) {
      toast.error(errorMessage(e, "Lỗi tải bảng tin"));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [
    isAdmin,
    debouncedSearch,
    filter,
    areaFilter,
    employmentTypeFilter,
    environmentFilter,
    postureFilter,
    productionQcFilter,
  ]);

  const visibleItems = items;

  const remove = async (id: string) => {
    if (!confirm("Xoá tin tuyển dụng?")) return;
    await pb.collection("recruitments").delete(id);
    load();
  };

  const filtered = visibleItems;

  const areaOptions = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...configuredAreas.map((item) => normalizeArea(item.name)),
            ...visibleItems.map((item) => normalizeArea(item.area)),
          ].filter(Boolean),
        ),
      )
        .sort((a, b) => a.localeCompare(b, "vi"))
        .map((area) => ({ value: area, label: area })),
    [configuredAreas, visibleItems],
  );

  const isNew = (r: Recruitment) =>
    r.created && Date.now() - new Date(r.created).getTime() < 7 * 24 * 3600 * 1000;
  const hasAdvancedFilter = [
    areaFilter,
    employmentTypeFilter,
    environmentFilter,
    postureFilter,
    productionQcFilter,
  ].some((value) => value !== "all");

  return (
    <PageContainer
      title="Bảng tin tuyển dụng"
      subtitle={
        loading && items.length === 0
          ? "Đang tải dữ liệu..."
          : `${visibleItems.length} tin đang đăng`
      }
      right={
        isAdmin && (
          <button
            onClick={() => setEditing({ ...EMPTY })}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-soft active:scale-95"
            aria-label="Thêm tin"
          >
            <Plus className="h-4 w-4" />
          </button>
        )
      }
    >
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        placeholder="Tìm theo tên nhà máy…"
        chips={[
          {
            key: "all",
            label: "Tất cả",
            count: visibleItems.length,
          },
          { key: "male", label: "Nam" },
          { key: "female", label: "Nữ" },
        ]}
        activeChip={filter}
        onChipChange={setFilter}
        chipActions={
          <button
            type="button"
            onClick={() => setShowAdvancedFilters(true)}
            aria-expanded={showAdvancedFilters}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition",
              showAdvancedFilters || hasAdvancedFilter
                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : "border-border bg-card text-muted-foreground",
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Lọc nâng cao
            {hasAdvancedFilter && (
              <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
            )}
          </button>
        }
      />
      <ResponsiveOverlay
        open={showAdvancedFilters}
        onOpenChange={setShowAdvancedFilters}
        title="Bộ lọc nâng cao"
        description="Chọn các điều kiện để thu gọn danh sách tuyển dụng."
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setAreaFilter("all");
                setEmploymentTypeFilter("all");
                setEnvironmentFilter("all");
                setPostureFilter("all");
                setProductionQcFilter("all");
              }}
            >
              Đặt lại
            </Button>
            <Button type="button" onClick={() => setShowAdvancedFilters(false)}>
              Áp dụng
            </Button>
          </>
        }
      >
        <AdvancedFilters
          area={areaFilter}
          areaOptions={areaOptions}
          onAreaChange={setAreaFilter}
          employmentType={employmentTypeFilter}
          onEmploymentTypeChange={setEmploymentTypeFilter}
          environment={environmentFilter}
          onEnvironmentChange={setEnvironmentFilter}
          posture={postureFilter}
          onPostureChange={setPostureFilter}
          productionQc={productionQcFilter}
          onProductionQcChange={setProductionQcFilter}
        />
      </ResponsiveOverlay>

      {loading && items.length > 0 && (
        <DataLoadingState variant="inline" label="Đang cập nhật bảng tin..." />
      )}

      {loading && items.length === 0 ? (
        <DataLoadingState variant="list" label="Đang tải bảng tin tuyển dụng..." rows={3} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Chưa có tin tuyển dụng"
          description={search ? "Không tìm thấy kết quả phù hợp." : "Tin mới sẽ xuất hiện tại đây."}
        />
      ) : (
        filtered.map((r) => {
          const cover = r.images?.[0] ? fileUrl(r, r.images[0]) : null;
          const tone: ChipTone = isNew(r) ? "info" : "neutral";
          return (
            <div key={r.id} className={cn("list-card relative", toneBorder[tone])}>
              {isAdmin && (
                <div className="absolute right-2 top-2 z-10 flex gap-1">
                  <button
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-card/90 text-muted-foreground shadow-soft hover:bg-muted"
                    onClick={() => setEditing(r)}
                    aria-label="Sửa"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-card/90 text-destructive shadow-soft hover:bg-destructive/10"
                    onClick={() => remove(r.id)}
                    aria-label="Xóa"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <button
                className={cn("flex w-full items-start gap-3 text-left", isAdmin && "pr-16")}
                onClick={() => setDetail(r)}
              >
                {cover ? (
                  <img
                    src={cover}
                    className="h-14 w-14 flex-none rounded-xl object-cover"
                    alt={r.company}
                  />
                ) : (
                  <div className="flex h-14 w-14 flex-none items-center justify-center rounded-xl bg-secondary">
                    <Building2 className="h-6 w-6 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{r.company}</div>
                  {isAdmin && !isRecruitmentActive(r) && (
                    <div className="mt-1 inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      Đang tắt
                    </div>
                  )}
                  <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    <SummaryItem
                      icon={ClipboardCheck}
                      label="Loại tuyển"
                      value={optionLabel(EMPLOYMENT_TYPE_OPTIONS, recruitmentEmploymentType(r))}
                    />
                    <SummaryItem icon={Banknote} label="LCB" value={r.salary_base} />
                    <SummaryItem icon={MapPin} label="Khu vực" value={r.area} />
                    <SummaryItem icon={Gift} label="Phụ cấp" value={r.allowance} />
                    <SummaryItem
                      icon={ShieldCheck}
                      label="Môi trường"
                      value={optionLabel(ENVIRONMENT_OPTIONS, r.environment)}
                    />
                    <SummaryItem
                      icon={PersonStanding}
                      label="Tư thế"
                      value={optionLabel(WORK_POSTURE_OPTIONS, r.work_posture)}
                    />
                    <SummaryItem
                      icon={ClipboardCheck}
                      label="Sản xuất/QC"
                      value={optionLabel(PRODUCTION_QC_OPTIONS, r.production_qc)}
                    />
                    <SummaryItem
                      icon={CalendarDays}
                      label="Hết hạn"
                      value={r.recruitment_deadline}
                    />
                  </div>
                </div>
              </button>
            </div>
          );
        })
      )}

      <DetailSheet item={detail} factories={factories} onClose={() => setDetail(null)} />
      <EditDialog
        item={editing}
        areaOptions={areaOptions}
        areasLoading={areasLoading}
        factories={factories}
        factoriesLoading={factoriesLoading}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />
    </PageContainer>
  );
}

function AdvancedFilters({
  area,
  areaOptions,
  onAreaChange,
  employmentType,
  onEmploymentTypeChange,
  environment,
  onEnvironmentChange,
  posture,
  onPostureChange,
  productionQc,
  onProductionQcChange,
}: {
  area: string;
  areaOptions: SelectOption[];
  onAreaChange: (value: string) => void;
  employmentType: string;
  onEmploymentTypeChange: (value: string) => void;
  environment: string;
  onEnvironmentChange: (value: string) => void;
  posture: string;
  onPostureChange: (value: string) => void;
  productionQc: string;
  onProductionQcChange: (value: string) => void;
}) {
  const hasActive = [area, employmentType, environment, posture, productionQc].some(
    (value) => value !== "all",
  );

  return (
    <div className="rounded-2xl border border-border/70 bg-card p-3 shadow-soft">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-muted-foreground">Bộ lọc nâng cao</div>
        {hasActive && (
          <button
            type="button"
            onClick={() => {
              onEnvironmentChange("all");
              onAreaChange("all");
              onEmploymentTypeChange("all");
              onPostureChange("all");
              onProductionQcChange("all");
            }}
            className="text-xs font-medium text-primary"
          >
            Xóa lọc
          </button>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-5">
        <WorkModeFilter
          label="Khu vực"
          value={area}
          onChange={onAreaChange}
          options={areaOptions}
        />
        <WorkModeFilter
          label="Loại tuyển"
          value={employmentType}
          onChange={onEmploymentTypeChange}
          options={EMPLOYMENT_TYPE_OPTIONS}
        />
        <WorkModeFilter
          label="Môi trường"
          value={environment}
          onChange={onEnvironmentChange}
          options={ENVIRONMENT_OPTIONS}
        />
        <WorkModeFilter
          label="Tư thế"
          value={posture}
          onChange={onPostureChange}
          options={WORK_POSTURE_OPTIONS}
        />
        <WorkModeFilter
          label="Sản xuất/QC"
          value={productionQc}
          onChange={onProductionQcChange}
          options={PRODUCTION_QC_OPTIONS}
        />
      </div>
    </div>
  );
}

function SummaryItem({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value?: string;
}) {
  const displayValue = value || "-";

  return (
    <div
      className="flex min-w-0 items-center gap-1.5"
      title={`${label}: ${displayValue}`}
      aria-label={`${label}: ${displayValue}`}
    >
      <Icon className="h-3.5 w-3.5 flex-none text-muted-foreground/80" />
      <span className="truncate font-medium text-foreground">{displayValue}</span>
    </div>
  );
}

function DetailSheet({
  item,
  factories,
  onClose,
}: {
  item: Recruitment | null;
  factories: FactoryOption[];
  onClose: () => void;
}) {
  const factory = item ? findFactoryByCompany(factories, item.company) : null;
  const contactPhone = (factory?.hotline || item?.admin_phone || "").trim();
  const mapUrl = factoryMapUrl(factory) || item?.map_url || "";

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto p-0">
        {item && (
          <div>
            <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-card/95 p-3 backdrop-blur">
              <DialogHeader className="flex-1">
                <DialogTitle className="truncate">{item.company}</DialogTitle>
              </DialogHeader>
              {contactPhone ? (
                <a
                  href={`tel:${contactPhone}`}
                  className="flex items-center gap-2 rounded-full bg-success px-3 py-1.5 text-success-foreground"
                >
                  <Phone className="h-4 w-4 flex-none" />
                  <span className="flex flex-col leading-tight">
                    <span className="text-[11px] font-medium opacity-90">Gọi ứng tuyển</span>
                    <span className="text-xs font-semibold">{contactPhone}</span>
                  </span>
                </a>
              ) : (
                <div className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                  <Phone className="h-4 w-4" /> Chưa có số
                </div>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 flex-none rounded-full"
                onClick={onClose}
                aria-label="Đóng"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            {item.images?.length > 0 && (
              <Carousel
                opts={{ align: "start", loop: item.images.length > 1 }}
                className="px-4 pt-4"
              >
                <CarouselContent className="-ml-2">
                  {item.images.map((f, index) => (
                    <CarouselItem key={f} className="pl-2">
                      <div className="relative overflow-hidden rounded-xl border bg-muted">
                        <img
                          src={fileUrl(item, f)}
                          className="h-56 w-full object-cover"
                          alt={`${item.company} ${index + 1}`}
                        />
                        {item.images.length > 1 && (
                          <div className="absolute bottom-2 right-2 rounded-full bg-background/85 px-2 py-0.5 text-[11px] font-medium text-foreground shadow-soft backdrop-blur">
                            {index + 1}/{item.images.length}
                          </div>
                        )}
                      </div>
                    </CarouselItem>
                  ))}
                </CarouselContent>
                {item.images.length > 1 && (
                  <>
                    <CarouselPrevious className="left-6 border-border/70 bg-background/90 shadow-soft" />
                    <CarouselNext className="right-6 border-border/70 bg-background/90 shadow-soft" />
                  </>
                )}
              </Carousel>
            )}
            <div className="space-y-4 p-4 text-sm">
              <DetailSection icon={Building2} title={"Tổng quan"}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Info
                    icon={ClipboardCheck}
                    label={"Loại tuyển"}
                    value={optionLabel(EMPLOYMENT_TYPE_OPTIONS, recruitmentEmploymentType(item))}
                  />
                  <Info icon={MapPin} label={"Khu vực"} value={item.area} />
                  <Info icon={Users} label={"Tuyển"} value={genderLabel(item.gender)} />
                  <Info icon={Clock} label={"Thời gian phỏng vấn"} value={item.interview_time} />
                  <Info
                    icon={CalendarDays}
                    label={"Thời hạn tuyển dụng"}
                    value={item.recruitment_deadline}
                  />
                </div>
                <Info label={"Giới thiệu"} value={item.introduction} multiline />
              </DetailSection>

              <DetailSection icon={Wallet} title={"Chế độ"}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Info icon={Banknote} label={"Lương cơ bản"} value={item.salary_base} />
                  <Info icon={Gift} label={"Phụ cấp"} value={item.allowance} />
                </div>
                <Info label={"Thưởng khác"} value={item.bonus_other} multiline />
                <Info label={"Lương ngắn hạn"} value={item.short_term_salary} multiline />
              </DetailSection>

              <DetailSection icon={Briefcase} title={"Đặc thù công việc"}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Info
                    icon={ShieldCheck}
                    label={"Môi trường"}
                    value={optionLabel(ENVIRONMENT_OPTIONS, item.environment)}
                  />
                  <Info
                    icon={PersonStanding}
                    label={"Tư thế công việc"}
                    value={optionLabel(WORK_POSTURE_OPTIONS, item.work_posture)}
                  />
                </div>
                <Info
                  icon={ClipboardCheck}
                  label={"Sản xuất/QC"}
                  value={[
                    optionLabel(PRODUCTION_QC_OPTIONS, item.production_qc),
                    item.production_qc_note,
                  ]
                    .filter(Boolean)
                    .join("\n")}
                  multiline
                />
              </DetailSection>

              <DetailSection icon={FileText} title={"Thủ tục"}>
                <Info label={"Giấy tờ yêu cầu"} value={item.documents} multiline />
                <Info label={"Ghi chú khác"} value={item.notes} multiline />
              </DetailSection>

              <div className="hidden">
                <Info
                  label="Loại tuyển"
                  value={optionLabel(EMPLOYMENT_TYPE_OPTIONS, recruitmentEmploymentType(item))}
                />
                <Info icon={MapPin} label="Khu vực" value={item.area} />
                <Info label="Giới thiệu" value={item.introduction} multiline />
                <Info label="Thời hạn tuyển dụng" value={item.recruitment_deadline} />
                <Info label="Thưởng khác" value={item.bonus_other} multiline />
                <Info label="Lương ngắn hạn" value={item.short_term_salary} multiline />
                <Info
                  label="Môi trường"
                  value={optionLabel(ENVIRONMENT_OPTIONS, item.environment)}
                />
                <Info
                  label="Tư thế công việc"
                  value={optionLabel(WORK_POSTURE_OPTIONS, item.work_posture)}
                />
                <Info
                  label="Sản xuất/QC"
                  value={[
                    optionLabel(PRODUCTION_QC_OPTIONS, item.production_qc),
                    item.production_qc_note,
                  ]
                    .filter(Boolean)
                    .join("\n")}
                  multiline
                />
                <Info icon={Clock} label="Thời gian phỏng vấn" value={item.interview_time} />
                <Info icon={Banknote} label="Lương cơ bản" value={item.salary_base} />
                <Info label="Phụ cấp" value={item.allowance} />
                <Info label="Tuyển" value={genderLabel(item.gender)} />
                <Info label="Giấy tờ yêu cầu" value={item.documents} multiline />
                <Info label="Ghi chú khác" value={item.notes} multiline />
              </div>
              {mapUrl && (
                <a
                  href={mapUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-xl border bg-secondary p-3 text-primary"
                >
                  <MapPin className="h-4 w-4" /> Mở Google Maps
                </a>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailSection({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-2xl border border-border/70 bg-card p-3 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="text-sm font-semibold">{title}</div>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Info({
  icon: Icon,
  label,
  value,
  multiline,
}: {
  icon?: LucideIcon;
  label: string;
  value?: string;
  multiline?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex gap-3 rounded-xl bg-muted/35 p-3">
      {Icon && <Icon className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" />}
      <div className="min-w-0 flex-1">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={multiline ? "whitespace-pre-wrap" : "font-medium"}>{value}</div>
      </div>
    </div>
  );
}

function EditDialog({
  item,
  areaOptions,
  areasLoading,
  factories,
  factoriesLoading,
  onClose,
  onSaved,
}: {
  item: Recruitment | null;
  areaOptions: SelectOption[];
  areasLoading: boolean;
  factories: FactoryOption[];
  factoriesLoading: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [form, setForm] = useState<Recruitment | null>(item);
  const [files, setFiles] = useState<File[]>([]);
  const [removedImages, setRemovedImages] = useState<string[]>([]);
  const [selectedFactory, setSelectedFactory] = useState<FactoryOption | null>(null);

  useEffect(() => {
    setForm(item);
    setFiles([]);
    setRemovedImages([]);
    setSelectedFactory(null);
  }, [item]);
  if (!form) return null;

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fs = Array.from(e.target.files || []);
    const remaining = 3 - ((form.images?.length || 0) - removedImages.length) - files.length;
    if (fs.length > remaining) toast.warning(`Chỉ được tối đa 3 ảnh`);
    setFiles((p) => [...p, ...fs.slice(0, remaining)]);
  };

  const save = async () => {
    try {
      const currentFactory = selectedFactory || findFactoryByCompany(factories, form.company);
      const adminPhone = currentFactory?.hotline?.trim() || user?.phone || form.admin_phone || "";
      const mapUrl = factoryMapUrl(currentFactory) || form.map_url || "";
      const fd = new FormData();
      fd.append("tenant_company", companyIdOf(user));

      fd.append("area", normalizeArea(form.area));
      fd.append("map_url", mapUrl);
      fd.append("introduction", form.introduction || "");
      fd.append("interview_time", form.interview_time);
      fd.append("recruitment_deadline", form.recruitment_deadline || "");
      fd.append("employment_type", form.employment_type || "official");
      fd.append("is_active", String(form.is_active !== false));
      for (const g of form.gender || []) fd.append("gender", g);
      fd.append("salary_base", form.salary_base);
      fd.append("allowance", form.allowance);
      fd.append("bonus_other", form.bonus_other || "");
      fd.append("short_term_salary", form.short_term_salary || "");
      fd.append("environment", form.environment || "");
      fd.append("work_posture", form.work_posture || "");
      fd.append("production_qc", form.production_qc || "");
      fd.append("production_qc_note", form.production_qc_note || "");
      fd.append("documents", form.documents);
      fd.append("notes", form.notes);
      fd.append("admin_phone", adminPhone);
      for (const rm of removedImages) fd.append("images-", rm);
      for (const f of files) fd.append("images", f);

      if (form.id) await pb.collection("recruitments").update(form.id, fd);
      else await pb.collection("recruitments").create(fd);
      toast.success("Đã lưu");
      onSaved();
    } catch (e: unknown) {
      toast.error(errorMessage(e, "Lỗi tải bảng tin"));
    }
  };

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{form.id ? "Sửa tin tuyển dụng" : "Thêm tin tuyển dụng"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="flex items-center justify-between rounded-xl border bg-secondary/50 p-3">
            <div>
              <div className="text-sm font-medium">Hiển thị tin tuyển dụng</div>
              <div className="text-xs text-muted-foreground">
                Tắt thì user sẽ không nhìn thấy tin này.
              </div>
            </div>
            <Switch
              checked={form.is_active !== false}
              onCheckedChange={(checked) => setForm({ ...form, is_active: checked })}
            />
          </label>
          <FactoryField
            factories={factories}
            loading={factoriesLoading}
            label="Nhà máy"
            v={form.company}
            on={(v, factory) => {
              setSelectedFactory(factory);
              setForm({
                ...form,
                company: v,
                map_url: factoryMapUrl(factory) || form.map_url,
                admin_phone: factory?.hotline?.trim() || form.admin_phone,
              });
            }}
          />
          <AreaField
            label="Khu vực"
            value={form.area || ""}
            onChange={(v) => setForm({ ...form, area: v })}
            options={areaOptions}
            loading={areasLoading}
          />
          <FT
            label="Giới thiệu"
            v={form.introduction || ""}
            on={(v) => setForm({ ...form, introduction: v })}
          />
          <F
            label="Thời gian phỏng vấn"
            v={form.interview_time}
            on={(v) => setForm({ ...form, interview_time: v })}
          />
          <F
            label="Thời hạn tuyển dụng"
            v={form.recruitment_deadline || ""}
            on={(v) => setForm({ ...form, recruitment_deadline: v })}
            placeholder="VD: 31/12/2026 hoặc Lâu dài"
          />
          <WorkModeField
            label="Loại tuyển"
            value={form.employment_type || "official"}
            onChange={(v) => setForm({ ...form, employment_type: v })}
            options={EMPLOYMENT_TYPE_OPTIONS}
          />
          <div className="space-y-2">
            <Label>Tuyển</Label>
            <div className="flex gap-4">
              {(
                [
                  ["male", "Nam"],
                  ["female", "Nữ"],
                ] as const
              ).map(([val, lbl]) => {
                const checked = form.gender?.includes(val) ?? false;
                return (
                  <label key={val} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(c) => {
                        const set = new Set(form.gender || []);
                        if (c) set.add(val);
                        else set.delete(val);
                        setForm({ ...form, gender: Array.from(set) });
                      }}
                    />
                    {lbl}
                  </label>
                );
              })}
            </div>
          </div>
          <WorkModeField
            label="Môi trường"
            value={form.environment || ""}
            onChange={(v) => setForm({ ...form, environment: v })}
            options={ENVIRONMENT_OPTIONS}
          />
          <WorkModeField
            label="Tư thế công việc"
            value={form.work_posture || ""}
            onChange={(v) => setForm({ ...form, work_posture: v })}
            options={WORK_POSTURE_OPTIONS}
          />
          <div className="grid grid-cols-[9.5rem_minmax(0,1fr)] items-end gap-2">
            <WorkModeField
              label="Sản xuất/QC"
              value={form.production_qc || ""}
              onChange={(v) => setForm({ ...form, production_qc: v })}
              options={PRODUCTION_QC_OPTIONS}
            />
            <Input
              value={form.production_qc_note || ""}
              placeholder="Ghi chú Sản xuất/QC"
              onChange={(e) => setForm({ ...form, production_qc_note: e.target.value })}
            />
          </div>
          <MoneyField
            label="Lương cơ bản"
            v={form.salary_base}
            on={(v) => setForm({ ...form, salary_base: v })}
          />
          <MoneyField
            label="Phụ cấp"
            v={form.allowance}
            on={(v) => setForm({ ...form, allowance: v })}
          />
          <FT
            label="Thưởng khác"
            v={form.bonus_other || ""}
            on={(v) => setForm({ ...form, bonus_other: v })}
          />
          <FT
            label="Lương ngắn hạn"
            v={form.short_term_salary || ""}
            on={(v) => setForm({ ...form, short_term_salary: v })}
          />
          <FT
            label="Giấy tờ yêu cầu"
            v={form.documents}
            on={(v) => setForm({ ...form, documents: v })}
          />
          <FT label="Ghi chú khác" v={form.notes} on={(v) => setForm({ ...form, notes: v })} />

          <div className="space-y-1">
            <Label>Hình ảnh (tối đa 3)</Label>
            <div className="flex flex-wrap gap-2">
              {(form.images || [])
                .filter((f) => !removedImages.includes(f))
                .map((f) => (
                  <div key={f} className="relative">
                    <img src={fileUrl(form, f)} className="h-20 w-20 rounded-xl object-cover" />
                    <button
                      type="button"
                      onClick={() => setRemovedImages((r) => [...r, f])}
                      className="absolute -right-1 -top-1 rounded-full bg-destructive p-0.5 text-destructive-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              {files.map((f, i) => (
                <div key={i} className="relative">
                  <img src={URL.createObjectURL(f)} className="h-20 w-20 rounded-xl object-cover" />
                  <button
                    type="button"
                    onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}
                    className="absolute -right-1 -top-1 rounded-full bg-destructive p-0.5 text-destructive-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed bg-white text-muted-foreground">
                <ImagePlus className="h-5 w-5" />
                <input type="file" accept="image/*" multiple className="hidden" onChange={onFile} />
              </label>
            </div>
          </div>

          <Button onClick={save} className="w-full">
            Lưu
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function F({
  label,
  v,
  on,
  placeholder,
}: {
  label: string;
  v: string;
  on: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input value={v || ""} placeholder={placeholder} onChange={(e) => on(e.target.value)} />
    </div>
  );
}

function WorkModeField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Select value={value || "-"} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Chọn hình thức" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function WorkModeFilter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
}) {
  return (
    <Select value={value === "all" ? undefined : value} onValueChange={onChange}>
      <SelectTrigger className="rounded-xl bg-white text-xs text-slate-900">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function MoneyField({ label, v, on }: { label: string; v: string; on: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input
        inputMode="numeric"
        value={v || ""}
        onChange={(e) => on(formatMoneyInput(e.target.value))}
      />
    </div>
  );
}

function FT({ label, v, on }: { label: string; v: string; on: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Textarea rows={3} value={v || ""} onChange={(e) => on(e.target.value)} />
    </div>
  );
}

function AreaField({
  label,
  value,
  onChange,
  options,
  loading,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  loading: boolean;
}) {
  const hasMatch = !value || options.some((option) => option.value === value);
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <SearchableSelect
        value={value || ""}
        onValueChange={onChange}
        options={options.map((option) => ({
          value: option.value,
          label: option.label,
        }))}
        placeholder={loading ? "Đang tải khu vực..." : "Chọn khu vực"}
        searchPlaceholder="Tìm khu vực..."
        emptyText={loading ? "Đang tải danh sách khu vực..." : "Không tìm thấy khu vực phù hợp."}
      />
    </div>
  );
}

function FactoryField({
  factories,
  loading,
  label,
  v,
  on,
}: {
  factories: FactoryOption[];
  loading: boolean;
  label: string;
  v: string;
  on: (v: string, factory: FactoryOption | null) => void;
}) {
  const hasMatch = !v || factories.some((f) => f.name === v);
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <SearchableSelect
        value={v || ""}
        onValueChange={(value) => {
          const factory = factories.find((item) => item.name === value) || null;
          on(value, factory);
        }}
        options={factories.map((factory) => ({
          value: factory.name,
          label: factory.name,
        }))}
        placeholder={loading ? "Đang tải..." : "Chọn nhà máy"}
        searchPlaceholder="Tìm nhà máy..."
        emptyText={loading ? "Đang tải danh sách nhà máy..." : "Không tìm thấy nhà máy phù hợp."}
      />
    </div>
  );
}
