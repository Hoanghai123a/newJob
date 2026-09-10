import { createFileRoute, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "@/lib/toast";
import {
  WorkerPayrollView,
  type WorkerAttendanceCheckItem,
  type WorkerSalaryCheckItem,
} from "@/components/payroll/WorkerPayrollView";
import { AppHeader } from "@/components/layout/BottomNav";
import { EmptyState } from "@/components/ui/empty-state";
import { DataLoadingState } from "@/components/ui/data-loading-state";
import { useAuth } from "@/lib/auth";
import { type UserRecord } from "@/lib/pocketbase";
import { fetchStaffWorkerWorkspace } from "@/lib/staff-permissions";
import { CalendarCheck } from "lucide-react";
import { getUserErrorMessage } from "@/lib/toast";
import { fetchWorkerCheckPayroll } from "@/lib/check-payroll-cache";

export const Route = createFileRoute("/_authenticated/staff/workers/$workerId_/payroll")({
  component: StaffWorkerPayrollPage,
});

function StaffWorkerPayrollPage() {
  const { workerId } = useParams({ from: "/_authenticated/staff/workers/$workerId_/payroll" });
  const { user } = useAuth();
  const [workerName, setWorkerName] = useState("");
  const [workerCompany, setWorkerCompany] = useState("");
  const [attendanceItems, setAttendanceItems] = useState<WorkerAttendanceCheckItem[]>([]);
  const [salaryItems, setSalaryItems] = useState<WorkerSalaryCheckItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(true);

  const load = useCallback(async () => {
    if (!user?.id || !workerId) {
      setAuthorized(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const workspace = await fetchStaffWorkerWorkspace(user as UserRecord, workerId);
      const worker = workspace.worker;
      if (!worker || !worker.canViewPayroll) {
        setAuthorized(false);
        setAttendanceItems([]);
        setSalaryItems([]);
        return;
      }

      setAuthorized(true);
      setWorkerName(worker.user.full_name || worker.user.username || "");
      setWorkerCompany(worker.latestHistory?.expand?.factory?.name || "");

      const payload = await fetchWorkerCheckPayroll(user.id, user.role || "staff", worker.user.id);
      setAttendanceItems(payload.attendance);
      setSalaryItems(payload.salary);
    } catch (error: unknown) {
      toast.error(getUserErrorMessage(error, "Không tải Được check công/lương"));
    } finally {
      setLoading(false);
    }
  }, [user, workerId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!authorized) {
    return (
      <div>
        <AppHeader title="Check công/lương" back />
        <div className="p-4">
          <EmptyState
            icon={CalendarCheck}
            title="Không có quyền"
            description="Bạn không có quyền xem check công/lương của người lao động này."
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <AppHeader title="Check công/lương" subtitle={workerName} back />
      <div className="space-y-4 p-4">
        {loading && attendanceItems.length === 0 && salaryItems.length === 0 ? (
          <DataLoadingState variant="list" label="Đang tải dữ liệu công và lương..." rows={3} />
        ) : loading ? (
          <DataLoadingState variant="inline" label="Đang cập nhật dữ liệu công và lương..." />
        ) : null}
        <WorkerPayrollView
          attendanceItems={attendanceItems}
          salaryItems={salaryItems}
          loading={loading}
          fallbackFactoryName={workerCompany}
        />
      </div>
    </div>
  );
}
