import { createContext, useContext } from "react";

export type StaffExcelExportContextValue = {
  openStaffExcelExport: () => void;
};

export const StaffExcelExportContext = createContext<StaffExcelExportContextValue>({
  openStaffExcelExport: () => undefined,
});

export function useStaffExcelExport() {
  return useContext(StaffExcelExportContext);
}
