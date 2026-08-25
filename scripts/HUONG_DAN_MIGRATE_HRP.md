# Hướng dẫn nhập dữ liệu lịch sử lao động HR PRO

## Tổng quan

Script `migrate-hrp-history.mjs` nhập dữ liệu từ file Excel lịch sử lao động vào hệ thống cho công ty **HR PRO (HRP)**.

**Dữ liệu sẽ nhập:**
- 664 NLĐ (người lao động)
- 758 lịch sử đi làm
- 46 nhà máy
- 4 nhà chính/đối tác
- 15 tài khoản staff (người tuyển)

## Yêu cầu

1. File `.env` phải có đầy đủ:
   ```
   PB_URL=http://localhost:8090
   PB_ADMIN_EMAIL=admin@example.com
   PB_ADMIN_PASSWORD=your_password
   ```

2. Công ty **HR PRO** với `code="HRP"` đã tồn tại trong collection `companies`

3. File Excel đã chuẩn bị tại: `C:\Users\admin\Documents\HiTech files\application\op_history_08_25_0139.xlsx`

## Các bước thực hiện

### Bước 1: Kiểm tra kết nối

Mở terminal tại thư mục dự án:

```bash
cd "D:/My App/newApp"
```

### Bước 2: Chạy DRY-RUN (không ghi dữ liệu)

```bash
node scripts/migrate-hrp-history.mjs
```

Script sẽ:
- Kết nối PocketBase
- Đọc file Excel
- Phân tích dữ liệu
- Hiển thị báo cáo chi tiết:
  - Số NLĐ sẽ tạo
  - Số lịch sử sẽ tạo
  - Nhà máy, nhà chính, vendor thiếu
  - 15 tài khoản staff sẽ tạo
  - Danh sách lỗi (nếu có)

**Kiểm tra kỹ báo cáo** trước khi ghi thực tế!

### Bước 3: Ghi dữ liệu thực tế (--apply)

Sau khi đã kiểm tra báo cáo dry-run và chấp nhận, chạy:

```bash
node scripts/migrate-hrp-history.mjs --apply
```

Script sẽ:
1. Tạo nhà máy thiếu
2. Tạo nhà chính/vendor thiếu
3. Tạo 15 tài khoản staff (mật khẩu: `nv123456`)
4. Tạo workers + cccd_versions
5. Tạo employment_histories

**⏱️ Thời gian ước tính:** 5-10 phút (tùy tốc độ kết nối PocketBase)

### Bước 4: Kiểm tra kết quả

Sau khi hoàn tất, kiểm tra:

1. **Console output:**
   ```
   ✨ HOÀN TẤT
   Thành công: 664 NLĐ
   Thất bại: 0 NLĐ
   ```

2. **File lỗi (nếu có):** `import_hrp_errors.json`

3. **Trong PocketBase Admin UI:**
   - Collection `workers`: kiểm tra số lượng NLĐ mới
   - Collection `employment_histories`: kiểm tra lịch sử
   - Collection `users`: kiểm tra 15 staff mới

## Tài khoản staff được tạo

15 tài khoản với **mật khẩu mặc định: `nv123456`**

| Họ tên | Username |
|--------|----------|
| Nguyễn Văn phương | `hrp__nguyen_van_phuong` |
| Nguyễn Thị Thúy Lương | `hrp__nguyen_thi_thuy_luong` |
| Phạm Tiến Huỳnh | `hrp__pham_tien_huynh` |
| Phùng Thị Nhàn | `hrp__phung_thi_nhan` |
| Vi Ngọc Lan | `hrp__vi_ngoc_lan` |
| Vũ Hoàng Chang | `hrp__vu_hoang_chang` |
| Phạm Thị Thu Hương | `hrp__pham_thi_thu_huong` |
| Hoàng Minh Hưng | `hrp__hoang_minh_hung` |
| Ngô Thị Dịu | `hrp__ngo_thi_diu` |
| Đào Thị Hải Nhi | `hrp__dao_thi_hai_nhi` |
| Trần Thị Bảo Ngọc | `hrp__tran_thi_bao_ngoc` |
| Trương Thị Thanh Nga | `hrp__truong_thi_thanh_nga` |
| Nguyễn Văn Hinh | `hrp__nguyen_van_hinh` |
| Nguyễn Văn Dũng | `hrp__nguyen_van_dung` |
| Nguyễn Minh Hiếu | `hrp__nguyen_minh_hieu` |

**⚠️ Lưu ý:** Cần đổi mật khẩu sau lần đăng nhập đầu tiên!

## Tùy chọn nâng cao

### Chỉ định file Excel khác

```bash
node scripts/migrate-hrp-history.mjs --file="D:/path/to/other.xlsx"
```

### Chạy lại khi lỗi

Nếu có lỗi, sửa dữ liệu và chạy lại:

```bash
node scripts/migrate-hrp-history.mjs --apply
```

Script **không xóa** dữ liệu cũ, có thể tạo trùng nếu chạy nhiều lần!

## Xử lý lỗi thường gặp

### Lỗi: "Thiếu cấu hình PocketBase"

**Nguyên nhân:** File `.env` thiếu hoặc sai cấu hình

**Giải pháp:**
```bash
# Kiểm tra file .env
cat .env

# Hoặc tạo lại
echo "PB_URL=http://localhost:8090" > .env
echo "PB_ADMIN_EMAIL=admin@example.com" >> .env
echo "PB_ADMIN_PASSWORD=your_password" >> .env
```

### Lỗi: "Không tìm thấy công ty code=HRP"

**Nguyên nhân:** Chưa có công ty HRP trong database

**Giải pháp:** Tạo công ty HRP qua PocketBase Admin UI hoặc script khác

### Lỗi: "File không tồn tại"

**Nguyên nhân:** Đường dẫn file Excel sai

**Giải pháp:**
```bash
# Kiểm tra file tồn tại
ls "C:\Users\admin\Documents\HiTech files\application\op_history_08_25_0139.xlsx"

# Hoặc chỉ định đường dẫn khác
node scripts/migrate-hrp-history.mjs --file="D:/path/to/file.xlsx"
```

### Lỗi: "Trùng CCCD" hoặc "Trùng username"

**Nguyên nhân:** Đã có NLĐ/staff với thông tin trùng

**Giải pháp:** Kiểm tra dữ liệu trong file `import_hrp_errors.json`, sửa/xóa dữ liệu cũ trong PocketBase

## Rollback (khôi phục)

Script **không tự rollback**. Nếu cần xóa dữ liệu đã nhập:

1. **Thủ công qua PocketBase Admin UI:**
   - Xóa workers có `uid` bắt đầu bằng `HRP000...`
   - Xóa employment_histories tương ứng (cascade)
   - Xóa 15 staff có username `hrp__...`

2. **Hoặc viết script rollback riêng** (không có sẵn)

## Hỗ trợ

Nếu gặp vấn đề, kiểm tra:

1. **Console output** chi tiết
2. **File `import_hrp_errors.json`** (nếu có)
3. **PocketBase logs** tại `pb_data/logs/`

---

**Tác giả:** Claude (Kiro)  
**Phiên bản:** 1.0  
**Ngày tạo:** 2026-08-25
