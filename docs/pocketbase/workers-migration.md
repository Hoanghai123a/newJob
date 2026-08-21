# Chuyển NLĐ từ `users` sang `workers`

## Mục tiêu

Collection `users` chỉ còn tài khoản đăng nhập `super_admin`, `admin`, `staff`. NLĐ được lưu tại collection thường `workers`; collection này không có email, mật khẩu hoặc token.

## Quy trình bắt buộc

1. Sao lưu database PocketBase và thư mục file trước khi chạy.
2. Chạy kiểm tra, không thay đổi dữ liệu:

```powershell
npm run pb:migrate-workers
```

3. Rà báo cáo `legacyUsers`, `relationChanges` và `unresolved`. Chỉ tiếp tục khi `unresolved` rỗng.
4. Tạo `workers`, sao chép hồ sơ bằng chính ID cũ và đổi relation đích:

```powershell
npm run pb:migrate-workers -- --apply
```

5. Kiểm tra trên giao diện Admin/Staff: danh sách NLĐ, CCCD, lịch sử, công/lương, ứng lương và giữ lương.
6. Khi đã xác nhận, xóa tài khoản NLĐ cũ:

```powershell
npm run pb:migrate-workers -- --apply --delete-legacy-users
```

Script chỉ xóa khi mọi relation NLĐ đã không còn trỏ về collection auth `users`. Nếu phát hiện bản ghi không thể chuyển, script trả mã lỗi và không xóa tài khoản cũ.

## Thay đổi PocketBase

- Tạo `workers` với hồ sơ cá nhân, ngân hàng, UID, trạng thái và relation công ty nếu collection `companies` đang tồn tại.
- Các relation tên `user`, `worker`, `target_user`, `challenger`, `opponent`, `winner` đang trỏ tới `users` được đổi sang `workers`; các relation người thao tác như `actor`, `staff`, `admin`, `recruiter_staff` vẫn trỏ `users`.
- Rule của relation NLĐ được bỏ điều kiện tự truy cập theo `@request.auth.id`; Admin/Staff tiếp tục truy cập theo rule collection hiện hữu.
