# Sửa listRule collection `users` để Admin thấy Staff trong dropdown "Người tuyển"

## Vấn đề

Khi Admin đăng nhập và chọn "Người tuyển" trong form tạo/sửa lịch sử đi làm, dropdown chỉ hiển thị "Đối tác", không hiển thị danh sách Staff nội bộ.

## Nguyên nhân

Collection `users` trong PocketBase có `listRule` chỉ cho phép Admin/Staff đọc các user có `role="user"`, **KHÔNG cho phép đọc các user có `role="admin"` hoặc `role="staff"` khác**.

Ví dụ rule hiện tại:
```
@request.auth.role = "admin" || @request.auth.role = "staff" || id = @request.auth.id
```

Rule này chỉ cho phép:
- Admin đọc chính tài khoản của mình
- Staff đọc chính tài khoản của mình
- User đọc chính tài khoản của mình

**Nhưng KHÔNG cho phép Admin đọc danh sách Staff khác để hiển thị trong dropdown "Người tuyển".**

## Giải pháp

Cập nhật `listRule` và `viewRule` của collection `users` để cho phép Admin và Staff đọc các tài khoản **cùng công ty**, bao gồm cả Staff và Admin khác:

### Bước 1: Mở PocketBase Admin UI

Truy cập PocketBase Admin UI (thường là `http://localhost:8090/_/`)

### Bước 2: Vào collection `users`

1. Click vào **Collections** ở menu bên trái
2. Tìm và click vào collection `users` (hoặc `_pb_users_auth_`)

### Bước 3: Cập nhật API Rules

Click vào tab **API Rules**, sau đó cập nhật:

#### listRule (Cho phép list users):

```
(tenant_company = @request.auth.tenant_company) && (
  @request.auth.role = "admin" || 
  @request.auth.role = "staff" || 
  id = @request.auth.id
)
```

#### viewRule (Cho phép xem chi tiết user):

```
(tenant_company = @request.auth.tenant_company) && (
  @request.auth.role = "admin" || 
  @request.auth.role = "staff" || 
  id = @request.auth.id
)
```

### Giải thích rule mới

Rule mới sẽ:
1. **Kiểm tra cùng công ty**: `tenant_company = @request.auth.tenant_company`
2. **Cho phép Admin/Staff đọc TẤT CẢ user cùng công ty**: Bao gồm cả admin, staff, và user thường
3. **Cho phép User thường đọc chính mình**: `id = @request.auth.id`

### Bước 4: Lưu thay đổi

Click **Save changes** để áp dụng rule mới.

## Kiểm tra

Sau khi cập nhật:
1. Đăng xuất và đăng nhập lại bằng tài khoản Admin
2. Vào form tạo/sửa lịch sử đi làm
3. Click vào dropdown "Người tuyển"
4. Bạn sẽ thấy danh sách **Nhân sự nội bộ** bao gồm cả Admin và Staff

## Lưu ý bảo mật

- Rule mới chỉ cho phép đọc các user **cùng công ty** (`tenant_company`), không phải toàn bộ hệ thống
- Admin/Staff vẫn chỉ được **đọc**, không được sửa tài khoản user khác (trừ khi có quyền trong `updateRule`)
- Nếu cần siết chặt hơn, có thể giới hạn field được đọc bằng cách dùng server API endpoint thay vì query trực tiếp từ client
