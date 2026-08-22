# PocketBase: Đa công ty và SuperAdmin

## Chuẩn bị

1. Sao lưu file dữ liệu và thư mục file PocketBase.
2. Script tự thêm lựa chọn `super_admin` vào `users.role` nếu thiếu; sau khi áp dụng, kiểm tra lại field này trong PocketBase Admin UI.
3. Chạy kiểm tra không thay đổi dữ liệu:

```powershell
npm run pb:migrate-multitenancy
```

4. Rà soát báo cáo. Nếu báo cáo có `group_chat_messages` thiếu `room`, kiểm tra sao lưu rồi chạy lệnh khôi phục có chủ đích. Lệnh này tạo phòng `Thông báo dữ liệu cũ` và chuyển các tin nhắn mồ côi vào phòng đó:

```powershell
npm run pb:migrate-multitenancy -- --apply --repair-orphan-chat-messages
```

5. Khi dry-run không còn `invalidRecords`, chạy migration chính:

```powershell
npm run pb:migrate-multitenancy -- --apply
```

## Tương thích dữ liệu cũ

Một số collection cũ (`advances`, `recruitments`) đã dùng field text `company` để lưu nhãn nghiệp vụ như `Compal`, `GoerTek` hoặc `TK Tech`. Script **không thay đổi hay xóa** field này.

- Nếu collection đã có field `company` (text hoặc relation khác), script giữ nguyên field đó và thêm `tenant_company` là relation tới `companies`.
- Nếu collection chưa có field `company`, script thêm relation tenant với tên `company`.
- Riêng `users` dùng `tenant_company`; field `company` cũ không bị đổi kiểu vì PocketBase không cho thay đổi kiểu field đã tồn tại.
- Migration có thể chạy lại an toàn; nếu relation tenant đã đúng, script không tạo field trùng lặp.

## Thay đổi được script áp dụng

- Tạo collection `companies`: mã duy nhất, tên, trạng thái, thông tin liên hệ và hạn mức `max_accounts`, `max_workers`, `max_factories`, `max_file_bytes`.
- Bổ sung relation tenant cho collection nghiệp vụ; không thay đổi `uid_counters` và collection hệ thống không thuộc tenant.
- Không tự tạo công ty mặc định hoặc gán hàng loạt bản ghi thiếu tenant. Dry-run xuất `unresolved`; chỉ backfill khi có bằng chứng xác định duy nhất từ quan hệ hiện có.

## Rules bắt buộc sau khi backfill

Dùng field tenant thực tế của collection:

- Collection chưa có `company` cũ: `company`.
- Mọi collection có `company` tồn tại từ trước, bao gồm `users`, `advances`, `recruitments`: `tenant_company`.

Đặt `listRule` và `viewRule` theo công thức, thay `<tenant_field>` bằng field phù hợp:

```text
<tenant_field> = @request.auth.company
```

Đặt `createRule`/`updateRule` theo quyền cũ **và** ràng buộc:

```text
@request.body.<tenant_field> = @request.auth.company
```

Với relation tới `users`, `factories`, `employment_histories`, phải thêm điều kiện relation đó cùng tenant field bằng `@request.auth.company`. Không cấp quyền nghiệp vụ cho `super_admin`; role này chỉ có rule CRUD với collection `companies` và API `/api/super-admin/*`.

Sau khi backfill và kiểm tra hoàn tất, đặt relation tenant thành bắt buộc theo từng collection. Không đặt `company` text của các collection tương thích thành bắt buộc như tenant relation.

## Cách xác minh trong PocketBase Admin UI

1. Mở **Collections > users > Fields > role**: danh sách phải có `super_admin`.
2. Mở **Collections > users > Fields**: phải có `tenant_company` kiểu Relation tới `companies`.
3. Mở **Collections > companies > Records**: phải có công ty `LEGACY` và trạng thái `active`.
4. Mở một bản ghi trong `users`: field `tenant_company` phải trỏ tới `LEGACY` (trừ tài khoản `super_admin`).
5. Chạy lại `npm run pb:migrate-multitenancy`: phần `verification` phải cho thấy `companyCount >= 1`; trong mỗi collection có `total > 0`, `assigned` phải bằng `total`.
