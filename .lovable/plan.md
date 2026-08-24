## Vấn đề

- Request `GET /api/collections/factories/records` trả 404 `Missing collection context` → collection **`factories`** chưa tồn tại trong PocketBase.
- Collection **`app_settings`** đã có (id `pbc_3126690926`) nhưng schema hiện tại chỉ có: `name, logoUrl, companies, requireApproval`. Code đang ghi `company_name, slogan, address, hotline, email, about, logo` → các field này bị bỏ qua. Bằng chứng: PATCH trả về `"name":""` dù bạn gửi `company_name=Hoàng Long`, và `address` không xuất hiện trong response.

## Schema cần tạo trong PocketBase

### 1) Collection `app_settings` (Base) — cập nhật / tạo lại

| Field          | Type                               | Ghi chú                    |
| -------------- | ---------------------------------- | -------------------------- |
| `company_name` | text                               | Tên công ty                |
| `slogan`       | text                               |                            |
| `address`      | text                               | Có thể dán URL Google Maps |
| `hotline`      | text                               |                            |
| `email`        | email                              |                            |
| `about`        | editor / text (multi-line)         | Giới thiệu                 |
| `logo`         | file (single, image, maxSize ~5MB) |                            |

API Rules: `listRule` & `viewRule` = `""` (public read, để trang Về chúng tôi đọc được khi chưa đăng nhập). `createRule` / `updateRule` / `deleteRule` = `@request.auth.role = "admin"`.

> Lưu ý: chỉ nên có **1 record** duy nhất trong collection này (code dùng `getList(1,1)`).

### 2) Collection `factories` (Base) — tạo mới

| Field     | Type                   | Ghi chú                    |
| --------- | ---------------------- | -------------------------- |
| `name`    | text (required, min 1) | Tên nhà máy                |
| `address` | text                   | Có thể dán URL Google Maps |
| `hotline` | text                   |                            |
| `note`    | text (multi-line)      | Ghi chú                    |

API Rules:

- `listRule` / `viewRule` = `@request.auth.id != ""` (user đã đăng nhập đều xem được — dùng cho dropdown chọn nhà máy ở trang Tài khoản).
- `createRule` / `updateRule` / `deleteRule` = `@request.auth.role = "admin"`.

Index gợi ý: `CREATE UNIQUE INDEX idx_factories_name ON factories (name)` để tránh trùng tên.

## Cách kiểm tra nhanh sau khi tạo

1. Mở PocketBase Admin → Collections → đảm bảo cả 2 collection xuất hiện với đúng field như trên.
2. Vào `/admin/settings` tab **Nhà máy** → bấm **+** thêm 1 nhà máy thử → list phải hiện ra (không còn 404).
3. Tab **Công ty** → nhập "Tên công ty / Địa chỉ" → Lưu → reload → các field phải giữ giá trị (chứng tỏ field đã tồn tại).
4. Mở `/about` (không đăng nhập cũng được) → thấy địa chỉ hiển thị dạng link Google Maps.

## Không cần đổi code

Toàn bộ code phía frontend (`app-settings.ts`, `admin/settings.tsx`, `account.tsx → FactorySelect`) đã đúng với schema trên. Chỉ cần tạo/cập nhật collection trong PocketBase là hết lỗi.
