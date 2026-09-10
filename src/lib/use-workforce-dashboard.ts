import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { pb, type UserRecord } from "./pocketbase";
import {
  enumerateWorkforceDates,
  findMissingWorkforceRanges,
  type WorkforceDashboardDay,
  type WorkforceDashboardResponse,
  type WorkforceLookups,
  type WorkforceRecruitmentScope,
  validateWorkforceRange,
} from "./workforce-dashboard";
import {
  readWorkforceDayCache,
  readWorkforceLookupCache,
  writeWorkforceDayCache,
  writeWorkforceLookupCache,
} from "./workforce-dashboard-cache";

export type WorkforceDashboardData = {
  from: string;
  to: string;
  scope: WorkforceRecruitmentScope;
  generatedAt: string;
  scopeFingerprint: string;
  days: WorkforceDashboardDay[];
  lookups: WorkforceLookups | null;
};

const pendingLoads = new Map<string, Promise<void>>();

async function apiJson<T>(path: string) {
  const response = await fetch(path, {
    headers: pb.authStore.token ? { Authorization: `Bearer ${pb.authStore.token}` } : {},
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || "Không tải được dữ liệu nhân lực.");
  return payload as T;
}
function dashboardUrl(from: string, to: string, scope: WorkforceRecruitmentScope) {
  const params = new URLSearchParams({ from, to, scope });
  return `/api/workforce/dashboard?${params}`;
}
function responseData(
  response: WorkforceDashboardResponse,
  lookups: WorkforceLookups | null,
): WorkforceDashboardData {
  return {
    from: response.from,
    to: response.to,
    scope: response.scope,
    generatedAt: response.generatedAt || new Date().toISOString(),
    scopeFingerprint: response.scopeFingerprint || "",
    days: Array.isArray(response.days)
      ? response.days.filter((day) => day && typeof day.date === "string")
      : [],
    lookups:
      lookups && typeof lookups === "object"
        ? {
            factories: Array.isArray(lookups.factories) ? lookups.factories : [],
            recruiters: Array.isArray(lookups.recruiters) ? lookups.recruiters : [],
            generatedAt: lookups.generatedAt || "",
            scopeFingerprint: lookups.scopeFingerprint || "",
          }
        : null,
  };
}
function mergeDays(current: WorkforceDashboardDay[], incoming: WorkforceDashboardDay[]) {
  const map = new Map(current.map((day) => [day.date, day]));
  for (const day of incoming) map.set(day.date, day);
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function useWorkforceDashboardData(params: {
  viewer: UserRecord | null;
  from: string;
  to: string;
  scope: WorkforceRecruitmentScope;
  reloadToken?: number;
}) {
  const { viewer, from, to, scope, reloadToken = 0 } = params;
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () =>
      ["workforce-dashboard-v1", viewer?.id || "", viewer?.role || "", from, to, scope] as const,
    [from, scope, to, viewer?.id, viewer?.role],
  );
  const query = useQuery<WorkforceDashboardData>({
    queryKey,
    queryFn: async () => {
      throw new Error("Dữ liệu được tải bằng cache dashboard.");
    },
    enabled: false,
    placeholderData: keepPreviousData,
  });
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");
  const [previousData, setPreviousData] = useState<WorkforceDashboardData | undefined>();
  const [signalToken, setSignalToken] = useState(0);

  useEffect(() => {
    const onCacheChanged = (event: Event) => {
      const collection = (event as CustomEvent<{ collection?: string }>).detail?.collection;
      if (
        collection === "employment_histories" ||
        collection === "users" ||
        collection === "factories" ||
        collection === "recruitment_entities" ||
        collection === "factory_managers"
      ) {
        setSignalToken((value) => value + 1);
      }
    };
    window.addEventListener("jobconnect:staff-cache-changed", onCacheChanged);
    window.addEventListener("online", onCacheChanged);
    return () => {
      window.removeEventListener("jobconnect:staff-cache-changed", onCacheChanged);
      window.removeEventListener("online", onCacheChanged);
    };
  }, []);

  useEffect(() => {
    if (
      !viewer?.id ||
      (viewer.role !== "admin" && viewer.role !== "staff") ||
      validateWorkforceRange(from, to)
    )
      return;
    let cancelled = false;
    const loadKey = queryKey.join("|") + `|${reloadToken}|${signalToken}`;
    setUpdating(true);
    setError("");
    const run = async () => {
      const dates = enumerateWorkforceDates(from, to);
      const [cached, cachedLookups] = await Promise.all([
        readWorkforceDayCache(viewer, scope, dates),
        readWorkforceLookupCache(viewer),
      ]);
      const cachedDateSet = new Set(cached.days.map((day) => day.date));
      const detailMissingDates = new Set(
        cached.days.filter((day) => !Array.isArray(day.recruitedWorkers)).map((day) => day.date),
      );
      const refreshRequested = signalToken > 0 || reloadToken > 0;
      const refreshDateSet = refreshRequested
        ? new Set<string>()
        : new Set([...cachedDateSet].filter((date) => detailMissingDates.has(date)));
      if (!cancelled && cached.days.length === dates.length) {
        queryClient.setQueryData(queryKey, {
          from,
          to,
          scope,
          generatedAt: cached.generatedAt,
          scopeFingerprint: cached.fingerprint,
          days: cached.days,
          lookups: cachedLookups,
        } satisfies WorkforceDashboardData);
      }

      let lookups = cachedLookups;
      const lookupPromise = apiJson<WorkforceLookups>("/api/workforce/lookups")
        .then(async (value) => {
          lookups = value;
          await writeWorkforceLookupCache(viewer, value);
          return value;
        })
        .catch(() => cachedLookups);

      const missing = findMissingWorkforceRanges(dates, refreshDateSet);
      let combined = cached.days;
      let fingerprint = cached.fingerprint;
      let generatedAt = cached.generatedAt;

      const fetchRanges = async (ranges: Array<{ from: string; to: string }>) => {
        for (const range of ranges) {
          const response = await apiJson<WorkforceDashboardResponse>(
            dashboardUrl(range.from, range.to, scope),
          );
          await writeWorkforceDayCache(viewer, response);
          if (fingerprint && fingerprint !== response.scopeFingerprint) {
            const full = await apiJson<WorkforceDashboardResponse>(dashboardUrl(from, to, scope));
            await writeWorkforceDayCache(viewer, full);
            combined = full.days;
            fingerprint = full.scopeFingerprint;
            generatedAt = full.generatedAt;
            break;
          }
          fingerprint = response.scopeFingerprint;
          generatedAt = response.generatedAt;
          combined = mergeDays(combined, response.days).filter(
            (day) => day.date >= from && day.date <= to,
          );
          if (!cancelled && combined.length === dates.length) {
            queryClient.setQueryData(
              queryKey,
              responseData(
                {
                  from,
                  to,
                  scope,
                  generatedAt,
                  scopeFingerprint: fingerprint,
                  days: combined,
                },
                lookups,
              ),
            );
          }
        }
      };

      await fetchRanges(missing);
      lookups = await lookupPromise;
      if (!cancelled && combined.length === dates.length) {
        queryClient.setQueryData(
          queryKey,
          responseData(
            {
              from,
              to,
              scope,
              generatedAt,
              scopeFingerprint: fingerprint,
              days: combined,
            },
            lookups,
          ),
        );
      }
    };

    let promise = pendingLoads.get(loadKey);
    if (!promise) {
      promise = run().finally(() => pendingLoads.delete(loadKey));
      pendingLoads.set(loadKey, promise);
    }
    promise
      .catch((cause) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "Không tải được dữ liệu nhân lực.");
      })
      .finally(() => {
        if (!cancelled) setUpdating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, queryClient, queryKey, reloadToken, scope, signalToken, to, viewer]);

  useEffect(() => {
    if (query.data) setPreviousData(query.data);
  }, [query.data]);

  const data = query.data || previousData;
  const matchesRange = Boolean(
    data && data.from === from && data.to === to && data.scope === scope,
  );
  return {
    data,
    loading: !data && updating,
    updating,
    staleView: Boolean(data && !matchesRange),
    error: error || (query.error instanceof Error ? query.error.message : ""),
  };
}
