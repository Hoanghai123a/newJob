# Rule thu hồi ứng lương của staff

Collection `advances` đã tồn tại trong PocketBase nên không có trong các file import collection mới
của dự án. Cập nhật riêng `deleteRule` trong PocketBase Admin UI:

```txt
@request.auth.role = "admin" || (@request.auth.role = "staff" && status = "recruiter_approved" && (requested_by = @request.auth.id || recruiter_id = @request.auth.id))
```

Rule này cho phép:

- Admin tiếp tục được xóa bản ghi.
- Staff chỉ được xóa đơn chưa được admin xử lý (`recruiter_approved`).
- Staff chỉ được xóa đơn do chính mình gửi (`requested_by`) hoặc đơn NLĐ do mình chuyển lên
  (`recruiter_id`).

Ứng dụng ghi toàn bộ snapshot đơn vào `staff_action_logs` trước khi xóa khỏi `advances`.
Không thay đổi rule của `staff_action_logs`: tài khoản đã đăng nhập được tạo log, chỉ admin được đọc.
