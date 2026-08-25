# Kế hoạch nhập dữ liệu HR PRO (HRP)

## 📊 Tổng quan

Đã phân tích file Excel `op_history_08_25_0139.xlsx` và chuẩn bị script migration để nhập:

- **664 NLĐ** (người lao động)
- **758 lịch sử đi làm**
- **44 nhà máy** (tự động tạo nếu thiếu)
- **4 nhà chính/đối tác** (HRP, Hoàng Long 2, VD Tùng, KTV)
- **15 tài khoản staff người tuyển** (mật khẩu: `nv123456`)

## ✅ Dữ liệu đã được làm sạch

File Excel đã xử lý:
- ✅ Đã bổ sung đầy đủ **Nhà chính** (0 dòng trống)
- ✅ Đã loại bỏ dòng thiếu **Ngày vào làm**
- ✅ Đã loại bỏ dòng thiếu cả **Người tuyển & Vendor**
- ⚠️ CCCD sai độ dài (19 dòng) - chấp nhận, sửa sau
- ⚠️ Ngày sinh bất thường - chấp nhận, sửa sau
- ⚠️ SĐT sai định dạng (4 dòng) - chấp nhận

## 🎯 Quyết định đã chốt

1. **Vendor = Đối tác** trong mục người tuyển (cột `recruiter_partner`)
2. **Người tuyển = Nhân viên nội bộ** (tạo tài khoản staff với mật khẩu `nv123456`)
3. **ID trùng = cùng 1 NLĐ**, nhiều lịch sử
4. **Ngày cấp CCCD**: để trống (bỏ ràng buộc bắt buộc)

## 🚀 Cách chạy

### Bước 1: Chạy DRY-RUN (kiểm tra, không ghi dữ liệu)

```bash
cd "D:/My App/newApp"
node scripts/migrate-hrp-history.mjs
```

**Output mẫu:**
```
🔌 Đang kết nối PocketBase...
✅ Đã kết nối superadmin

📋 Tìm công ty code="HRP"...
✅ Tenant: HR Pro (chhhqbrzi2arr4d)
   Prefix: HRP

📂 Đọc file: C:\Users\admin\Documents\HiTech files\application\op_history_08_25_0139.xlsx
✅ Đọc được 758 dòng từ sheet "History"
   Gom được 664 NLĐ (có 94 dòng lịch sử bổ sung)

...

📊 BÁO CÁO DRY-RUN (chưa ghi dữ liệu)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NLĐ sẽ tạo: 664
Lịch sử sẽ tạo: 758
Tham chiếu sẽ tạo:
  - Nhà máy: 44
  - Nhà chính/Vendor: 4
  - Staff (người tuyển): 15

👤 Tài khoản staff sẽ tạo (mật khẩu: nv123456):
   1. Nguyễn Thị Thúy Lương → username: hrp__nguyen_thi_thuy_luong
   ...

⚠️  Lỗi: 0 dòng

💡 Chạy lại với --apply để ghi dữ liệu vào PocketBase
```

### Bước 2: Ghi dữ liệu thực tế (--apply)

**⚠️ CHỈ CHẠY SAU KHI ĐÃ KIỂM TRA KỸ BÁO CÁO DRY-RUN!**

```bash
node scripts/migrate-hrp-history.mjs --apply
```

**Thời gian ước tính:** 5-10 phút

Script sẽ:
1. ✅ Tạo 44 nhà máy
2. ✅ Tạo 4 nhà chính/vendor
3. ✅ Tạo 15 tài khoản staff
4. ✅ Tạo 664 workers + cccd_versions
5. ✅ Tạo 758 employment_histories

### Bước 3: Kiểm tra kết quả

```bash
# Kiểm tra console output
# Output mong đợi:
✨ HOÀN TẤT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Thành công: 664 NLĐ
Thất bại: 0 NLĐ
Lỗi tổng: 0
```

Nếu có lỗi, kiểm tra file: `import_hrp_errors.json`

## 📋 15 tài khoản staff được tạo

**Mật khẩu mặc định:** `nv123456` (cần đổi sau lần đăng nhập đầu)

