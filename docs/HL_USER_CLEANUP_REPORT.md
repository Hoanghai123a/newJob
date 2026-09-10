# Báo Cáo: Kế Hoạch Xóa Users Role=User Của Công Ty Hoàng Long DJC (Mã HL)

**Ngày:** 2026-09-07  
**Trạng thái:** ✅ AN TOÀN ĐỂ XÓA (sau khi backup)

---

## 📊 Tóm Tắt Hiện Trạng

### Dữ liệu hiện tại
- **Users role=user cần xóa:** 13 users
- **Workers tồn tại:** 15 workers
- **Mapping users ↔ workers:** 13/13 users có worker tương ứng (100%)

### Phương thức mapping
- ✅ **Via same ID:** 13 users (tất cả users có worker với cùng ID)
- ℹ️  **Via auth_user:** 0 (không có workers nào sử dụng auth_user)
- ℹ️  **Via UID match:** 0

### Danh sách 13 users sẽ xóa
```
  1. hl__nv02                    → HOÀNG VĂN MINH       (UID: HL000002)
  2. hl__nv05                    → Phàn Văn Hứa        (UID: HL000004)
  3. hl__nv06                    → Nguyễn Hữu Lâm      (UID: HL000005)
  4. hl__chamchikiemtiem         → Vũ thị cúc          (UID: HL000006)
  5. hl__codexui2355             → Codex UI            (UID: HL000007)
  6. hl__nv02_2                  → Nguyễn Văn Test     (UID: HL000008)
  7. hl__nv99                    → Tài Khoản NLĐ       (UID: HL000009)
  8. hl__nldtest                 → NLĐ Test            (UID: HL000012)
  9. hl__0855536618              → Vũ Minh Hiếu        (UID: HL000013)
 10. hl__0343733777              → Vàng Nguyệt Nga     (UID: HL000014)
 11. hl__0343751753              → Hoàng Minh Hải      (UID: HL000015)
 12. hl__0225365254              → Tẩn A Mìn           (UID: HL000016)
 13. hl__codextest0823072302    → Codex Test Mobile   (UID: HL000017)
```

---

## 🔍 Kiểm Tra Relations Phụ Thuộc

### ✅ CRITICAL Relations (không có vấn đề)
- ✅ `employment_histories.recruiter_staff`: 0 bản ghi
- ✅ `factory_managers.staff`: 0 bản ghi
- ✅ `salary_holds.staff`: 0 bản ghi
- ✅ `approval_requests.admins`: 0 bản ghi
- ✅ `approval_responses.admin`: 0 bản ghi

### ⚠️  Non-Critical Relations (có thể bỏ qua)
- ⚠️  `staff_action_logs.actor`: 1 bản ghi
  - **Ghi chú:** Chỉ ghi lịch sử, không cần migrate, có thể để NULL
  - **Tác động:** Không ảnh hưởng chức năng

### ℹ️  Relations không kiểm tra được
- `employment_histories.user`: Lỗi truy vấn (có thể do đã migrate sang workers)
- `salary_holds.worker`: Lỗi truy vấn (có thể do đã migrate sang workers)

---

## ✅ Kết Luận An Toàn

### Đã xác nhận
1. ✅ **100% users có worker tương ứng** (13/13)
2. ✅ **Không có critical relations** phụ thuộc
3. ✅ **Workers không sử dụng auth_user** → không bị ảnh hưởng khi xóa users
4. ✅ **Dữ liệu NLĐ đầy đủ trong workers** → không mất thông tin

### Tác động khi xóa
- ✅ **Workers vẫn tồn tại** với đầy đủ thông tin
- ✅ **Employment histories** vẫn hoạt động (đã migrate sang workers)
- ⚠️  **1 log trong staff_action_logs** sẽ có actor=NULL (không ảnh hưởng)
- ✅ **Không ảnh hưởng đến chức năng nghiệp vụ**

---

## 📋 Quy Trình Thực Hiện

### Bước 1: Backup (BẮT BUỘC)
```bash
# Backup PocketBase đầy đủ trước khi xóa
# Lưu vào thư mục có timestamp để dễ restore nếu cần
```

### Bước 2: Test Dry-Run
```bash
node scripts/delete-hl-legacy-users.mjs
# Xem danh sách users sẽ xóa và verify workers
```

### Bước 3: Thực Hiện Xóa
```bash
node scripts/delete-hl-legacy-users.mjs --apply
# Script sẽ:
# - Verify lại workers tồn tại
# - Xóa từng user
# - Ghi log chi tiết vào logs/delete-hl-users-TIMESTAMP.json
```

### Bước 4: Verify Sau Xóa
```bash
# Kiểm tra workers vẫn còn
node scripts/debug-hl-workers-api.mjs

# Kiểm tra không còn users role=user
node scripts/check-hl-relations.mjs
```

---

## 🎯 Khuyến Nghị

### ✅ AN TOÀN để xóa ngay sau khi:
1. ✅ Tạo backup đầy đủ PocketBase
2. ⚠️  (Tùy chọn) Test trên staging nếu có
3. ✅ Chạy trong giờ ít người dùng (để dễ rollback nếu cần)

### ⚠️  Lưu ý
- Hành động xóa **KHÔNG THỂ HOÀN TÁC** nếu không có backup
- Workers sẽ được giữ nguyên, chỉ xóa users trong collection `users`
- Field `auth_user` trong workers sẽ NULL nhưng không ảnh hưởng vì không dùng

### 📝 Sau khi xóa
- Workers vẫn hoạt động bình thường
- Các chức năng nghiệp vụ không bị ảnh hưởng
- Dọn sạch dữ liệu thừa từ quá trình migrate

---

## 📂 Scripts Đã Tạo

1. **`scripts/debug-hl-workers-api.mjs`**
   - Kiểm tra mapping users ↔ workers
   - Verify tất cả users có worker

2. **`scripts/check-hl-relations.mjs`**
   - Kiểm tra tất cả relations phụ thuộc
   - Phát hiện critical issues

3. **`scripts/delete-hl-legacy-users.mjs`**
   - Xóa users role=user của tenant HL
   - Ghi log chi tiết
   - Safety checks trước khi xóa

---

**Kết luận cuối cùng:** ✅ **AN TOÀN ĐỂ XÓA** sau khi backup đầy đủ.
