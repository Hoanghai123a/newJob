# Hướng dẫn nhập phiếu ứng lương Đại Việt (DV)

Cập nhật 2026-08-27 theo file `Data_ung_DV.xlsx` bố cục **16 cột A–P, 245 dòng**.

## 1. Bố cục file Excel

Script khoá cứng tiêu đề ở hằng `EXPECTED_HEADERS`. Nếu file xuất ra đổi thứ tự cột,
script **dừng ngay** và in ra cột nào lệch, thay vì âm thầm ghi sai dữ liệu.

| Cột | Tiêu đề | Ghi vào `advances` | Ghi chú |
|-----|---------|--------------------|---------|
| A | Trạng thái | `status` | Chờ duyệt→`pending`, Từ chối→`rejected`, còn lại→`accepted` |
| B | $ yêu cầu | `amount` | Số nguyên đồng |
| C | Giải ngân | `disbursed` | Chỉ `Đã giải ngân` mới thành `true` |
| D | $ giải ngân | (không map) | File hiện tại toàn `0` |
| E | Thu hồi | `recovery_status` | Đã thu hồi→`recovered`, Không thể→`unrecoverable`, còn lại→`none` |
| F | Người tạo | `requested_by` | Đối chiếu tên với `users` role=staff |
| G | Tên NLĐ | `full_name` | Cũng dùng kiểm chứng khi đổi prefix UID |
| H | Người tuyển NLĐ | `recruiter_id` | Đối chiếu tên với `users` role=staff |
| I | ID NLĐ | (tìm `worker`) | UID người lao động — xem mục 2 |
| J | Công ty NLĐ | `company` | Tên nhà máy, 151 dòng để trống |
| K | Tên đi làm | (không map) | 244 dòng trống |
| L | MNV đi làm | `employee_code` | 151 dòng trống |
| M | Ngày vào làm | `join_date` | Dạng `2026-08-13`, 150 dòng trống |
| N | Hình thức thanh toán | `payout_method` | Tiền mặt→`cash`, còn lại→`bank_transfer` |
| O | Người thụ hưởng | (không map) | Schema `advances` không có field tương ứng |
| P | Ngày tạo | `disbursed_at`, `resolved_at` | **Số serial Excel** (46261 = 2026-08-27) |

So với file lần trước: file cũ có 20 cột A–T và cột ngày tạo là chuỗi
`2026-08-27 13:59:51`; file này còn 16 cột và ngày tạo thành số serial. Script xử lý
được cả hai dạng ngày, nhưng thứ tự cột phải đúng như bảng trên.

## 2. Vấn đề quan trọng: hai hệ prefix UID

Tenant DV trong DB có **hai hệ UID trên cùng dải số**:

- `DV*` — 1.358 người lao động
- `NLD*` — 216 người lao động (dữ liệu cũ)

File Excel lần này xuất `DV*` nên phần lớn dòng khớp trực tiếp. Nhưng 47 dòng có UID
`DV00xxxx` mà DB chỉ tồn tại bản `NLD00xxxx`, nên script phải dò thêm theo **phần số**
của UID.

Đã kiểm chứng việc đổi prefix có an toàn không bằng cách so tên: **47/47 dòng có tên ở
cột G khớp chính xác `full_name` của bản trong DB**, 0 dòng lệch. Đây là bằng chứng
`DV00xxxx` và `NLD00xxxx` là cùng một người.

Trong DB có 18 số tồn tại ở cả hai prefix, 3 số trong đó xuất hiện ở file. Với các số
này script chọn bản có lần đi làm **chứa ngày báo ứng**.

| Cách | Số dòng | Ý nghĩa |
|------|---------|---------|
| `uid_truc_tiep` | 194 | UID trong Excel có sẵn trong DB |
| `doi_prefix` | 47 | Chỉ khớp theo số → đổi `DV*`↔`NLD*`, đã kiểm chứng bằng tên |
| `nhieu_ban_chon_theo_ngay` | 3 | Trùng số ở cả 2 prefix, phân định được bằng ngày báo ứng |
| `nhieu_ban_khong_khop_ngay` | 1 | **Cần soi tay** — xem mục 4 |

Ba dòng UID viết `DV-000648` (có dấu gạch) vẫn tìm được `DV000648` vì script bỏ dấu
gạch trước khi tra.

## 3. Cách gắn lần đi làm (`employment_histories`)

