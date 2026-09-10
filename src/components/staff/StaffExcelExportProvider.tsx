import { useCallback, useState, type ReactNode } from "react";
import { StaffExcelExportDialog } from "@/components/staff/StaffExcelExportDialog";
import { StaffExcelExportContext } from "@/components/staff/staff-excel-export-context";

export function StaffExcelExportProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openStaffExcelExport = useCallback(() => setOpen(true), []);

  return (
    <StaffExcelExportContext.Provider value={{ openStaffExcelExport }}>
      {children}
      <StaffExcelExportDialog open={open} onOpenChange={setOpen} />
    </StaffExcelExportContext.Provider>
  );
}
