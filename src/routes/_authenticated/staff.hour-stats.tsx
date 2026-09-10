import { createFileRoute } from "@tanstack/react-router";
import { HourStatsDashboard } from "@/components/dashboard/HourStatsDashboard";

export const Route = createFileRoute("/_authenticated/staff/hour-stats")({
  component: HourStatsPage,
});

function HourStatsPage() {
  return <HourStatsDashboard presentation="standalone" />;
}
