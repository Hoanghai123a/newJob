# PocketBase 0.380 - Schema mở rộng JobConnect

Thư mục này chứa các file JSON dùng để import nhanh các collection mới phục vụ phần nhân sự staff (QLNM + người tuyển) và lịch sử đi làm theo nhà máy. Tất cả file cần giữ UTF-8 để copy/paste sang PocketBase không bị vỡ dấu tiếng Việt.

## Thứ tự import

1. Mở PocketBase Admin UI -> Settings -> Import collections.
2. Dán nội dung từ `pb_collections_staff.json` hoặc upload file.
3. Bấm `Review`, sau đó `Confirm and import`.

File này chỉ chứa các collection mới cần thêm:

- `factories`
- `factory_managers`
- `employment_histories`
- `staff_action_logs`
- `push_subscriptions` (nếu bật thông báo PWA)

Collection `app_settings` cần có field Select `staff_employment_factory_scope` với các giá trị
`assigned` và `all`. Giá trị mặc định là `assigned`; field này cho phép Admin quyết định staff
được chọn nhà máy được phân công hay toàn bộ nhà máy trong luồng Tạo nhanh và Báo đi làm mới.

Collection `users` đã có sẵn. Chỉ cần đảm bảo field `role` chấp nhận thêm giá trị `staff` (xem hướng dẫn ở `users-role-update.md`).
Luồng tạo nhanh NLĐ trong mục danh sách lao động còn cần rule `users.create/update`
cho admin/staff và các field ảnh CCCD/ngân hàng/ngày sinh như hướng dẫn trong
`users-role-update.md`.

## Rule cần có trong PocketBase

- `employment_histories`
  - `listRule` / `viewRule`: admin, staff, hoặc chính NLĐ thông qua relation `user` tới `workers`.
  - `createRule`: chỉ admin hoặc staff. User thường không được tự tạo lịch sử đi làm mới.
  - `updateRule`: admin, staff, hoặc chính user. App chỉ mở luồng user tự báo nghỉ; các quyền chi tiết hơn được kiểm tra ở frontend.
  - Field lịch sử đi làm cần có `worker_tax_code_snapshot` để lưu mã số thuế theo từng nhà máy/lịch sử, không lấy cứng từ hồ sơ user.
  - Giữ index `idx_emphist_one_active` để mỗi user chỉ có một bản ghi `working`.
  - Luồng **Nối TN** tìm theo mã NV/nhà máy và kiểm tra lịch sử gần nhất theo từng NLĐ.
    Nên có thêm composite index `idx_emphist_lookup_join` trên
    `(factory, employee_code, join_date DESC, created DESC)` và `idx_emphist_user_latest` trên
    `(user, join_date DESC, created DESC)` để dữ liệu lớn vẫn phân trang nhanh.
- `salary_holds`
  - C?n field text `rejection_reason` (t?i ?a 1000 k? t?) ?? l?u l? do Admin t? ch?i.
  - `updateRule` b?t bu?c g?i `rejection_reason` khi chuy?n tr?ng th?i t? `received` sang `rejected`.
- `advances`, `check_attendance_items`, `check_salary_items`
  - Cần cho staff đọc/tạo theo luồng app đang dùng.
  - PocketBase rule không biểu đạt gọn được điều kiện "người tuyển trong 3 lịch sử gần nhất", nên app bắt buộc kiểm tra quyền trước khi gọi API.
  - Để staff thu hồi đơn ứng trước khi admin duyệt, cập nhật `deleteRule` theo
    [`advances-withdraw-rule.md`](./advances-withdraw-rule.md).

## Sau khi import

- Tạo bản ghi trong `factories`, sau đó gán `factory_managers` để staff có dữ liệu chạy.
- Khi muốn báo đi làm nhà máy mới, bản ghi cũ của user phải có `status = "left"` và `leave_date` trước.
- Admin có toàn quyền cập nhật lịch sử. Staff chỉ thao tác theo vai trò:
  - Người tuyển: là staff nằm trong `recruiter_staff` của tối đa 3 lịch sử đi làm gần nhất của user.
  - QLNM: là staff được admin gán trong `factory_managers`.

## Quan hệ chính

```text
users (admin / user / staff)
  -> factory_managers.staff
  -> employment_histories.user
  -> employment_histories.recruiter_staff

factories
  -> factory_managers.factory
  -> employment_histories.factory

staff_action_logs
  -> actor (users)
  -> target_user (users; giữ liên kết tài khoản để tương thích nhật ký cũ)
```

## Quyền nghiệp vụ trong app

- Người tuyển được báo ứng, xem check công/check lương, báo nghỉ và báo đi làm cho user trong phạm vi 3 lịch sử gần nhất.
- QLNM được báo nghỉ cho nhà máy đang quản lý và báo đi làm vào nhà máy mình quản lý.
- User thường chỉ được tự báo nghỉ, không được tự báo đi làm mới.
- Mọi thao tác xuất/import/báo ứng/báo nghỉ/báo đi làm/cập nhật STK/chỉnh lịch sử đều được ghi vào `staff_action_logs` khi app thực hiện được thao tác.
- Tạo nhanh NLĐ ghi đồng thời `users`, `employment_histories`, `cccd_versions`
  (nếu có ảnh/số CCCD) và `staff_action_logs`.

## Thông báo PWA

