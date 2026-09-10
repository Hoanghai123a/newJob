import type { Role } from "./pocketbase";

export interface GuideStep {
  description: string;
  route?: string;
  action?: string;
  screenshot?: string;
}

export interface GuideItem {
  id: string;
  title: string;
  category: string;
  keywords: string[];
  steps: GuideStep[];
  roleAccess: Role[];
  notes?: string;
}

export const USER_GUIDES: GuideItem[] = [
  // Nhóm: Quản lý tài chính (Staff)
  {
    id: "advance-worker",
    title: "Ứng tiền NLĐ",
    category: "Quản lý tài chính",
    keywords: ["ứng", "ứng tiền", "báo ứng", "lương", "nld", "lao động", "ứng lương người lao động"],
    roleAccess: ["staff", "admin"],
    steps: [
      {
        description: "Vào trang 'Danh sách lao động'",
        route: "/staff/workers",
        action: "Nhấn vào menu 'Danh sách lao động'",
      },
      {
        description: "Chọn một người lao động",
        action: "Nhấn vào tên người lao động cần tạo báo ứng",
      },
      {
        description: "Chọn mục 'Báo ứng lương'",
        action: "Trong trang chi tiết NLĐ, tìm và nhấn nút 'Báo ứng lương'",
      },
      {
        description: "Điền thông tin báo ứng",
        action: "Nhập số tiền ứng, lý do, chọn phương thức thanh toán",
      },
      {
        description: "Gửi yêu cầu",
        action: "Nhấn nút 'Gửi yêu cầu' để hoàn tất",
      },
    ],
    notes: "⚠️ Bạn chỉ tạo được báo ứng cho NLĐ mà bạn là người tuyển",
  },
  {
    id: "advance-staff",
    title: "Ứng tiền Staff",
    category: "Quản lý tài chính",
    keywords: ["ứng", "ứng tiền", "staff", "nhân viên", "ứng lương staff"],
    roleAccess: ["staff", "admin"],
    steps: [
      {
        description: "Vào trang 'Ứng lương'",
        route: "/staff/advances",
        action: "Nhấn vào menu 'Ứng lương'",
      },
      {
        description: "Tạo yêu cầu ứng cho bản thân",
        action: "Nhấn nút 'Ứng cho bản thân'",
      },
      {
        description: "Điền thông tin",
        action: "Nhập số tiền ứng, lý do",
      },
      {
        description: "Chọn phương thức thanh toán",
        action: "Chọn chuyển khoản hoặc tiền mặt",
      },
      {
        description: "Gửi yêu cầu",
        action: "Nhấn 'Gửi yêu cầu' để gửi đến admin",
      },
    ],
    notes: "Yêu cầu của bạn sẽ được gửi trực tiếp đến admin để phê duyệt",
  },
  {
    id: "view-advances",
    title: "Xem danh sách ứng lương",
    category: "Quản lý tài chính",
    keywords: ["xem ứng", "danh sách ứng", "theo dõi ứng", "kiểm tra ứng"],
    roleAccess: ["staff", "admin"],
    steps: [
      {
        description: "Vào menu 'Ứng lương'",
        route: "/staff/advances",
        action: "Nhấn vào menu 'Ứng lương'",
      },
      {
        description: "Chọn tab theo trạng thái",
        action: "Chọn tab: Chờ duyệt, Đã duyệt, Đã thu hồi, v.v.",
      },
      {
        description: "Tìm kiếm và lọc",
        action: "Dùng thanh tìm kiếm để tìm theo tên, mã NLĐ, số tiền. Lọc theo nhà máy nếu cần",
      },
    ],
    notes: "Bạn chỉ thấy các đơn ứng của NLĐ mà bạn tuyển hoặc do bạn tạo",
  },
  {
    id: "withdraw-advance",
    title: "Thu hồi yêu cầu ứng",
    category: "Quản lý tài chính",
    keywords: ["thu hồi", "hủy ứng", "xóa đơn ứng"],
    roleAccess: ["staff", "admin"],
    steps: [
      {
        description: "Vào 'Ứng lương' → tab 'Chờ admin duyệt'",
        route: "/staff/advances",
        action: "Mở trang ứng lương và chọn tab 'Chờ admin duyệt'",
      },
      {
        description: "Tìm đơn ứng cần thu hồi",
        action: "Tìm kiếm đơn ứng trong danh sách",
      },
      {
        description: "Xem chi tiết đơn",
        action: "Nhấn vào đơn ứng để xem chi tiết",
      },
      {
        description: "Thu hồi yêu cầu",
        action: "Nhấn nút 'Thu hồi yêu cầu' và xác nhận",
      },
    ],
    notes: "⚠️ Chỉ thu hồi được khi đơn còn ở trạng thái 'Chờ admin duyệt'",
  },

  // Nhóm: Quản lý lao động (Staff)
  {
    id: "view-workers",
    title: "Xem danh sách lao động",
    category: "Quản lý lao động",
    keywords: ["danh sách", "lao động", "nld", "công nhân", "xem lao động"],
    roleAccess: ["staff", "admin"],
    steps: [
      {
        description: "Vào menu 'Danh sách lao động'",
        route: "/staff/workers",
        action: "Nhấn vào menu 'Danh sách lao động'",
      },
      {
        description: "Tìm kiếm",
        action: "Dùng thanh tìm kiếm để tìm theo tên, số điện thoại, mã NLĐ",
      },
      {
        description: "Lọc dữ liệu",
        action: "Lọc theo nhà máy, trạng thái nếu cần",
      },
      {
        description: "Xem chi tiết",
        action: "Nhấn vào tên NLĐ để xem chi tiết",
      },
    ],
    notes: "Bạn chỉ thấy NLĐ mà bạn tuyển hoặc được phân quyền",
  },
  {
    id: "view-recruited",
    title: "Xem người tôi tuyển",
    category: "Quản lý lao động",
    keywords: ["tôi tuyển", "người tuyển", "lao động của tôi"],
    roleAccess: ["staff", "admin"],
    steps: [
      {
        description: "Vào menu 'Người tôi tuyển'",
        route: "/staff/recruited",
        action: "Nhấn vào menu 'Người tôi tuyển'",
      },
      {
        description: "Xem danh sách",
        action: "Xem danh sách NLĐ do bạn tuyển",
      },
      {
        description: "Xem chi tiết",
        action: "Nhấn vào NLĐ để xem chi tiết và quản lý",
      },
    ],
    notes: "Đây là danh sách NLĐ mà bạn là người tuyển chính thức",
  },
  {
    id: "create-worker",
    title: "Tạo hồ sơ NLĐ mới",
    category: "Quản lý lao động",
    keywords: ["tạo lao động", "thêm nld", "đăng ký lao động mới"],
    roleAccess: ["staff", "admin"],
    steps: [
      {
        description: "Vào 'Danh sách lao động'",
        route: "/staff/workers",
        action: "Mở trang danh sách lao động (nếu có quyền tạo hồ sơ)",
      },
      {
        description: "Tạo hồ sơ",
        action: "Nhấn nút 'Tạo nhanh' hoặc 'Đăng ký'",
      },
      {
        description: "Điền thông tin",
        action: "Nhập họ tên, CCCD, số điện thoại",
      },
      {
        description: "Chọn nhà máy và ngày vào",
        action: "Chọn nhà máy, ngày vào làm",
      },
      {
        description: "Lưu hồ sơ",
        action: "Nhấn 'Lưu' để hoàn tất",
      },
    ],
    notes: "Cần quyền 'Tạo hồ sơ NLĐ' từ admin",
  },
  {
    id: "update-worker-bank",
    title: "Cập nhật thông tin ngân hàng NLĐ",
    category: "Quản lý lao động",
    keywords: ["ngân hàng", "tài khoản", "stk", "cập nhật bank"],
    roleAccess: ["staff", "admin"],
    steps: [
      {
        description: "Vào 'Danh sách lao động' → chọn NLĐ",
        route: "/staff/workers",
        action: "Tìm và chọn NLĐ cần cập nhật",
      },
      {
        description: "Sửa thông tin ngân hàng",
        action: "Trong trang chi tiết, nhấn 'Sửa thông tin ngân hàng'",
      },
      {
        description: "Nhập thông tin",
        action: "Nhập tên ngân hàng, số tài khoản, tên chủ tài khoản",
      },
      {
        description: "Lưu thông tin",
        action: "Nhấn 'Lưu' để cập nhật",
      },
    ],
    notes: "Chỉ cập nhật được cho NLĐ mà bạn là người tuyển",
  },

  // Nhóm: Phê duyệt (Staff)
  {
    id: "view-approvals",
    title: "Xem danh sách phê duyệt",
    category: "Phê duyệt",
    keywords: ["phê duyệt", "duyệt đơn", "approval"],
    roleAccess: ["staff", "admin"],
    steps: [
      {
        description: "Vào menu 'Phê duyệt'",
        route: "/staff/approvals",
        action: "Nhấn vào menu 'Phê duyệt'",
      },
      {
        description: "Xem các yêu cầu",
        action: "Xem các yêu cầu cần phê duyệt (ứng lương, giữ lương từ NLĐ của bạn)",
      },
      {
        description: "Xem chi tiết",
        action: "Nhấn vào yêu cầu để xem chi tiết",
      },
    ],
    notes: "Bạn chỉ thấy yêu cầu từ NLĐ mà bạn tuyển",
  },
  {
    id: "approve-advance",
    title: "Phê duyệt ứng lương NLĐ",
    category: "Phê duyệt",
    keywords: ["duyệt ứng", "phê duyệt ứng lương"],
    roleAccess: ["staff", "admin"],
    steps: [
      {
        description: "Vào 'Phê duyệt' → tab 'Ứng lương'",
        route: "/staff/approvals",
        action: "Mở trang phê duyệt và chọn tab 'Ứng lương'",
      },
      {
        description: "Chọn yêu cầu",
        action: "Nhấn vào yêu cầu cần duyệt",
      },
      {
        description: "Kiểm tra thông tin",
        action: "Kiểm tra số tiền, lý do",
      },
      {
        description: "Nhập ghi chú",
        action: "Nhập ghi chú nếu cần",
      },
      {
        description: "Phê duyệt hoặc từ chối",
        action: "Nhấn 'Phê duyệt' hoặc 'Từ chối'",
      },
    ],
    notes: "Sau khi bạn duyệt, đơn sẽ chuyển lên admin để duyệt tiếp",
  },

  // Nhóm: Tiện ích (Staff & Admin)
  {
    id: "create-qr",
    title: "Tạo mã QR",
    category: "Tiện ích",
    keywords: ["qr", "mã qr", "qr code"],
    roleAccess: ["staff", "admin"],
    steps: [
      {
        description: "Vào menu 'Tạo mã QR'",
        route: "/staff/tools/qr",
        action: "Nhấn vào menu 'Tạo mã QR'",
      },
      {
        description: "Nhập nội dung",
        action: "Nhập nội dung cần tạo mã (URL, text, số điện thoại...)",
      },
      {
        description: "Tạo mã",
        action: "Nhấn 'Tạo mã QR'",
      },
      {
        description: "Tải về hoặc sao chép",
        action: "Tải về hoặc sao chép mã QR",
      },
    ],
    notes: "Hỗ trợ nhiều loại nội dung: URL, text, số điện thoại, v.v.",
  },
  {
    id: "money-to-text",
    title: "Đọc số tiền",
    category: "Tiện ích",
    keywords: ["đọc số", "đọc tiền", "số thành chữ", "chuyển đổi số tiền"],
    roleAccess: ["staff", "admin"],
    steps: [
      {
        description: "Vào menu 'Đọc số tiền'",
        route: "/staff/money-to-text",
        action: "Nhấn vào menu 'Đọc số tiền'",
      },
      {
        description: "Nhập số tiền",
        action: "Nhập số tiền cần đọc",
      },
      {
        description: "Xem kết quả",
        action: "Xem kết quả đọc số bằng chữ",
      },
    ],
    notes: "Hữu ích khi viết giấy tờ, hợp đồng cần ghi bằng chữ",
  },
  {
    id: "notebook",
    title: "Sổ tay",
    category: "Tiện ích",
    keywords: ["sổ tay", "ghi chú", "notebook", "nhật ký"],
    roleAccess: ["staff", "admin"],
    steps: [
      {
        description: "Vào menu 'Sổ tay'",
        route: "/notebook",
        action: "Nhấn vào menu 'Sổ tay'",
      },
      {
        description: "Thêm ghi chú",
        action: "Nhấn 'Thêm ghi chú'",
      },
      {
        description: "Nhập nội dung",
        action: "Nhập tiêu đề và nội dung",
      },
      {
        description: "Chọn trạng thái",
        action: "Chọn trạng thái (đang làm, hoàn thành, hủy)",
      },
      {
        description: "Lưu ghi chú",
        action: "Nhấn 'Lưu'",
      },
    ],
    notes: "Ghi chú riêng tư của bạn, không ai khác thấy được",
  },
  {
    id: "last-working-day",
    title: "Ngày công cuối",
    category: "Tiện ích",
    keywords: ["ngày công", "công cuối", "last working day"],
    roleAccess: ["staff", "admin"],
    steps: [
      {
        description: "Vào menu 'Ngày Công Cuối'",
        route: "/last-working-day",
        action: "Nhấn vào menu 'Ngày Công Cuối'",
      },
      {
        description: "Chọn kỳ lương",
        action: "Chọn kỳ lương hoặc nhập ngày bắt đầu/kết thúc",
      },
      {
        description: "Xem kết quả",
        action: "Xem ngày công cuối của kỳ",
      },
    ],
    notes: "Hỗ trợ tính ngày công cuối theo chu kỳ lương",
  },
  {
    id: "export-excel",
    title: "Xuất dữ liệu Excel",
    category: "Tiện ích",
    keywords: ["xuất excel", "export", "tải dữ liệu"],
    roleAccess: ["staff", "admin"],
    steps: [
      {
        description: "Mở chức năng xuất",
        action: "Vào menu 'Xuất dữ liệu' hoặc nhấn nút 'Xuất Excel' trong các trang danh sách",
      },
      {
        description: "Chọn loại dữ liệu",
        action: "Chọn loại dữ liệu cần xuất (lao động, ứng lương, v.v.)",
      },
      {
        description: "Chọn cột",
        action: "Chọn cột cần xuất",
      },
      {
        description: "Tải về",
        action: "Nhấn 'Tải về'",
      },
    ],
    notes: "File Excel tải về có thể mở bằng Microsoft Excel hoặc Google Sheets",
  },

  // Nhóm: Quản lý tài chính (Admin)
  {
    id: "admin-approve-advance",
    title: "Duyệt ứng lương",
    category: "Quản lý tài chính (Admin)",
    keywords: ["admin duyệt ứng", "phê duyệt ứng admin", "duyệt ứng lương"],
    roleAccess: ["admin"],
    steps: [
      {
        description: "Vào menu 'Ứng lương'",
        route: "/advances",
        action: "Nhấn vào menu 'Ứng lương'",
      },
      {
        description: "Chọn tab 'Chờ duyệt'",
        action: "Mở tab 'Chờ duyệt' để xem các yêu cầu cần xử lý",
      },
      {
        description: "Xem chi tiết yêu cầu",
        action: "Nhấn vào yêu cầu để xem thông tin, người tuyển đã duyệt",
      },
      {
        description: "Nhập ghi chú admin",
        action: "Nhập ghi chú nếu cần",
      },
      {
        description: "Phê duyệt hoặc từ chối",
        action: "Nhấn 'Chấp nhận' hoặc 'Từ chối'",
      },
    ],
    notes: "Đây là bước duyệt cuối cùng trước khi chi tiền",
  },
  {
    id: "mark-disbursed",
    title: "Đánh dấu đã giải ngân",
    category: "Quản lý tài chính (Admin)",
    keywords: ["giải ngân", "đã chi", "đã chuyển tiền"],
    roleAccess: ["admin"],
    steps: [
      {
        description: "Vào 'Ứng lương' → tab 'Đã tiếp nhận'",
        route: "/advances",
        action: "Mở tab 'Đã tiếp nhận'",
      },
      {
        description: "Tìm đơn đã chuyển tiền",
        action: "Tìm đơn ứng đã chuyển tiền thực tế",
      },
      {
        description: "Xem chi tiết",
        action: "Nhấn vào đơn để xem chi tiết",
      },
      {
        description: "Đánh dấu đã giải ngân",
        action: "Nhấn 'Đánh dấu đã giải ngân' và xác nhận",
      },
    ],
    notes: "Giúp theo dõi đơn nào đã chuyển tiền thực tế",
  },
  {
    id: "mark-recovered",
    title: "Đánh dấu thu hồi ứng",
    category: "Quản lý tài chính (Admin)",
    keywords: ["thu hồi", "recovered", "đã thu", "trừ lương"],
    roleAccess: ["admin"],
    steps: [
      {
        description: "Vào 'Ứng lương' → tab 'Đã tiếp nhận'",
        route: "/advances",
        action: "Mở tab 'Đã tiếp nhận'",
      },
      {
        description: "Tìm đơn đã thu hồi",
        action: "Tìm đơn ứng đã thu hồi từ lương NLĐ",
      },
      {
        description: "Đánh dấu thu hồi",
        action: "Nhấn vào đơn → 'Đánh dấu thu hồi'",
      },
      {
        description: "Nhập ghi chú",
        action: "Nhập ghi chú thu hồi",
      },
      {
        description: "Xác nhận",
        action: "Nhấn 'Xác nhận'",
      },
    ],
    notes: "Dùng khi đã trừ tiền ứng từ lương tháng của NLĐ",
  },
  {
    id: "mark-unrecoverable",
    title: "Đánh dấu không thu hồi được",
    category: "Quản lý tài chính (Admin)",
    keywords: ["không thu hồi", "unrecoverable", "mất tiền"],
    roleAccess: ["admin"],
    steps: [
      {
        description: "Vào 'Ứng lương' → tab 'Đã tiếp nhận'",
        route: "/advances",
        action: "Mở tab 'Đã tiếp nhận'",
      },
      {
        description: "Tìm đơn không thu hồi được",
        action: "Tìm đơn ứng không thể thu hồi (NLĐ nghỉ đột ngột, mất liên lạc...)",
      },
      {
        description: "Đánh dấu không thu hồi",
        action: "Nhấn vào đơn → 'Đánh dấu không thu hồi được'",
      },
      {
        description: "Nhập lý do",
        action: "Nhập lý do không thu hồi được",
      },
      {
        description: "Xác nhận",
        action: "Nhấn 'Xác nhận'",
      },
    ],
    notes: "⚠️ Dùng khi chắc chắn không thể thu hồi tiền",
  },
  {
    id: "block-advance",
    title: "Chặn/Mở báo ứng cho NLĐ",
    category: "Quản lý tài chính (Admin)",
    keywords: ["chặn ứng", "mở ứng", "block advance", "khóa ứng"],
    roleAccess: ["admin"],
    steps: [
      {
        description: "Vào 'Danh sách lao động'",
        route: "/admin/workforce",
        action: "Mở trang 'Nhân sự đi làm'",
      },
      {
        description: "Tìm NLĐ",
        action: "Tìm và nhấn vào NLĐ cần chặn/mở báo ứng",
      },
      {
        description: "Quản lý quyền",
        action: "Trong trang chi tiết, nhấn 'Quản lý quyền'",
      },
      {
        description: "Bật/tắt quyền báo ứng",
        action: "Bật/tắt 'Cho phép báo ứng lương'",
      },
      {
        description: "Lưu thay đổi",
        action: "Nhấn 'Lưu'",
      },
    ],
    notes: "Khi chặn, NLĐ không thể tạo yêu cầu ứng mới",
  },

  // Nhóm: Quản lý nhân sự (Admin)
  {
    id: "add-staff",
    title: "Thêm tài khoản Staff",
    category: "Quản lý nhân sự (Admin)",
    keywords: ["thêm staff", "tạo staff", "tài khoản nhân viên"],
    roleAccess: ["admin"],
    steps: [
      {
        description: "Vào 'Cài đặt quản trị' → tab 'Nhân viên'",
        route: "/admin/settings",
        action: "Mở trang cài đặt và chọn tab 'Nhân viên'",
      },
      {
        description: "Thêm tài khoản",
        action: "Nhấn 'Thêm tài khoản nhân viên'",
      },
      {
        description: "Nhập thông tin",
        action: "Nhập tên đăng nhập, họ tên, số điện thoại",
      },
      {
        description: "Nhập thông tin bổ sung",
        action: "Chọn ngày sinh, địa chỉ (tuỳ chọn)",
      },
      {
        description: "Tạo tài khoản",
        action: "Nhấn 'Tạo tài khoản'",
      },
    ],
    notes: "Mật khẩu mặc định là nv123456, staff phải đổi khi đăng nhập lần đầu",
  },
  {
    id: "disable-staff",
    title: "Khóa tài khoản Staff khi nghỉ việc",
    category: "Quản lý nhân sự (Admin)",
    keywords: ["khóa staff", "disable", "dừng hoạt động", "nghỉ việc"],
    roleAccess: ["admin"],
    steps: [
      {
        description: "Vào 'Cài đặt quản trị' → tab 'Nhân viên'",
        route: "/admin/settings",
        action: "Mở trang cài đặt và chọn tab 'Nhân viên'",
      },
      {
        description: "Tìm tài khoản staff",
        action: "Tìm tài khoản staff cần khóa",
      },
      {
        description: "Dừng hoạt động",
        action: "Nhấn nút 'Dừng hoạt động' (icon PowerOff)",
      },
      {
        description: "Xác nhận",
        action: "Xác nhận khóa tài khoản",
      },
    ],
    notes: "⚠️ Tài khoản bị khóa sẽ không thể đăng nhập",
  },
  {
    id: "enable-staff",
    title: "Mở lại tài khoản Staff",
    category: "Quản lý nhân sự (Admin)",
    keywords: ["mở khóa staff", "kích hoạt lại", "active staff"],
    roleAccess: ["admin"],
    steps: [
      {
        description: "Vào 'Cài đặt quản trị' → tab 'Nhân viên'",
        route: "/admin/settings",
        action: "Mở trang cài đặt và chọn tab 'Nhân viên'",
      },
      {
        description: "Tìm tài khoản đã khóa",
        action: "Tìm tài khoản staff đã khóa (có nhãn 'Dừng hoạt động')",
      },
      {
        description: "Kích hoạt lại",
        action: "Nhấn nút 'Kích hoạt lại' (icon Power)",
      },
      {
        description: "Xác nhận",
        action: "Xác nhận mở khóa",
      },
    ],
    notes: "Staff có thể đăng nhập lại ngay sau khi mở khóa",
  },
  {
    id: "promote-staff",
    title: "Nâng Staff lên Admin",
    category: "Quản lý nhân sự (Admin)",
    keywords: ["nâng admin", "promote", "quyền admin"],
    roleAccess: ["admin"],
    steps: [
      {
        description: "Vào 'Cài đặt quản trị' → tab 'Nhân viên'",
        route: "/admin/settings",
        action: "Mở trang cài đặt và chọn tab 'Nhân viên'",
      },
      {
        description: "Tìm tài khoản staff",
        action: "Tìm tài khoản staff cần nâng quyền",
      },
      {
        description: "Nâng lên Admin",
        action: "Nhấn nút 'Nâng lên Admin' (icon ShieldCheck)",
      },
      {
        description: "Xác nhận",
        action: "Xác nhận nâng quyền",
      },
    ],
    notes: "⚠️ Admin có toàn quyền: duyệt ứng, quản lý staff, cài đặt hệ thống",
  },
  {
    id: "add-factory-manager",
    title: "Thêm quản lý nhà máy cho Staff",
    category: "Quản lý nhân sự (Admin)",
    keywords: ["quản lý nhà máy", "factory manager", "phân quyền nhà máy"],
    roleAccess: ["admin"],
    steps: [
      {
        description: "Vào 'Cài đặt quản trị' → tab 'Nhà máy'",
        route: "/admin/settings",
        action: "Mở trang cài đặt và chọn tab 'Nhà máy'",
      },
      {
        description: "Tìm nhà máy",
        action: "Tìm nhà máy cần phân quyền",
      },
      {
        description: "Quản lý nhà máy",
        action: "Nhấn nút 'Quản lý nhà máy' (icon users)",
      },
      {
        description: "Chọn staff",
        action: "Chọn staff cần thêm làm quản lý",
      },
      {
        description: "Chọn thời gian",
        action: "Chọn ngày bắt đầu và ngày kết thúc (tuỳ chọn)",
      },
      {
        description: "Lưu",
        action: "Nhấn 'Lưu'",
      },
    ],
    notes: "Staff được phân quyền sẽ thấy toàn bộ NLĐ của nhà máy đó",
  },
  {
    id: "remove-factory-manager",
    title: "Xóa quản lý nhà máy",
    category: "Quản lý nhân sự (Admin)",
    keywords: ["xóa quản lý", "gỡ quyền nhà máy", "remove factory manager"],
    roleAccess: ["admin"],
    steps: [
      {
        description: "Vào 'Cài đặt quản trị' → tab 'Nhà máy'",
        route: "/admin/settings",
        action: "Mở trang cài đặt và chọn tab 'Nhà máy'",
      },
      {
        description: "Tìm nhà máy",
        action: "Tìm nhà máy và nhấn 'Quản lý nhà máy'",
      },
      {
        description: "Tìm staff",
        action: "Tìm staff cần gỡ quyền",
      },
      {
        description: "Xóa",
        action: "Nhấn nút 'Xóa' bên cạnh tên staff",
      },
      {
        description: "Xác nhận",
        action: "Xác nhận xóa",
      },
    ],
    notes: "Staff sẽ mất quyền xem NLĐ của nhà máy đó",
  },
  {
    id: "import-staff",
    title: "Import Staff từ Excel",
    category: "Quản lý nhân sự (Admin)",
    keywords: ["import staff", "nhập excel", "tải lên danh sách staff"],
    roleAccess: ["admin"],
    steps: [
      {
        description: "Vào 'Cài đặt quản trị' → tab 'Nhân viên'",
        route: "/admin/settings",
        action: "Mở trang cài đặt và chọn tab 'Nhân viên'",
      },
      {
        description: "Tải mẫu Excel",
        action: "Nhấn 'Tải mẫu Excel' để lấy file mẫu",
      },
      {
        description: "Điền thông tin",
        action: "Điền thông tin staff vào file mẫu",
      },
      {
        description: "Import",
        action: "Nhấn 'Import từ Excel'",
      },
      {
        description: "Chọn file",
        action: "Chọn file Excel đã điền",
      },
      {
        description: "Kiểm tra kết quả",
        action: "Kiểm tra kết quả import",
      },
    ],
    notes: "File mẫu có định dạng cụ thể, không thay đổi tiêu đề cột",
  },

  // Nhóm: Cài đặt hệ thống (Admin)
  {
    id: "update-company-info",
    title: "Cập nhật thông tin công ty",
    category: "Cài đặt hệ thống (Admin)",
    keywords: ["tên công ty", "logo", "thông tin công ty"],
    roleAccess: ["admin"],
    steps: [
      {
        description: "Vào 'Cài đặt quản trị' → tab 'Công ty'",
        route: "/admin/settings",
        action: "Mở trang cài đặt và chọn tab 'Công ty'",
      },
      {
        description: "Nhập thông tin",
        action: "Nhập tên công ty, hotline, địa chỉ",
      },
      {
        description: "Tải logo",
        action: "Tải lên logo công ty (nếu có)",
      },
      {
        description: "Lưu",
        action: "Nhấn 'Lưu thông tin công ty'",
      },
    ],
    notes: "Logo sẽ hiển thị trên thanh điều hướng và trang đăng nhập",
  },
  {
    id: "manage-factory",
    title: "Quản lý nhà máy",
    category: "Cài đặt hệ thống (Admin)",
    keywords: ["thêm nhà máy", "sửa nhà máy", "xóa nhà máy", "factory"],
    roleAccess: ["admin"],
    steps: [
      {
        description: "Vào 'Cài đặt quản trị' → tab 'Nhà máy'",
        route: "/admin/settings",
        action: "Mở trang cài đặt và chọn tab 'Nhà máy'",
      },
      {
        description: "Thêm nhà máy",
        action: "Nhấn 'Thêm nhà máy' để tạo mới",
      },
      {
        description: "Nhập thông tin",
        action: "Nhập tên nhà máy, địa chỉ, hotline",
      },
      {
        description: "Cấu hình",
        action: "Chọn ngày chốt công, hạn mức ứng",
      },
      {
        description: "Lưu",
        action: "Nhấn 'Lưu'",
      },
    ],
    notes: "Có thể sửa hoặc ẩn nhà máy bằng menu 3 chấm",
  },
  {
    id: "manage-recruitment-area",
    title: "Quản lý khu vực tuyển dụng",
    category: "Cài đặt hệ thống (Admin)",
    keywords: ["khu vực", "recruitment area", "nhà chính"],
    roleAccess: ["admin"],
    steps: [
      {
        description: "Vào 'Cài đặt quản trị' → tab 'Khu vực TD'",
        route: "/admin/settings",
        action: "Mở trang cài đặt và chọn tab 'Khu vực TD'",
      },
      {
        description: "Thêm khu vực",
        action: "Nhấn 'Thêm khu vực'",
      },
      {
        description: "Nhập thông tin",
        action: "Nhập tên khu vực (ví dụ: Hà Nội, TP.HCM)",
      },
      {
        description: "Nhập chi tiết",
        action: "Nhập địa chỉ, người liên hệ",
      },
      {
        description: "Lưu",
        action: "Nhấn 'Lưu'",
      },
    ],
    notes: "Dùng để phân loại nguồn tuyển dụng theo địa lý",
  },
  {
    id: "view-logs",
    title: "Xem nhật ký thao tác",
    category: "Cài đặt hệ thống (Admin)",
    keywords: ["log", "nhật ký", "lịch sử thao tác", "audit"],
    roleAccess: ["admin"],
    steps: [
      {
        description: "Vào menu 'Nhật ký thao tác'",
        route: "/admin/logs",
        action: "Nhấn vào menu 'Nhật ký thao tác'",
      },
      {
        description: "Chọn thời gian",
        action: "Chọn khoảng thời gian cần xem",
      },
      {
        description: "Lọc dữ liệu",
        action: "Lọc theo người thực hiện, loại hành động",
      },
      {
        description: "Xem chi tiết",
        action: "Xem chi tiết từng thao tác",
      },
    ],
    notes: "Giúp theo dõi ai làm gì, khi nào trong hệ thống",
  },
  {
    id: "import-data",
    title: "Nhập dữ liệu từ Excel",
    category: "Cài đặt hệ thống (Admin)",
    keywords: ["import excel", "nhập dữ liệu", "import data"],
    roleAccess: ["admin"],
    steps: [
      {
        description: "Vào menu 'Nhập dữ liệu'",
        route: "/admin/imports",
        action: "Nhấn vào menu 'Nhập dữ liệu'",
      },
      {
        description: "Chọn loại dữ liệu",
        action: "Chọn loại dữ liệu: lao động, ứng lương, lịch sử công...",
      },
      {
        description: "Tải file mẫu",
        action: "Tải xuống file mẫu tương ứng",
      },
      {
        description: "Điền dữ liệu",
        action: "Điền dữ liệu vào file mẫu",
      },
      {
        description: "Tải lên",
        action: "Nhấn 'Chọn file' và tải lên",
      },
      {
        description: "Kiểm tra và nhập",
        action: "Kiểm tra preview và nhấn 'Nhập dữ liệu'",
      },
    ],
    notes: "⚠️ Dữ liệu sai định dạng có thể gây lỗi, kiểm tra kỹ trước khi nhập",
  },

  // Nhóm: Thống kê & Báo cáo (Admin)
  {
    id: "view-dashboard",
    title: "Xem Dashboard nhân lực",
    category: "Thống kê & Báo cáo (Admin)",
    keywords: ["dashboard", "thống kê", "báo cáo nhân lực"],
    roleAccess: ["admin"],
    steps: [
      {
        description: "Vào trang chủ",
        route: "/",
        action: "Vào trang chủ sau khi đăng nhập",
      },
      {
        description: "Xem biểu đồ",
        action: "Xem các biểu đồ: số lao động đang làm, vào làm, nghỉ việc",
      },
      {
        description: "Chọn thời gian",
        action: "Chọn khoảng thời gian để xem thống kê",
      },
      {
        description: "Xem chi tiết",
        action: "Xem chi tiết theo nhà máy, người tuyển",
      },
    ],
    notes: "Dashboard cập nhật theo thời gian thực",
  },
  {
    id: "view-recruitment-stats",
    title: "Xem thống kê tuyển dụng",
    category: "Thống kê & Báo cáo (Admin)",
    keywords: ["tuyển dụng", "recruitment", "thống kê tuyển"],
    roleAccess: ["admin"],
    steps: [
      {
        description: "Vào 'Nhân sự đi làm' → tab 'Thống kê'",
        route: "/admin/workforce",
        action: "Mở trang 'Nhân sự đi làm' và chọn tab 'Thống kê'",
      },
      {
        description: "Chọn thời gian",
        action: "Chọn khoảng thời gian",
      },
      {
        description: "Lọc dữ liệu",
        action: "Lọc theo nhà máy, người tuyển",
      },
      {
        description: "Xem biểu đồ",
        action: "Xem biểu đồ: số NLĐ vào, nghỉ, đang làm",
      },
      {
        description: "Xem chi tiết",
        action: "Nhấn nút 'Biểu đồ chi tiết' để xem breakdown",
      },
    ],
    notes: "Hỗ trợ so sánh hiệu suất giữa các staff tuyển dụng",
  },
  {
    id: "view-finance-stats",
    title: "Xem thống kê tài chính",
    category: "Thống kê & Báo cáo (Admin)",
    keywords: ["tài chính", "finance", "thống kê ứng"],
    roleAccess: ["admin"],
    steps: [
      {
        description: "Vào trang chủ → phần 'Tài chính'",
        route: "/",
        action: "Xem phần Tài chính trên trang chủ",
      },
      {
        description: "Xem tổng quan",
        action: "Xem tổng số tiền ứng đang chờ, đã giải ngân",
      },
      {
        description: "Xem biểu đồ",
        action: "Xem biểu đồ ứng lương theo thời gian",
      },
      {
        description: "Xem chi tiết",
        action: "Nhấn vào các chỉ số để xem chi tiết",
      },
    ],
    notes: "Giúp kiểm soát dòng tiền ứng lương",
  },

  // Nhóm: Tài khoản cá nhân (All)
  {
    id: "change-password",
    title: "Đổi mật khẩu",
    category: "Tài khoản cá nhân",
    keywords: ["đổi pass", "change password", "mật khẩu"],
    roleAccess: ["staff", "admin", "user"],
    steps: [
      {
        description: "Vào menu 'Tài khoản'",
        route: "/account",
        action: "Nhấn vào menu 'Tài khoản'",
      },
      {
        description: "Đổi mật khẩu",
        action: "Nhấn nút 'Đổi mật khẩu'",
      },
      {
        description: "Nhập mật khẩu hiện tại",
        action: "Nhập mật khẩu hiện tại",
      },
      {
        description: "Nhập mật khẩu mới",
        action: "Nhập mật khẩu mới (ít nhất 8 ký tự)",
      },
      {
        description: "Nhập lại mật khẩu mới",
        action: "Nhập lại mật khẩu mới để xác nhận",
      },
      {
        description: "Lưu",
        action: "Nhấn 'Lưu'",
      },
    ],
    notes: "⚠️ Mật khẩu phải dài ít nhất 8 ký tự",
  },
  {
    id: "update-profile",
    title: "Cập nhật thông tin cá nhân",
    category: "Tài khoản cá nhân",
    keywords: ["sửa thông tin", "profile", "hồ sơ cá nhân"],
    roleAccess: ["staff", "admin", "user"],
    steps: [
      {
        description: "Vào 'Tài khoản'",
        route: "/account",
        action: "Nhấn vào menu 'Tài khoản'",
      },
      {
        description: "Sửa thông tin",
        action: "Nhập/sửa họ tên, số điện thoại, địa chỉ",
      },
      {
        description: "Nhập thông tin ngân hàng",
        action: "Nhập thông tin ngân hàng (nếu là staff/admin)",
      },
      {
        description: "Lưu",
        action: "Nhấn 'Lưu thông tin'",
      },
    ],
    notes: "Thông tin ngân hàng dùng khi tạo yêu cầu ứng cho bản thân",
  },
  {
    id: "logout",
    title: "Đăng xuất",
    category: "Tài khoản cá nhân",
    keywords: ["logout", "thoát", "đăng xuất"],
    roleAccess: ["staff", "admin", "user"],
    steps: [
      {
        description: "Đăng xuất",
        action: "Nhấn nút 'Đăng xuất' ở cuối thanh điều hướng",
      },
      {
        description: "Xác nhận",
        action: "Xác nhận đăng xuất",
      },
    ],
    notes: "Bạn cần đăng nhập lại để sử dụng tiếp",
  },
];

