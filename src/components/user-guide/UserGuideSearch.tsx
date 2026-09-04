import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface UserGuideSearchProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function UserGuideSearch({ value, onChange, className }: UserGuideSearchProps) {
  return (
    <div className={cn("relative", className)}>
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="text"
        placeholder="Tìm kiếm chức năng..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 rounded-xl pl-10 pr-4"
      />
    </div>
  );
}
