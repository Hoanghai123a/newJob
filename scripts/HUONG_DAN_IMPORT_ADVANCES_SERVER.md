# Hướng dẫn nhập phiếu ứng lương HR Pro (HRP) lên server

## Dữ liệu nguồn

File: `export_pheduyet_all.xlsx`, sheet **History** — 54 dòng dữ liệu (dòng 1 là tiêu đề), tổng **60.200.000đ**.

| Cột | Tiêu đề | Dùng để |
|-----|---------|---------|
| A | ID NLĐ | **Khoá chính** — xác định NLĐ nào báo ứng (UID worker, ví dụ `HRP000847`) |
| B | Tên NLĐ | `full_name` |
| C | Số tiền | `amount` + `original_amount` |
| D | Tình trạng | `status` + `disbursed` |
| E | Thu hồi | `recovery_status` |
| F | Người tạo | `requested_by` (đối chiếu theo tên staff) |
| G | Công ty NLĐ | Nhà máy — dùng xác định lần đi làm |
| H | MNV đi làm | Mã nhân viên — dùng xác định lần đi làm |
| I | CCCD đi làm | (không dùng, rỗng toàn bộ) |
| J | Ngày vào làm | `join_date` (nếu rỗng thì lấy từ lần đi làm khớp được) |
| K | Hình thức thanh toán | `payout_method` |
| L | Người thụ hưởng | (không map vào field nào) |
| M | Ngày tạo | **Ngày báo ứng** → `disbursed_at`, `resolved_at`, và dùng để dò lần đi làm |

Cột M là số serial Excel (ví dụ `46258.586574074077`), script tự chuyển thành `2026-08-24 14:04:40`.

## Cách xác định lần đi làm của mỗi phiếu ứng

Một NLĐ có thể đi làm nhiều lần ở nhiều nhà máy khác nhau. Phiếu ứng phải gắn đúng lần đi làm để mã nhân viên và nhà máy trên phiếu chính xác. Script dùng 2 cách:

**Cách 1 — Có đủ MNV + nhà máy (32/54 dòng)**

Khớp `employment_histories` theo `employee_code` + tên nhà máy. Tên nhà máy so khớp không phân biệt hoa/thường và dấu, nhưng giá trị ghi vào phiếu luôn lấy **tên chuẩn trong DB** (ví dụ Excel ghi `ABILITY`, DB ghi `Ability` → phiếu lưu `Ability`). Điều này quan trọng vì bộ lọc nhà máy trên giao diện so khớp `advances.company` với `factories.name` nguyên văn.

**Cách 2 — Thiếu MNV và nhà máy (22/54 dòng)**

Lấy toàn bộ lần đi làm của NLĐ đó, tìm lần nào có khoảng `[ngày vào làm → ngày nghỉ]` **chứa ngày báo ứng** (cột M). Sau đó lấy `employee_code`, tên nhà máy, `join_date` từ lần đi làm đó.

Ví dụ dòng 52 — Lù Văn Phương (`HRP000504`), báo ứng 2026-06-12, không có MNV/nhà máy. NLĐ này có 2 lần đi làm:
- `2026-03-21 → 2026-04-14` tại HEASUNG
- `2026-05-07 → 2026-08-06` tại HAEYOUN ← ngày 12/06 nằm trong khoảng này

→ Phiếu được gắn MNV `9001556`, nhà máy `HAEYOUN`, ngày vào làm `2026-05-07`.

Nếu ngày báo ứng không nằm trong khoảng nào, script lùi dần: lần đi làm gần nhất có ngày vào làm trước ngày báo ứng (`date_nearest_before`), rồi lần sớm nhất (`date_earliest_fallback`). Cách đã dùng được ghi rõ cho từng dòng trong báo cáo dry-run.

Với dữ liệu hiện tại, **cả 54 dòng đều gắn được lần đi làm** — 32 dòng theo cách 1, 22 dòng theo cách 2 (tất cả đều là `date_contained`, tức khớp chính xác trong khoảng, không cần fallback).

## Yêu cầu trước khi chạy

1. Công ty `code="HRP"` đã có trong collection `companies` trên server.
2. Dữ liệu NLĐ và lịch sử đi làm đã được nhập (script đối chiếu dựa trên đó). Nếu chưa, chạy `migrate-hrp-history.mjs` trước.
3. Thông tin admin PocketBase của server.

## Các bước thực hiện

### Bước 1 — Upload file Excel lên server

```bash
scp "D:/My App/export_pheduyet_all.xlsx" user@your-server:/path/to/newApp/
```

### Bước 2 — SSH vào server

```bash
ssh user@your-server
```

### Bước 3 — Tạo file cấu hình kết nối

```bash
cd /path/to/newApp && cat > .env.production << 'EOF'
PB_URL=https://your-server.com
PB_ADMIN_EMAIL=admin@example.com
PB_ADMIN_PASSWORD=your_password
EOF
```

```bash
chmod 600 .env.production
```

`.gitignore` đã chặn `.env.*` nên file này không bị commit.

