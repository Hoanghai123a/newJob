# Hướng dẫn: Thâm niên tích lũy

## Tổng quan

Tính năng **thâm niên tích lũy** tự động tính tổng số ngày làm việc của NLĐ từ **tất cả các lần đi làm trước đó**, không bao gồm lần hiện tại.

## Cách tính

Thâm niên tích lũy của một lịch sử = Tổng số ngày làm việc của **tất cả các lịch sử trước đó** (theo join_date) của cùng worker.

**Ví dụ:**

NLĐ A có lịch sử:
1. Nhà máy X: 1/7/2026 → 8/7/2026 (7 ngày)
   - **Thâm niên tích lũy = 0** (không có lần nào trước)

2. Nhà máy Y: 15/7/2026 → 30/7/2026 (15 ngày)
   - **Thâm niên tích lũy = 7** (7 ngày từ nhà máy X)

3. Nhà máy Z: 1/9/2026 → hiện tại
   - **Thâm niên tích lũy = 22** (7 từ X + 15 từ Y)

## Khi nào tính

- **Tự động tính khi tạo mới** lịch sử đi làm qua API `/api/employment-histories`
- Hiển thị trong UI: màn hình lịch sử đi làm của worker và NLĐ

## Migration dữ liệu cũ

Để cập nhật thâm niên tích lũy cho các lịch sử hiện có, chạy script:

```bash
node scripts/backfill-accumulated-seniority.mjs --code=<COMPANY_CODE>
```

**Ví dụ:**
```bash
node scripts/backfill-accumulated-seniority.mjs --code=HL
```

Script sẽ:
1. Lấy tất cả workers của công ty
2. Lấy tất cả lịch sử đi làm, sort theo join_date
3. Tính lại thâm niên tích lũy cho từng lịch sử
4. Cập nhật vào database

## Schema

**Collection:** `employment_histories`

**Trường mới:**
```json
{
  "name": "accumulated_seniority_days",
  "type": "number",
  "required": false,
  "min": 0,
  "onlyInt": true
}
```

## Code

**Interface TypeScript:**
```typescript
export interface EmploymentHistoryRecord {
  // ... các trường khác
  accumulated_seniority_days?: number;
}
```

**Hàm tính toán:**
- `calculateWorkingDays(history)` - Tính số ngày làm của một lịch sử
- `calculateAccumulatedSeniority(workerId, newJoinDate, allHistories)` - Tính thâm niên tích lũy

**Vị trí:** `src/lib/employment.ts`

## UI

Thông tin hiển thị tại:
1. **UserWorkHistoryPanel** - Màn hình lịch sử của NLĐ
2. **WorkerEmploymentDrawer** - Màn hình quản lý lịch sử của staff/admin

Định dạng hiển thị: `{số} ngày` (ví dụ: "22 ngày")

## Lưu ý

- Nếu chưa có `leave_date`, số ngày tính đến hôm nay
- Thâm niên tích lũy = 0 nếu đây là lần đi làm đầu tiên
- Script migration có thể chạy nhiều lần (idempotent)
