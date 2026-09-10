# Cài đặt khóa thao tác báo ứng

Tính năng sử dụng bản ghi singleton trong collection `app_settings`.

## Field cần thêm

- Tên field: `advance_reporting_enabled`
- Kiểu: `Bool`
- Giá trị khởi tạo cho bản ghi hiện tại: `true`
- User/Staff chỉ cần quyền `list/view` collection `app_settings`.
- Chỉ Admin được quyền `create/update` collection `app_settings` như cấu hình hiện tại.

## Thứ tự triển khai

1. Mở PocketBase Admin UI, chọn collection `app_settings`.
2. Thêm field Bool `advance_reporting_enabled`.
3. Cập nhật bản ghi singleton hiện tại thành `true`.
4. Triển khai frontend mới.
5. Dùng công tắc tại trang **Ứng lương** của Admin để chuyển User/Staff giữa chế độ thao tác và chỉ xem.

Không thay đổi rule của collection `advances`. Việc khóa được kiểm tra trong ứng dụng; nếu cần chặn cả lệnh gọi API trực tiếp thì phải bổ sung PocketBase rule hoặc server endpoint riêng.
