import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { BookOpen } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { UserGuideSearch } from "@/components/user-guide/UserGuideSearch";
import { UserGuideList } from "@/components/user-guide/UserGuideList";
import { UserGuideDetail } from "@/components/user-guide/UserGuideDetail";
import { searchGuides, type GuideItem } from "@/lib/user-guide-data";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/user-guide")({
  component: UserGuidePage,
});

function UserGuidePage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [selectedGuide, setSelectedGuide] = useState<GuideItem | null>(null);
  const debouncedSearch = useDebouncedSearch(search, 300);

  const filteredGuides = useMemo(() => {
    return searchGuides(debouncedSearch, user?.role);
  }, [debouncedSearch, user?.role]);

  const handleBack = () => {
    setSelectedGuide(null);
  };

  return (
    <PageContainer
      title="Hướng dẫn sử dụng"
      subtitle="Tìm kiếm và học cách sử dụng các chức năng"
      back={selectedGuide !== null}
    >
      {selectedGuide ? (
        <UserGuideDetail guide={selectedGuide} onBack={handleBack} />
      ) : (
        <>
          {/* Search */}
          <UserGuideSearch value={search} onChange={setSearch} />

          {/* Empty state when no search */}
          {!search && filteredGuides.length > 0 && (
            <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/50 p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <BookOpen className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  Có {filteredGuides.length} hướng dẫn khả dụng
                </p>
                <p className="text-xs text-muted-foreground">
                  Tìm kiếm hoặc chọn chức năng bên dưới để xem hướng dẫn chi tiết
                </p>
              </div>
            </div>
          )}

          {/* Search result indicator */}
          {search && (
            <div className="flex items-center justify-between rounded-xl border border-border/60 bg-card/50 px-4 py-2">
              <p className="text-xs text-muted-foreground">
                {filteredGuides.length > 0
                  ? `Tìm thấy ${filteredGuides.length} kết quả cho "${search}"`
                  : `Không tìm thấy kết quả cho "${search}"`}
              </p>
              {filteredGuides.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Xóa tìm kiếm
                </button>
              )}
            </div>
          )}

          {/* Guide list */}
          <UserGuideList guides={filteredGuides} onSelectGuide={setSelectedGuide} />
        </>
      )}
    </PageContainer>
  );
}