- Import thêm `pb_collections_push_notifications.json` để có collection `push_subscriptions`.
- Rule của `push_subscriptions`: user chỉ xem/sửa/xóa thiết bị của chính mình; API server dùng quyền admin để đọc danh sách thiết bị khi cần gửi Web Push.
- Cần cấu hình biến môi trường trên server app: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
- API gửi thông báo cần quyền đọc `push_subscriptions` phía server qua `PB_ADMIN_TOKEN` hoặc `PB_ADMIN_EMAIL` + `PB_ADMIN_PASSWORD`.

## Batch API cho import NLĐ và lịch sử

Chức năng **Nhập dữ liệu -> Tạo hàng loạt NLĐ và lịch sử đi làm** dùng PocketBase Batch API để tạo một tài khoản cùng toàn bộ lịch sử của NLĐ trong một giao dịch. Không cần thêm collection hoặc field mới.

Trong PocketBase Admin UI, vào **Settings -> Application -> Batch requests** và cấu hình:

- Bật Batch API.
- Đặt `Max requests` tối thiểu là `40`.
- Giữ quyền tạo hiện tại cho admin đối với `users`, `employment_histories` và `staff_action_logs`.

Nếu Batch API chưa bật hoặc giới hạn request thấp hơn cấu hình của app, luồng import sẽ báo lỗi và không chuyển sang cách tạo tuần tự.

## Tiến độ công việc Admin

Trong PocketBase Admin UI, vào **Collections -> Import collections**, chọn
`pb_collections_work_progress.json` và xác nhận import để tạo ba collection dùng chung cho các
tài khoản Admin:

- `work_progress_tabs`: tên và thứ tự các tab công việc.
- `work_progress_statuses`: trạng thái thuộc từng tab; trạng thái cuối cùng được tính là hoàn thành.
- `work_progress_tasks`: công việc và trạng thái hiện tại.

Cả ba collection chỉ cho phép tài khoản có `role = "admin"` đọc và thay đổi dữ liệu. Relation từ trạng thái/công việc tới tab bật cascade delete; relation từ công việc tới trạng thái không cascade để ngăn xóa trạng thái đang được sử dụng. Giữ file JSON và tài liệu ở UTF-8 để không lỗi tiếng Việt.

Lưu ý: chỉ import file này khi ba collection chưa tồn tại. Nếu đã có dữ liệu thực tế, hãy sao lưu
PocketBase và đối chiếu field, rule, relation cascade cùng index trước khi cập nhật schema; không
xóa collection thủ công vì sẽ mất toàn bộ tab, trạng thái và công việc liên quan.

## Thống kê giờ

- Không cần thêm collection hoặc field mới. Trang `/staff/hour-stats` đọc trực tiếp `check_attendance_items`, `check_salary_items` và `employment_histories`.
- `check_attendance_items` và `check_salary_items` cần giữ `listRule` / `viewRule` cho `admin`, `staff` và chính NLĐ theo luồng check công/lương hiện có.
- Staff chỉ được hiển thị dữ liệu có `employment_histories.recruiter_staff = @request.auth.id`; ứng dụng kiểm tra phạm vi này trước khi tổng hợp và hiển thị.
- Trang thống kê chỉ đọc dữ liệu, không yêu cầu thêm quyền tạo, sửa hoặc xóa.

## Di chuyển ảnh CCCD từ `users` sang CCCD Version

Ảnh CCCD chỉ được lưu tại `cccd_versions`. Thực hiện trên bản sao lưu PocketBase và theo đúng thứ tự:

```bash
npm run pb:audit-cccd-versions -- --report=cccd-audit.json
npm run pb:migrate-cccd-versions -- --report=cccd-migrate.json
npm run pb:audit-cccd-versions -- --report=cccd-audit-after.json
npm run pb:finalize-cccd-versions -- --report=cccd-finalize.json
```

- Với history thiếu/sai số CMND/CCCD, migration chủ động dùng `users.cccd` nếu field này hợp lệ; đồng thời cập nhật lại snapshot và relation version.
- Nếu cả history và `users.cccd` đều không hợp lệ, history và ảnh cũ tương ứng được ghi vào danh sách `skipped*`, chấp nhận bỏ qua và không chặn xóa field ảnh cũ.
- Migration không ghi đè ảnh đã tồn tại trên CCCD Version; ảnh version là dữ liệu chính thức.
- Finalize tự chạy migration trước khi đổi schema. Nếu còn history bị bỏ qua, `cccd_version` được giữ không bắt buộc; nếu không còn history bỏ qua, relation được đặt bắt buộc. Sau đó lệnh xóa `users.cccd_front/cccd_back`.
- Trước khi chạy phải sao lưu cả database và thư mục file của PocketBase, đồng thời tạm dừng thao tác cập nhật ảnh.

## Nâng cấp relation NLĐ

Khi ứng dụng dùng collection `workers` làm hồ sơ NLĐ, `employment_histories.user` và `cccd_versions.user` vẫn giữ relation tới `users` để đảm bảo tương thích dữ liệu hiện hữu. Hai collection này xác thực và kiểm tra cùng công ty qua `users -> workers.auth_user`; API tạo lịch sử tự chuyển ID hồ sơ NLĐ thành ID tài khoản đăng nhập trước khi ghi.

Chạy `npm run pb:upgrade-worker-relations` để kiểm tra và tạo/liên kết `workers.auth_user` cho các NLĐ cũ. Lệnh mặc định chỉ kiểm tra, ghi báo cáo tại `docs/migration-audit/worker-relation-upgrade-report.json`; chỉ chạy với `--apply` khi báo cáo không có bản ghi chưa ánh xạ an toàn.
