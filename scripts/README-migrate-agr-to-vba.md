# Migration: Đổi mã ngân hàng AGR → VBA

## Mục đích

Script này cập nhật tất cả bản ghi trong database có mã ngân hàng "AGR" (Agribank) thành "VBA" theo chuẩn mới.

## Khi nào cần chạy

- Sau khi cập nhật code từ AGR → VBA
- Khi có dữ liệu cũ trong database đang lưu mã "AGR"
- Trước khi triển khai lên production nếu có dữ liệu thật

## Cách chạy

### 1. Đảm bảo PocketBase đang chạy

```bash
# Khởi động PocketBase
npm run pocketbase
```

### 2. Chạy script migration

```bash
# Với mã công ty cụ thể
node scripts/migrate-agr-to-vba.mjs --code=HOANGLONGDJC

# Hoặc với biến môi trường cho admin
PB_ADMIN_EMAIL=admin@example.com PB_ADMIN_PASSWORD=xxx node scripts/migrate-agr-to-vba.mjs --code=HOANGLONGDJC
```

### 3. Kiểm tra kết quả

Script sẽ hiển thị:
- Số lượng bản ghi tìm thấy
- Danh sách users sẽ được cập nhật
- Kết quả từng bản ghi (thành công/lỗi)
- Tổng kết cuối cùng

## Output mẫu

```
🔧 Migration: AGR -> VBA cho tenant [HOANGLONGDJC]
✅ Đăng nhập admin thành công
📍 Tenant: HOANGLONGDJC

📊 Tìm thấy 3 bản ghi có mã ngân hàng AGR

🔍 Các bản ghi sẽ được cập nhật:
  1. NV001 | Tài khoản: 1234567890
  2. NV002 | Tài khoản: 0987654321
  3. NV003 | Tài khoản: N/A

⏳ Bắt đầu migration...
  ✅ Updated: NV001
  ✅ Updated: NV002
  ✅ Updated: NV003

==================================================
✅ Hoàn thành migration
   - Thành công: 3
   - Lỗi: 0
==================================================
```

## Lưu ý

- Script chỉ update trường `bank_name` trong collection `users`
- Không ảnh hưởng đến các trường khác (bank_account_number, bank_account_name, v.v.)
- An toàn để chạy nhiều lần (idempotent) - nếu không có dữ liệu AGR thì skip
- Cần quyền admin của PocketBase để chạy

## Rollback (nếu cần)

Nếu cần quay lại mã cũ:

```javascript
// Tạo script tương tự nhưng đổi ngược lại
await pb.collection("users").update(user.id, {
  bank_name: "AGR",
});
```
