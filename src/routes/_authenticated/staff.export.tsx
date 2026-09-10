import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useStaffExcelExport } from "@/components/staff/staff-excel-export-context";

export const Route = createFileRoute("/_authenticated/staff/export")({
  component: StaffExportCompatibilityRoute,
});

function StaffExportCompatibilityRoute() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { openStaffExcelExport } = useStaffExcelExport();

  useEffect(() => {
    openStaffExcelExport();
    void navigate({
      to: (user?.role === "admin" ? "/admin/workforce" : "/staff/workers") as any,
      replace: true,
    });
  }, [navigate, openStaffExcelExport, user?.role]);

  return null;
}
