# Di chuyển JobConnect sang tenant HL

Target là `newApp`; `NewJobConnect` không nằm trong luồng này. Script thực thi lõi là `scripts/migrate-jobconnect-to-hl.mjs`.

## Kiểm tra trước khi apply

Hai PocketBase phải đang chạy ở `8090` (JobConnect) và `8290` (newApp), với `PB_ADMIN_EMAIL` và `PB_ADMIN_PASSWORD` trong `.env` của mỗi ứng dụng. `newApp/.env` phải có `PB_URL`; source đọc `JobConnect/.env`.

Chạy dry-run, không ghi PocketBase:

```powershell
$env:MIGRATION_TEMP_PASSWORD = "nv123456"
npm run migration:test
```

Preflight chỉ đọc, backup schema/record/file và ghi `docs/migration-audit/latest-jobconnect-to-hl-preflight.json`. Nó dừng nếu duplicate UID/ID, relation mồ côi, tenant mơ hồ hoặc lỗi build/lint. `employee_code` được phép trùng giữa các tenant; duplicate trong nguồn chỉ được giữ lại khi bật `MIGRATION_ALLOW_SOURCE_EMPLOYEE_CODE_DUPLICATES=1` và sẽ xuất hiện trong `warnings` để rà soát sau migration.

## Apply

Chỉ chạy sau khi dry-run có `unresolved: []`, đã kiểm tra báo cáo và đã khóa ghi JobConnect:

```powershell
$env:MIGRATION_TEMP_PASSWORD = "nv123456"
npm run migration:apply
```

Khi đã xác nhận mã `employee_code` trùng trong nguồn là dữ liệu cần giữ nguyên, thêm `$env:MIGRATION_ALLOW_SOURCE_EMPLOYEE_CODE_DUPLICATES = "1"` cho cả dry-run và apply. Không dùng cờ này để bỏ qua duplicate UID hoặc ID nguồn.

Apply yêu cầu preflight gần nhất đạt, tự tạo `migration_run_id`, thêm checkpoint sau từng nhóm và không xóa `HOANGLONGDJC`. Không dùng `--no-backup` khi apply production.

Không ghi mật khẩu tạm vào log, mapping hoặc file backup. Script tạo backup record đã loại trường xác thực, backup file kèm `files-manifest.json` và checksum, backup tenant test trước khi apply, sau đó tạo hoặc tái sử dụng company `Hoàng Long DJC` với mã `HL`. Tenant test không bị purge tự động.

## Thay đổi PocketBase

- Backup tenant test `HOANGLONGDJC`; cleanup xóa tenant chỉ thực hiện thủ công sau nghiệm thu, không chạm `HRP` hoặc `DV`.
- Tạo company `HL` trạng thái `active`.
- Bổ sung collection còn thiếu từ schema JobConnect (`complaints`, `attendance`, `guides`, `transport_contacts`, `guide_documents`) nếu chưa có.
- Các record nhập mới có `tenant_company`; worker có `source_user_id`; quan hệ legacy `user` được ánh xạ sang `worker`/`worker_profile` khi schema đích hỗ trợ.
- Tài khoản nhập có mật khẩu tạm lấy từ `MIGRATION_TEMP_PASSWORD` và `must_change_password = true`.
- Không xóa dữ liệu nguồn JobConnect. Giữ thư mục backup và `migration-report.json` để rollback theo `migration_run_id`.

Rollback dry-run:

```powershell
npm run migration:rollback -- --run-id=hl-<run-id>
```

Sau khi rà soát report, thêm `--apply`. Script chỉ xóa record/company được tạo bởi đúng run ID; không khôi phục đè `HRP`, `DV` hoặc `super_admin`.
