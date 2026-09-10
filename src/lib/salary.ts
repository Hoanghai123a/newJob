// Salary computation per the user's rules.
// Rates: 100, 130, 150, 200, 270, 300, 390
export type Shift = "day" | "night";
export interface AttendanceRow {
  date: string; // yyyy-mm-dd
  shift: Shift;
  is_holiday: boolean;
  hc_hours: number;
  ot_hours: number;
}

export interface RateBuckets {
  r100: number;
  r130: number;
  r150: number;
  r200: number;
  r270: number;
  r300: number;
  r390: number;
}

export const EMPTY_BUCKETS = (): RateBuckets => ({
  r100: 0,
  r130: 0,
  r150: 0,
  r200: 0,
  r270: 0,
  r300: 0,
  r390: 0,
});

function add(b: RateBuckets, key: keyof RateBuckets, h: number) {
  if (h > 0) b[key] += h;
}

/** Distribute one day's HC + OT hours into rate buckets per business rules. */
export function distributeDay(row: AttendanceRow, b: RateBuckets) {
  const hc = Math.max(0, row.hc_hours || 0);
  const ot = Math.max(0, row.ot_hours || 0);
  const isSunday = new Date(row.date + "T00:00:00").getDay() === 0;
  const dayType: "normal" | "sunday" | "holiday" = row.is_holiday
    ? "holiday"
    : isSunday
      ? "sunday"
      : "normal";

  if (dayType === "normal") {
    if (row.shift === "day") {
      add(b, "r100", hc);
      add(b, "r150", ot);
    } else {
      // night HC: first 2h 100%, next 6h 130%, rest 100%
      const h1 = Math.min(hc, 2);
      const h2 = Math.min(Math.max(hc - 2, 0), 6);
      const h3 = Math.max(hc - 8, 0);
      add(b, "r100", h1 + h3);
      add(b, "r130", h2);
      // night OT: first 1h 200%, rest 150%
      const o1 = Math.min(ot, 1);
      const o2 = Math.max(ot - 1, 0);
      add(b, "r200", o1);
      add(b, "r150", o2);
    }
  } else if (dayType === "sunday") {
    if (row.shift === "day") {
      add(b, "r200", hc + ot);
    } else {
      // night: first 2h 200%, next 7h 270%, rest 200%
      const total = hc + ot;
      const h1 = Math.min(total, 2);
      const h2 = Math.min(Math.max(total - 2, 0), 7);
      const h3 = Math.max(total - 9, 0);
      add(b, "r200", h1 + h3);
      add(b, "r270", h2);
    }
  } else {
    // holiday
    if (row.shift === "day") {
      add(b, "r300", hc + ot);
    } else {
      const total = hc + ot;
      const h1 = Math.min(total, 2);
      const h2 = Math.min(Math.max(total - 2, 0), 7);
      const h3 = Math.max(total - 9, 0);
      add(b, "r300", h1 + h3);
      add(b, "r390", h2);
    }
  }
}

export function aggregate(rows: AttendanceRow[]): RateBuckets {
  const b = EMPTY_BUCKETS();
  for (const r of rows) distributeDay(r, b);
  return b;
}

/** Approximate monthly money: hourly = LCB / standardHoursPerMonth, then sum rate*hours. */
export interface SalaryInputs {
  lcb: number;
  chuyen_can: number;
  doi_song: number;
  tham_nien: number;
  standardHours?: number; // default 208 (26 days * 8h)
  rows?: AttendanceRow[];
  periodStart?: string; // yyyy-mm-dd
}

function localDateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function hasFullWeekdayAttendance(rows: AttendanceRow[], periodStart: string): boolean {
  const today = localDateKey(new Date());
  const endDate = today < periodStart ? periodStart : today;
  const attendedDates = new Set(rows.map((r) => r.date));
  const [sy, sm, sd] = periodStart.split("-").map(Number);
  const cursor = new Date(sy, sm - 1, sd);
  const end = new Date(endDate + "T00:00:00");

  while (cursor <= end) {
    const dow = cursor.getDay();
    if (dow !== 0) {
      const key = localDateKey(cursor);
      if (!attendedDates.has(key)) return false;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return true;
}

function countEligibleDoiSongDays(rows: AttendanceRow[]): number {
  return rows.filter((r) => {
    const dow = new Date(r.date + "T00:00:00").getDay();
    return dow !== 0 && !r.is_holiday;
  }).length;
}

export function calcSalary(b: RateBuckets, inputs: SalaryInputs) {
  const std = inputs.standardHours || 208;
  const hourly = inputs.lcb && std ? inputs.lcb / std : 0;
  const moneyOf = (rate: number, hours: number) => hourly * (rate / 100) * hours;
  const wage =
    moneyOf(100, b.r100) +
    moneyOf(130, b.r130) +
    moneyOf(150, b.r150) +
    moneyOf(200, b.r200) +
    moneyOf(270, b.r270) +
    moneyOf(300, b.r300) +
    moneyOf(390, b.r390);

  let allowance: number;
  if (inputs.rows && inputs.periodStart) {
    const chuyenCan = hasFullWeekdayAttendance(inputs.rows, inputs.periodStart)
      ? inputs.chuyen_can || 0
      : 0;
    const doiSong = ((inputs.doi_song || 0) / 26) * countEligibleDoiSongDays(inputs.rows);
    const thamNien = inputs.tham_nien || 0;
    allowance = chuyenCan + doiSong + thamNien;
  } else {
    allowance = (inputs.chuyen_can || 0) + (inputs.doi_song || 0) + (inputs.tham_nien || 0);
  }

  return { wage, allowance, total: wage + allowance, hourly };
}

export function formatVND(n: number) {
  if (!isFinite(n)) n = 0;
  return Math.round(n).toLocaleString("vi-VN") + " đ";
}
