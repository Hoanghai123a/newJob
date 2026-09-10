import { ChevronRight } from "lucide-react";
import type { GuideItem } from "@/lib/user-guide-data";
import { groupGuidesByCategory } from "@/lib/user-guide-data";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface UserGuideListProps {
  guides: GuideItem[];
  onSelectGuide: (guide: GuideItem) => void;
  className?: string;
}

export function UserGuideList({ guides, onSelectGuide, className }: UserGuideListProps) {
  const groupedGuides = groupGuidesByCategory(guides);
  const categories = Object.keys(groupedGuides).sort();

  if (guides.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-sm text-muted-foreground">Không tìm thấy hướng dẫn phù hợp</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Thử tìm kiếm với từ khóa khác
        </p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-6", className)}>
      {categories.map((category) => {
        const categoryGuides = groupedGuides[category];
        return (
          <section key={category}>
            {/* Category header */}
            <h3 className="mb-3 px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {category}
            </h3>

            {/* Guide items */}
            <Card className="divide-y divide-border/50">
              {categoryGuides.map((guide) => (
                <button
                  key={guide.id}
                  type="button"
                  onClick={() => onSelectGuide(guide)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-muted/50 active:bg-muted"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-tight">{guide.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {guide.steps.length} bước
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </Card>
          </section>
        );
      })}
    </div>
  );
}