| # | Họ tên | Username | Số lịch sử |
|---|--------|----------|------------|
| 1 | Nguyễn Văn phương | `hrp__nguyen_van_phuong` | 225 |
| 2 | Nguyễn Thị Thúy Lương | `hrp__nguyen_thi_thuy_luong` | 183 |
| 3 | Phạm Tiến Huỳnh | `hrp__pham_tien_huynh` | 38 |
| 4 | Phùng Thị Nhàn | `hrp__phung_thi_nhan` | 36 |
| 5 | Vi Ngọc Lan | `hrp__vi_ngoc_lan` | 35 |
| 6 | Vũ Hoàng Chang | `hrp__vu_hoang_chang` | 23 |
| 7 | Phạm Thị Thu Hương | `hrp__pham_thi_thu_huong` | 19 |
| 8 | Hoàng Minh Hưng | `hrp__hoang_minh_hung` | 13 |
| 9 | Ngô Thị Dịu | `hrp__ngo_thi_diu` | 9 |
| 10 | Đào Thị Hải Nhi | `hrp__dao_thi_hai_nhi` | 7 |
| 11 | Trần Thị Bảo Ngọc | `hrp__tran_thi_bao_ngoc` | 5 |
| 12 | Trương Thị Thanh Nga | `hrp__truong_thi_thanh_nga` | 5 |
| 13 | Nguyễn Văn Hinh | `hrp__nguyen_van_hinh` | 3 |
| 14 | Nguyễn Văn Dũng | `hrp__nguyen_van_dung` | 1 |
| 15 | Nguyễn Minh Hiếu | `hrp__nguyen_minh_hieu` | 1 |

## 📁 Files liên quan

| File | Mô tả |
|------|-------|
| `scripts/migrate-hrp-history.mjs` | Script migration chính |
| `scripts/HUONG_DAN_MIGRATE_HRP.md` | Hướng dẫn chi tiết đầy đủ |
| `IMPORT_HRP_README.md` | Tài liệu này (tổng hợp) |
| `import_hrp_errors.json` | File lỗi (nếu có, sau khi chạy --apply) |

## ⚠️ Lưu ý quan trọng

1. **Script KHÔNG tự rollback** - chạy nhiều lần sẽ tạo dữ liệu trùng!
2. **Kiểm tra kỹ dry-run** trước khi `--apply`
3. **Backup database** trước khi chạy (recommended)
4. **Đổi mật khẩu** cho 15 staff sau khi nhập xong

## 🔧 Tùy chọn nâng cao

```bash
# Chỉ định file Excel khác
node scripts/migrate-hrp-history.mjs --file="D:/path/to/other.xlsx"

# Chạy với file khác + apply
node scripts/migrate-hrp-history.mjs --file="D:/path/to/other.xlsx" --apply
```

## 🆘 Xử lý lỗi

### Lỗi: "Thiếu cấu hình PocketBase"

Kiểm tra file `.env`:
```bash
cat .env
```

Cần có:
```
PB_URL=http://localhost:8090
PB_ADMIN_EMAIL=admin@example.com
PB_ADMIN_PASSWORD=your_password
```

### Lỗi: "Không tìm thấy công ty code=HRP"

Tạo công ty HRP qua PocketBase Admin UI hoặc script khác trước.

### Lỗi: "File không tồn tại"

```bash
# Kiểm tra file
ls "C:\Users\admin\Documents\HiTech files\application\op_history_08_25_0139.xlsx"

# Hoặc chỉ định đường dẫn khác
node scripts/migrate-hrp-history.mjs --file="D:/path/to/file.xlsx"
```

## 📈 Kế hoạch sau khi import

1. ✅ Import xong → Kiểm tra số liệu trong PocketBase Admin UI
2. ✅ Đổi mật khẩu cho 15 staff: `nv123456` → mật khẩu mạnh
3. ✅ Sửa CCCD sai độ dài (19 dòng)
4. ✅ Sửa ngày sinh bất thường
5. ✅ Sửa SĐT sai định dạng (4 dòng)

## 📞 Hỗ trợ

Nếu gặp vấn đề:
1. Kiểm tra console output chi tiết
2. Đọc file `import_hrp_errors.json` (nếu có)
3. Xem PocketBase logs: `pb_data/logs/`
4. Đọc hướng dẫn chi tiết: `scripts/HUONG_DAN_MIGRATE_HRP.md`

---

**Tác giả:** Claude (Kiro)  
**Ngày:** 2026-08-25  
**Phiên bản:** 1.0
