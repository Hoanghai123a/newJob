# Xóa hồ sơ người lao động an toàn

## Mục đích

Luồng xóa NLĐ của Admin yêu cầu xem trước dữ liệu, xác nhận đã nắm rõ thông tin và xác thực lại mật khẩu. Hệ thống chỉ cho phép xóa tài khoản được tạo trong vòng **72 giờ** tính từ trường hệ thống `created` của PocketBase. Nếu còn nghiệp vụ tiền, ứng dụng phải chặn xóa và hướng dẫn Admin xử lý nghiệp vụ hoặc vô hiệu hóa tài khoản.

Kiểm tra 72 giờ được thực hiện ở backend bằng thời điểm hiện tại của server. Giao diện chỉ là lớp hỗ trợ; không thể vượt qua giới hạn bằng cách gọi API trực tiếp hoặc thay đổi dữ liệu trên client.

## Luồng xác nhận

- Popup gọi API `preview` để kiểm tra `created` và hiển thị thời điểm tạo, thời hạn xóa cùng dữ liệu liên quan.
- Admin phải tick xác nhận đã đọc và hiểu hậu quả.
- Sau khi tick, popup mới hiển thị ô nhập mật khẩu và nút xóa.
- API `delete` kiểm tra lại tài khoản và cửa sổ 72 giờ ngay trước khi tạo batch xóa để tránh trường hợp popup mở quá lâu.

## Cấu hình PocketBase

### Collection `users`

- `deleteRule`: `@request.auth.role = "admin"`
- Không mở quyền xóa cho `staff` hoặc `user`.
- Backend phải đọc được trường hệ thống `created`.
- Chỉ cho phép xóa nếu `created + 72 giờ > thời điểm hiện tại của server`.
- Không cần thêm field mới hoặc thay thế kiểm tra này chỉ bằng PocketBase rule.

### Collection `staff_action_logs`

- `createRule`: `@request.auth.id != ""`
- Field `action` phải chấp nhận giá trị `delete`.
- Field `target_user` không bắt buộc và giữ `cascadeDelete = false`.
- Field `target_record` là Text, dùng để lưu ID tài khoản đã xóa.
- Field `before` là JSON, dùng để lưu snapshot tài khoản trước khi xóa.

### Batch API

Trong PocketBase Admin UI, vào **Settings → Application → Batch requests**:

- Bật Batch API.
- `Max requests` tối thiểu là `2`; cấu hình khuyến nghị chung của dự án là `40`.

Ứng dụng tạo log và xóa tài khoản trong cùng một batch. Nếu một request thất bại, toàn bộ giao dịch phải rollback.

## Dữ liệu chặn xóa

Chỉ các nghiệp vụ liên quan tới tiền mới chặn xóa:

- Yêu cầu ứng lương trong `advances`.
- Dữ liệu giữ lương trong `salary_holds`.
- Yêu cầu phê duyệt của NLĐ có `amount > 0`.

`employment_histories`, `cccd_versions`, dữ liệu check công trong `check_attendance_items`, dữ liệu check lương trong `check_salary_items`, sổ tay và dữ liệu trò chơi không chặn xóa. Để dữ liệu check công/check lương không chặn xóa tài khoản và vẫn được giữ lại, field relation `user` của `check_attendance_items` và `check_salary_items` phải cho phép rỗng (`required = false`) và giữ `cascadeDelete = false`. Các bản ghi có relation `cascadeDelete = true` sẽ bị PocketBase xóa cùng tài khoản. Cần hiển thị cảnh báo rõ vì hành động không thể hoàn tác. Collection chưa được cài đặt sẽ được bỏ qua; lỗi quyền hoặc lỗi truy vấn khác vẫn dừng thao tác để tránh xóa thiếu an toàn.

## Nhật ký

Log xóa không lưu mật khẩu và không giữ relation tới tài khoản đã xóa. Thông tin nhận diện tối thiểu được lưu trong `before`, gồm ID, UID, username, họ tên, số điện thoại, vai trò và trạng thái tài khoản.
