# Cập nhật collection `users`

Collection `users` đã có sẵn nên không import đè ở đây.

## Thay đổi cần làm

1. Field `role` (Select):
   - Thêm giá trị `staff` vào danh sách lựa chọn (hiện đang có `admin`, `user`).
   - Giữ nguyên giá trị mặc định `user` cho tài khoản đăng ký mới.
2. Field `cccd` (Text, không bắt buộc):
   - Nếu chưa có thì tạo mới để lưu CCCD gốc của user. Lịch sử đi làm vẫn dùng
     `worker_cccd_snapshot` riêng, không lấy cứng từ field này.
3. Field `employee_code` (Text, không bắt buộc):
   - Tuỳ chọn, dùng làm mã NV mặc định khi user chưa gắn với nhà máy nào.
4. Các field ngân hàng (`bank_name`, `bank_account_number`, `bank_account_name`):
   - Đảm bảo đã tồn tại để staff có thể cập nhật STK cho user khi cần.
5. Ảnh CCCD không còn lưu trên `users`:
   - Không tạo hoặc sử dụng `cccd_front`, `cccd_back`.
   - Mọi ảnh mặt trước/mặt sau chỉ lưu tại `cccd_versions.front_image/back_image`.
   - Với hệ thống cũ, phải chạy quy trình migration CCCD Version trước khi xóa hai field này.

## Rule cần có cho luồng tạo nhanh NLĐ

Luồng tạo nhanh trong mục NLĐ tạo trực tiếp bản ghi `users`, sau đó tạo
`employment_histories` và `cccd_versions`. Vì lựa chọn hiện tại là mở rule
PocketBase trực tiếp cho staff, collection `users` cần:

- `createRule`: `@request.auth.role = "admin" || @request.auth.role = "staff"`
- `updateRule`: `@request.auth.role = "admin" || @request.auth.role = "staff" || id = @request.auth.id`

Popup **Báo đi làm mới** tìm trong toàn bộ hồ sơ NLĐ, vì vậy `listRule` / `viewRule`
của `users` cũng cần cho phép `admin` và `staff` đọc tài khoản có `role = "user"`.
Ứng dụng chỉ lấy họ tên, số điện thoại và định danh ở bước tìm kiếm; hồ sơ đầy đủ chỉ được tải
sau khi staff chọn một NLĐ.

Lưu ý: rule này mở quyền backend rộng hơn proxy/server endpoint có kiểm soát
field. Nếu cần siết tuyệt đối theo nhà máy/QLNM, nên chuyển luồng tạo nhanh sang
API server hoặc PocketBase hook để validate phạm vi trước khi tạo user.

Khuyến nghị thêm unique index/constraint cho `uid` và `username` nếu instance
PocketBase hiện tại chưa có, để tránh trùng tài khoản khi nhiều người tạo nhanh
cùng lúc.

## Ghi chú

- Không đổi tên collection `users` (`_pb_users_auth_`); các collection mới đã
  trỏ relation tới id hệ thống này.
- Sau khi cập nhật role, vào `/admin/staff` trong app để gán quyền qlnm và xem
  danh sách staff đang có.