| Cách | Số dòng | Ý nghĩa |
|------|---------|---------|
| `date_contained` | 149 | Ngày báo ứng nằm trong một khoảng `[join_date, leave_date]` |
| `mnv+factory` | 93 | Cột L + cột J khớp thẳng một lần đi làm |
| `date_nearest_before` | 2 | Báo ứng sau khi đã nghỉ → lấy lần đi làm gần nhất trước đó |
| `date_earliest_fallback` | 1 | Không có lần nào trước ngày báo ứng — dòng 214 |

Với nhánh `mnv+factory`, script luôn ghi **tên nhà máy chuẩn trong DB**
(`factories.name`), không dùng cách viết trong Excel, vì bộ lọc trên giao diện so
`advances.company` với `factories.name` nguyên văn. Đã kiểm: 245/245 tên nhà máy khớp
chính xác.

## 4. Dòng cần bạn quyết định

```
Dòng 214 | DV000040 | Lý Tầm Hoan | báo ứng 2026-01-27
   NLD000040 → NEWFACE, [2025-11-20 → 2026-01-25]  (trước 2 ngày)
   DV000040  → SJ,      [2026-01-28 → 2026-05-08]  (sau 1 ngày)
```

Ngày báo ứng kẹt trong khoảng 2 ngày giữa hai lần đi làm, không bản nào chứa nó. Script
chọn `DV000040` (khớp UID nguyên văn) rồi gắn vào lần đi làm SJ.

Hai dòng `date_nearest_before` còn lại rõ ràng hơn — báo ứng của kỳ vừa kết thúc:

```
Dòng 173 | DV000122 | Tráng Seo Sèng     | ứng 2026-03-25 → Compal [2025-10-20 → 2026-03-09]
Dòng 231 | DV000212 | NGUYỄN THỊ HẢI YẾN | ứng 2026-01-06 → Compal [2025-12-04 → 2025-12-25]
```

Cả ba dòng đều sửa được trên Admin UI sau khi import nếu bạn thấy cần đổi.

## 5. Kết quả đã chạy trên local

```
✅ 245 dòng dữ liệu | bố cục cột A–P khớp
✅ Chuẩn bị xong: 245 phiếu | 0 lỗi | 203 cảnh báo
Tổng tiền  : 274.350.000đ
Thành công : 245 | Thất bại: 0
```

Kiểm tra lại trong DB sau khi ghi:

```
status: pending=3, accepted=242
Thiếu company: 0 | join_date: 0 | requested_by: 0 | recruiter_id: 0 | employee_code: 0
cash: 5 | disbursed: 0 | có resolved_at: 242
```

Toàn bộ 12 tên ở cột F và 16 tên ở cột H đều tìm thấy staff tương ứng, không dòng nào
để trống `requested_by` hay `recruiter_id`.

Lần import trước (file 20 cột, 248 dòng, 280.757.000đ) đã được rollback trước khi ghi
bản mới. Đã kiểm 248 bản cũ không có bản nào bị sửa tay hay có ghi chú (`updated` =
`created`, không có `admin_note`), nên xoá đi không mất dữ liệu người dùng nhập.

## 6. Chạy trên server

### Bước 1 — chạy local trước cho chắc

```bash
node scripts/import-advances-dv.mjs
```

Đọc kỹ báo cáo. Chỉ đi tiếp khi `Lỗi = 0`.

### Bước 2 — copy file lên server

```bash
scp "D:/My App/Data_ung_DV.xlsx" user@server:/path/to/Data_ung_DV.xlsx
scp scripts/import-advances-dv.mjs scripts/rollback-advances-dv.mjs user@server:/path/newApp/scripts/
```

Script mặc định tìm file ở thư mục cha của repo. Đặt chỗ khác thì truyền
`--file=/duong/dan/Data_ung_DV.xlsx`.

### Bước 3 — tạo file env trỏ vào PocketBase production

Trên server:

```bash
cat > .env.production <<'EOF'
PB_URL=https://pb.ten-mien-cua-ban
PB_ADMIN_EMAIL=<email superuser>
PB_ADMIN_PASSWORD=<mật khẩu>
EOF
```

```bash
chmod 600 .env.production
```

`.gitignore` đã chặn `.env.*` nên file này không vào được git.

### Bước 4 — dry-run trên production

```bash
set -a && . ./.env.production && set +a && node scripts/import-advances-dv.mjs
```

`process.env` được ưu tiên hơn `.env`, nên không cần sửa gì trong script.

### Bước 5 — đối chiếu báo cáo trước khi ghi

Đây là bước quan trọng nhất. So mục `Cách tìm NLĐ` với local:

