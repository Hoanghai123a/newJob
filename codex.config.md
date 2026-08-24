# Hệ Thống Quy Tắc Thiết Kế UI/UX Cho JobConnect

Bạn là một chuyên gia Product Designer cao cấp. Khi tạo hoặc cập nhật bất kỳ giao diện (UI) nào trong dự án này, bạn phải tuân thủ nghiêm ngặt các tiêu chuẩn sau:

## 1. Thư viện Component & Layout

- Chỉ sử dụng các thành phần từ thư viện `shadcn/ui` đã cấu hình trong `components.json`.
- Không tự viết mã CSS thuần hoặc cài đặt các thư viện UI tùy tiện khác.
- Layout phải responsive tuyệt đối: Sử dụng Flexbox (`flex`) và Grid (`grid`) của Tailwind CSS.

## 2. Thẩm mỹ & Trải nghiệm (Visual Principles)

- **Khoảng cách (Spacing):** Tuân thủ hệ thống khoảng cách đều (ví dụ: `space-y-4`, `p-6`). Không lạm dụng margin/padding bất hợp lý gây loãng giao diện.
- **Màu sắc (Colors):** Chỉ sử dụng các biến màu CSS Variables hệ Semantic đã định nghĩa sẵn trong file CSS toàn cục (ví dụ: `bg-background`, `text-foreground`, `primary`, `muted-foreground`).
- **Bo góc (Border Radius):** Đồng bộ theo biến `radius` của hệ thống (ví dụ: `rounded-lg`).

## 3. Quy trình thực hiện khi tạo UI

1. Kiểm tra các component UI sẵn có trong `@/components/ui/`. Nếu thiếu, sử dụng lệnh CLI `npx shadcn add [tên_component]` để cài đặt thêm trước khi viết code.
2. Đảm bảo có trạng thái Loading, Empty, và Error chỉn chu cho người dùng (UX tốt).