/**
 * Tìm kiếm guides theo từ khóa
 */
export function searchGuides(query: string, userRole?: Role): GuideItem[] {
  if (!query.trim()) {
    return filterGuidesByRole(USER_GUIDES, userRole);
  }

  const normalizedQuery = query.toLowerCase().trim();
  const filtered = USER_GUIDES.filter((guide) => {
    // Kiểm tra role access
    if (userRole && !guide.roleAccess.includes(userRole)) {
      return false;
    }

    // Tìm trong title
    if (guide.title.toLowerCase().includes(normalizedQuery)) {
      return true;
    }

    // Tìm trong keywords
    if (guide.keywords.some((keyword) => keyword.toLowerCase().includes(normalizedQuery))) {
      return true;
    }

    // Tìm trong category
    if (guide.category.toLowerCase().includes(normalizedQuery)) {
      return true;
    }

    return false;
  });

  return filtered;
}

/**
 * Lọc guides theo role
 */
export function filterGuidesByRole(guides: GuideItem[], userRole?: Role): GuideItem[] {
  if (!userRole) return guides;
  return guides.filter((guide) => guide.roleAccess.includes(userRole));
}

/**
 * Nhóm guides theo category
 */
export function groupGuidesByCategory(guides: GuideItem[]): Record<string, GuideItem[]> {
  const grouped: Record<string, GuideItem[]> = {};

  for (const guide of guides) {
    if (!grouped[guide.category]) {
      grouped[guide.category] = [];
    }
    grouped[guide.category].push(guide);
  }

  return grouped;
}

/**
 * Lấy guide theo id
 */
export function getGuideById(id: string): GuideItem | undefined {
  return USER_GUIDES.find((guide) => guide.id === id);
}