```
uid_truc_tiep: 194
doi_prefix: 47
nhieu_ban_chon_theo_ngay: 3
nhieu_ban_khong_khop_ngay: 1
```

Nếu con số lệch thì dải UID trên production khác local (ví dụ chỉ có `DV*`, không có
`NLD*`). Khi đó các dòng trùng số sẽ phân định khác đi và **phải kiểm tra trước khi
apply**, đừng chạy tiếp theo quán tính.

Kiểm luôn `Tổng tiền = 274.350.000đ` và `Lỗi = 0`.

### Bước 6 — nếu production đã có dữ liệu import cũ

```bash
node scripts/rollback-advances-dv.mjs
```

```bash
node scripts/rollback-advances-dv.mjs --apply
```

Rollback chỉ chạm phiếu có `reason="Import từ DV"` trong tenant DV, không ảnh hưởng
phiếu người dùng tạo tay.

Trước khi xoá, kiểm xem có bản nào đã bị sửa tay chưa (`updated` khác `created`, hoặc
có `admin_note`/`recovery_note`) — nếu có thì xoá sẽ mất phần người dùng đã nhập.

### Bước 7 — ghi thật

```bash
node scripts/import-advances-dv.mjs --apply
```

Script tự chặn nếu đã tồn tại phiếu `reason="Import từ DV"`. Muốn ghi đè có chủ đích
thì thêm `--force`, nhưng như vậy sẽ tạo dữ liệu **trùng lặp** — rollback trước sạch hơn.

### Bước 8 — kiểm tra trên giao diện

Vào Admin → Ứng lương, lọc tenant Đại Việt. Kiểm:

- Đếm được 245 phiếu
- Bộ lọc theo nhà máy hoạt động (chứng tỏ `company` khớp `factories.name`)
- Cột người tạo và người tuyển đều có tên, không trống
- Có 3 phiếu ở trạng thái Chờ duyệt

### Bước 9 — dọn dẹp

```bash
rm .env.production Data_ung_DV.xlsx import_advances_dv_dryrun.json
```

## 7. Các lỗi hay gặp

**`⛔ BỐ CỤC FILE KHÔNG ĐÚNG`** — file xuất ra đổi cột. Script in ra cột nào lệch, cần
gì và đang có gì. Nếu bố cục mới là đúng thì sửa `EXPECTED_HEADERS` cùng phần đọc cột
trong script, đừng bỏ qua kiểm tra này.

**`Không tìm thấy công ty code="DV"`** — sai server, hoặc tenant DV chưa được tạo trên
production. Kiểm `PB_URL` đang trỏ đâu.

**`Không tìm thấy worker UID="..."`** — người lao động chưa có trong tenant DV trên
production. Phải import `workers` trước khi import phiếu ứng.

**`Không tìm thấy staff "Người tạo" = "..."`** — tên trong Excel không khớp `users` nào
có role staff. Phiếu vẫn tạo được nhưng `requested_by` để trống. Kiểm chính tả tên.

**`⛔ ĐÃ CÓ N phiếu với reason="Import từ DV"`** — chống trùng. Rollback rồi chạy lại.

**Lỗi xác thực** — dùng tài khoản superuser của PocketBase. Script thử `_superusers`
trước, tự lùi về `pb.admins` cho bản server cũ.

## 8. Ghi chú kỹ thuật

`created` trong PocketBase là `autodate`, không ghi được — nó luôn là thời điểm chạy
import. Ngày tạo thật từ cột P được lưu vào `resolved_at` (khi trạng thái `accepted`)
và `disbursed_at` (khi đã giải ngân). File hiện tại không dòng nào đã giải ngân nên
`disbursed_at` trống toàn bộ.

`advances` không có khoá ngoại tới `employment_histories`. Lần đi làm chỉ thể hiện qua
ba field sao chép: `employee_code`, `company`, `join_date`. Vì vậy tên nhà máy phải khớp
`factories.name` nguyên văn, nếu không bộ lọc trên giao diện sẽ không thấy phiếu.

Serial Excel quy đổi theo `(serial - 25569) * 86400000` ms Unix, tức mốc 1899-12-30.
Cột P không có phần thập phân nên chỉ có ngày, không có giờ.

Cột `A` phải xét `"tu choi"` **trước** `"cho"` khi map trạng thái, vì chuỗi `tu choi`
cũng chứa `cho`. Tương tự cột `C` chỉ được nhận `"da giai ngan"`, không dùng
`includes("giai ngan")` vì `"chua giai ngan"` cũng khớp.
