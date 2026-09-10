# Audit và sửa UID trùng trong `users`

Quy trình này **không xóa, không gộp tài khoản và không đổi PocketBase record ID**. Repair chỉ cập nhật trường `users.uid` ở các dòng được duyệt.

## 1. Sao lưu PocketBase

Tạo backup trước khi audit và giữ nguyên backup cho đến khi hoàn tất đối soát.

## 2. Xuất CSV audit

```bash
npm run pb:audit-duplicate-user-uids
```

Có thể chọn thư mục đầu ra:

```bash
npm run pb:audit-duplicate-user-uids -- --output-dir uid-audit-output
```

CSV được ghi UTF-8 BOM, có thể mở bằng Excel. Script chấm điểm dựa trên lịch sử đi làm đang hoạt động, số lịch sử, chấm công, bảng công/lương, ứng lương, giữ lương và độ đầy đủ hồ sơ.

## 3. Duyệt CSV

Với mỗi `old_uid`:

- Phải có đúng một dòng `decision=KEEP` và để trống `new_uid`.
- Các dòng còn lại dùng `decision=CHANGE` và có `new_uid` duy nhất.
- Kiểm tra kỹ dòng `risk=REVIEW`, nhất là nhóm có từ 5 tài khoản, trùng CCCD/SĐT hoặc nhiều tài khoản đang làm.
- Chỉ sau khi duyệt xong, đổi `approved` thành `YES` cho **toàn bộ dòng trong nhóm**.
- Không xóa dòng khỏi CSV. Repair sẽ từ chối nếu PocketBase còn nhóm trùng không có trong CSV.

## 4. Kiểm tra không ghi dữ liệu

```bash
npm run pb:repair-duplicate-user-uids -- --input uid-audit-output/duplicate-user-uids-audit-....csv
```

Mặc định là dry-run. Script xác nhận user vẫn tồn tại, UID chưa đổi, đúng một KEEP, UID mới không trùng và toàn bộ dòng đã được duyệt.

## 5. Áp dụng

```bash
npm run pb:repair-duplicate-user-uids -- --apply --input uid-audit-output/duplicate-user-uids-audit-....csv
```

Kết quả gồm file đã áp dụng và file rollback. Nếu lỗi giữa chừng, script dừng ngay và ghi rollback cho các dòng đã đổi.

## 6. Đối soát và tạo unique index

```bash
npm run pb:init-uid-counters
```

Kết quả mong đợi:

```json
{
  "duplicates": [],
  "uniqueIndexes": {
    "users": true,
    "employmentHistories": true
  }
}
```

Lưu bảng ánh xạ UID cũ/mới để đối chiếu các file Excel bên ngoài.