Để đỡ phải lặp lại 3 biến ở mỗi lệnh, nạp chúng vào shell một lần:

```bash
set -a && . ./.env.production && set +a
```

### Bước 4 — Chạy dry-run (chưa ghi gì)

```bash
node scripts/import-advances-hrp.mjs --file=export_pheduyet_all.xlsx
```

Kết quả cần thấy:

```
✅ 54 dòng dữ liệu
✅ Chuẩn bị xong: 54 phiếu | 0 lỗi | 22 cảnh báo

Sẽ tạo     : 54
Lỗi        : 0
Tổng tiền  : 60.200.000đ

🔍 Cách xác định lần đi làm:
   mnv+factory: 32
   date_contained: 22

⚠️  Phiếu không gắn được lần đi làm: 0
```

22 cảnh báo là **bình thường** — mỗi cảnh báo ghi lại một dòng được dò theo ngày báo ứng, kèm lần đi làm đã khớp để đối chiếu bằng mắt.

Cần kiểm tra kỹ 3 điểm:
- `Sẽ tạo` = 54 và `Lỗi` = 0
- `Phiếu không gắn được lần đi làm` = 0
- Mục `Cách xác định lần đi làm` không có dòng nào là `date_nearest_before`, `date_earliest_fallback`, hay `no_history` — nếu có, dữ liệu lịch sử đi làm trên server khác local, cần xem lại từng dòng đó.

Toàn bộ payload sẽ ghi được lưu ở `import_advances_hrp_dryrun.json` để đối chiếu chi tiết.

### Bước 5 — Xoá dữ liệu import cũ (nếu có)

Nếu server đã từng import phiếu ứng HRP, dry-run sẽ cảnh báo và `--apply` bị chặn. Xoá dữ liệu cũ trước:

```bash
node scripts/rollback-advances-hrp.mjs
```

Xem danh sách rồi xoá thật:

```bash
node scripts/rollback-advances-hrp.mjs --apply
```

Script chỉ xoá phiếu có `reason="Import từ HRP"`, không ảnh hưởng phiếu do người dùng tự tạo trên hệ thống.

### Bước 6 — Ghi dữ liệu

```bash
node scripts/import-advances-hrp.mjs --file=export_pheduyet_all.xlsx --apply
```

```
✨ HOÀN TẤT
Thành công: 54
Thất bại  : 0
```

### Bước 7 — Kiểm tra

Trên PocketBase Admin UI (`https://your-server.com/_/`), mở collection `advances`, lọc `reason="Import từ HRP"` → phải có đúng **54** bản ghi.

Hoặc chạy lại rollback ở chế độ dry-run để đếm:

```bash
node scripts/rollback-advances-hrp.mjs
```

Kiểm tra thêm trên giao diện ứng dụng: vào trang quản lý ứng lương, dùng bộ lọc nhà máy — phiếu phải hiện đúng theo nhà máy đã dò được (HAEYOUN 13, JAGER 11, SONG HÀO 9, COSONIC 7, Ability 3, ACTRO 3, NEWFACE 2, GS 2, OPTRONTEC 1, SOLUM 1, VITALINK 1, Compal 1).

### Bước 8 — Dọn dẹp

```bash
rm .env.production
```

## Xử lý lỗi

**`Thiếu cấu hình PocketBase`** — chưa nạp biến môi trường. Chạy lại `set -a && . ./.env.production && set +a`.

**`Không tìm thấy công ty code="HRP"`** — server chưa có công ty HRP. Tạo qua Admin UI trước.

**`Không tìm thấy worker UID="..."`** — NLĐ chưa tồn tại trên server. Chạy `migrate-hrp-history.mjs` trước, hoặc kiểm tra UID trong Excel. Script tự thử bỏ dấu gạch ngang (`HRP-000316` → `HRP000316`) nên lỗi này nghĩa là UID thực sự không có.

**`ĐÃ CÓ N phiếu với reason="Import từ HRP"`** — cơ chế chống trùng, không phải lỗi. Xem Bước 5. Nếu thực sự muốn thêm chồng lên dữ liệu cũ, thêm cờ `--force` (tự chịu trách nhiệm về trùng lặp).

**Cách xác định lần đi làm hiện `no_history`** — NLĐ không có lịch sử đi làm nào, phiếu vẫn được tạo nhưng `employee_code` rơi về UID và `company` để rỗng. Cần bổ sung lịch sử đi làm rồi import lại.

## Ghi chú kỹ thuật

`created` của bản ghi PocketBase là thời điểm import, không phải ngày báo ứng — PocketBase không cho ghi đè field này. Ngày báo ứng thật được lưu ở `disbursed_at` và `resolved_at`. Nếu báo cáo cần lọc theo ngày báo ứng, dùng 2 field đó thay vì `created`.

File Excel không còn cột ID phiếu (`PDOC-*`) như bản export cũ, nên không có khoá để dedupe từng phiếu. Cơ chế chống trùng hoạt động ở mức cả lô (theo `reason`).
