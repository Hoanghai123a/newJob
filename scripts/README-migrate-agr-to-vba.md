# Migration: Đổi mã ngân hàng AGR → VBA

## Mục đích

Script này cập nhật tất cả bản ghi trong database có mã ngân hàng "AGR" (Agribank) thành "VBA" theo chuẩn mới - áp dụng cho toàn bộ workers, không phân biệt tenant.

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
# Chạy migration cho toàn bộ database
node scripts/migrate-agr-to-vba.mjs
```

### 3. Kiểm tra kết quả

Script sẽ hiển thị:
- Số lượng bản ghi tìm thấy
- Danh sách workers sẽ được cập nhật (UID, tên, số tài khoản)
- Kết quả từng bản ghi (thành công/lỗi)
- Tổng kết cuối cùng

## Output mẫu

```
🔧 Migration: AGR -> VBA cho toàn bộ workers
✅ Đăng nhập admin thành công

📊 Tìm thấy 3 bản ghi có mã ngân hàng AGR

🔍 Các bản ghi sẽ được cập nhật:
  1. HRP000100 - Nguyễn Văn A | Tài khoản: 1234567890
  2. HRP000200 - Trần Thị B | Tài khoản: 0987654321
  3. HRP000300 - Lê Văn C | Tài khoản: N/A

⏳ Bắt đầu migration...
  ✅ Updated: HRP000100 - Nguyễn Văn A
  ✅ Updated: HRP000200 - Trần Thị B
  ✅ Updated: HRP000300 - Lê Văn C

==================================================
✅ Hoàn thành migration
   - Thành công: 3
   - Lỗi: 0
==================================================
```

## Lưu ý

- Script chỉ update trường `bank_name` trong collection `workers`
- Không ảnh hưởng đến các trường khác (bank_account_number, bank_account_name, v.v.)
- An toàn để chạy nhiều lần (idempotent) - nếu không có dữ liệu AGR thì skip
- Cần quyền admin của PocketBase để chạy
- Áp dụng cho tất cả workers trong database, không phân biệt tenant

## Rollback (nếu cần)

Nếu cần quay lại mã cũ:

```javascript
// Tạo script tương tự nhưng đổi ngược lại
await pb.collection("workers").update(worker.id, {
  bank_name: "AGR",
});
```
