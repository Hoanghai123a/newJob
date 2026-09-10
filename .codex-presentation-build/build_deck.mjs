import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const workspaceDir = "D:\\My App\\newApp";
const buildDir = path.join(workspaceDir, ".codex-presentation-build");
const outputDir = path.join(workspaceDir, "presentation-output");
const finalPath = path.join(outputDir, "Gioi-thieu-Thuong-mai-hoa-Tuyen-dung-4-0-v3.pptx");
const skillDir = "C:\\Users\\admin\\.codex\\plugins\\cache\\openai-primary-runtime\\presentations\\26.903.11726\\skills\\presentations";
const runtimePython = "C:\\Users\\admin\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
const { resolvePresentationFont, applyPresentationChartFont } = await import(
  pathToFileURL(path.join(skillDir, "container_tools/artifact_tool_utils.mjs")).href,
);
const { finalizePresentation } = await import(
  pathToFileURL(path.join(skillDir, "container_tools/artifact_tool_utils.mjs")).href,
);

await fs.mkdir(buildDir, { recursive: true });
await fs.mkdir(outputDir, { recursive: true });
const family = resolvePresentationFont();
const presentation = Presentation.create({ slideSize: { width: 1280, height: 720 } });

const C = {
  navy: "#0B2538",
  teal: "#0F8B8D",
  cyan: "#38BDF8",
  ink: "#12212B",
  slate: "#52606D",
  mist: "#F3F8F8",
  white: "#FFFFFF",
  line: "#D8E5E5",
  orange: "#F59E0B",
  red: "#D85C5C",
  green: "#159A78",
  paleOrange: "#FFF5DF",
  paleRed: "#FFF0F0",
  paleGreen: "#EAF8F3",
};

function addText(slide, text, left, top, width, height, style = {}) {
  const shape = slide.shapes.add({
    geometry: "textbox",
    position: { left, top, width, height },
    fill: "none",
    line: { fill: "none", width: 0 },
  });
  shape.text = text;
  shape.text.style = {
    typeface: family,
    fontSize: style.fontSize ?? 22,
    color: style.color ?? C.ink,
    bold: style.bold ?? false,
    alignment: style.alignment ?? "left",
    verticalAlignment: style.verticalAlignment ?? "top",
    ...style,
  };
  return shape;
}

function addBox(slide, left, top, width, height, fill, radius = 18, line = C.line) {
  return slide.shapes.add({
    geometry: radius ? "roundRect" : "rect",
    position: { left, top, width, height },
    fill,
    line: { fill: line, width: line === "none" ? 0 : 1 },
    borderRadius: radius,
  });
}

function addTitle(slide, title, kicker = "") {
  if (kicker) addText(slide, kicker.toUpperCase(), 72, 42, 900, 24, { fontSize: 14, bold: true, color: C.teal });
  addText(slide, title, 72, kicker ? 68 : 48, 1100, 62, { fontSize: 40, bold: true, color: C.navy });
}

function addFooter(slide, page, note = "Đề xuất thương mại hóa | Dữ liệu tính năng lấy từ sản phẩm hiện tại") {
  addText(slide, note, 72, 682, 930, 18, { fontSize: 11, color: C.slate });
  addText(slide, String(page).padStart(2, "0"), 1160, 678, 48, 24, { fontSize: 14, bold: true, color: C.teal, alignment: "right" });
}

function addBulletList(slide, items, left, top, width, lineHeight = 44, color = C.ink, fontSize = 22) {
  items.forEach((item, i) => {
    addBox(slide, left, top + i * lineHeight + 7, 10, 10, C.teal, 5, "none");
    addText(slide, item, left + 24, top + i * lineHeight, width - 24, lineHeight, { fontSize, color });
  });
}

function addMetric(slide, x, y, w, value, label, tone = C.teal) {
  addBox(slide, x, y, w, 112, C.white, 16, C.line);
  addText(slide, value, x + 18, y + 18, w - 36, 38, { fontSize: 31, bold: true, color: tone });
  addText(slide, label, x + 18, y + 63, w - 36, 30, { fontSize: 16, color: C.slate });
}

function addNotes(slide, text) {
  slide.speakerNotes.textFrame.setText(text);
}

// 1. Cover
{
  const slide = presentation.slides.add();
  slide.background.fill = C.navy;
  addBox(slide, 0, 0, 1280, 9, C.teal, 0, "none");
  addBox(slide, 910, 0, 370, 720, C.teal, 0, "none");
  addBox(slide, 964, 86, 226, 226, C.white, 34, "none");
  const logoBytes = await fs.readFile(path.join(workspaceDir, "public/icons/app-icon-512.png"));
  slide.images.add({ blob: logoBytes, contentType: "image/png", alt: "Biểu tượng ứng dụng", fit: "contain", position: { left: 1000, top: 122, width: 154, height: 154 } });
  addText(slide, "Tuyển dụng 4.0", 90, 144, 740, 70, { fontSize: 58, bold: true, color: C.white });
  addText(slide, "Từ file Excel rời rạc đến một nguồn dữ liệu điều hành thống nhất", 92, 244, 700, 86, { fontSize: 28, color: "#D9F5F3" });
  addBox(slide, 92, 378, 260, 42, C.orange, 21, "none");
  addText(slide, "ĐỀ XUẤT THƯƠNG MẠI HÓA", 112, 388, 220, 22, { fontSize: 14, bold: true, color: C.navy, alignment: "center" });
  addText(slide, "Dành cho giám đốc, quản trị nhân sự và đội ngũ vận hành nhà máy", 92, 560, 740, 34, { fontSize: 18, color: "#B7D1D3" });
  addText(slide, "04.09.2026", 92, 626, 200, 24, { fontSize: 14, color: "#B7D1D3" });
  addNotes(slide, "Nguồn nội bộ: nhận diện ứng dụng từ public/icons/app-icon-512.png. Nội dung tính năng đối chiếu PROJECT_MAP.md và mã nguồn hiện tại.");
}

// 2. Excel pain
{
  const slide = presentation.slides.add();
  slide.background.fill = C.mist;
  addTitle(slide, "Excel tạo ra khoảng trống thông tin", "Bối cảnh vận hành");
  addText(slide, "Khi mỗi bộ phận giữ một file, người ra quyết định phải ghép dữ liệu bằng tay trước khi hiểu chuyện gì đang xảy ra.", 72, 136, 850, 52, { fontSize: 23, color: C.slate });
  addBox(slide, 72, 226, 520, 340, C.white, 20, C.line);
  addText(slide, "5 hệ quả thường gặp", 104, 255, 420, 32, { fontSize: 24, bold: true, color: C.navy });
  addBulletList(slide, [
    "Sai khác tên, mã NV, nhà máy giữa các file",
    "Không biết bản ghi nào là mới nhất",
    "Đối soát tuyển nội bộ và đối tác chậm",
    "Phê duyệt và trách nhiệm xử lý bị đứt quãng",
    "Báo cáo lãnh đạo phụ thuộc một người tổng hợp",
  ], 104, 305, 450, 47, C.ink, 18);
  addBox(slide, 660, 226, 548, 340, C.navy, 20, "none");
  addText(slide, "Một vòng lặp thủ công", 700, 255, 440, 32, { fontSize: 24, bold: true, color: C.white });
  const steps = ["File tuyển dụng", "File NLĐ", "File nhà máy", "File công/lương", "Báo cáo tổng hợp"];
  steps.forEach((s, i) => {
    const x = 700 + (i % 2) * 235;
    const y = 312 + Math.floor(i / 2) * 72;
    addBox(slide, x, y, 200, 42, i === 4 ? C.orange : "#1D4158", 12, i === 4 ? "none" : "#4E7485");
    addText(slide, s, x + 10, y + 11, 180, 20, { fontSize: 15, bold: true, color: i === 4 ? C.navy : C.white, alignment: "center" });
    if (i < steps.length - 1) addText(slide, "→", x + 205, y + 8, 28, 24, { fontSize: 20, bold: true, color: C.cyan, alignment: "center" });
  });
  addText(slide, "Mất thời gian không chỉ ở nhập liệu, mà ở việc xác định đâu là sự thật.", 700, 500, 430, 46, { fontSize: 19, color: "#D9F5F3" });
  addFooter(slide, 2);
  addNotes(slide, "Các hệ quả là tổng hợp vấn đề vận hành được mô tả trong yêu cầu thương mại hóa. Đây là framing bán hàng, không phải số liệu khảo sát thị trường.");
}

// 3. Single source of truth
{
  const slide = presentation.slides.add();
  slide.background.fill = C.white;
  addTitle(slide, "Một hồ sơ, một nguồn dữ liệu", "Giải pháp cốt lõi");
  addText(slide, "Ứng dụng nối liền vòng đời người lao động từ lúc tuyển đến khi tính công, ứng lương và lưu vết xử lý.", 72, 136, 900, 45, { fontSize: 23, color: C.slate });
  const nodes = [
    [72, 270, 184, 128, "Hồ sơ NLĐ", "UID · CCCD · tài khoản", C.teal],
    [292, 270, 200, 128, "Lịch sử đi làm", "mã NV · ngày vào/nghỉ", C.cyan],
    [528, 270, 184, 128, "Nhà máy & đối tác", "nguồn tuyển · phạm vi", C.orange],
    [748, 270, 184, 128, "Công & lương", "giờ · phụ cấp · khấu trừ", C.green],
    [968, 270, 240, 128, "Phê duyệt & nhật ký", "ai làm · lúc nào · thay đổi gì", C.red],
  ];
  nodes.forEach(([x, y, w, h, title, sub, tone], i) => {
    addBox(slide, x, y, w, h, C.mist, 18, tone);
    addBox(slide, x, y, 8, h, tone, 4, "none");
    addText(slide, title, x + 22, y + 28, w - 34, 30, { fontSize: 21, bold: true, color: C.navy });
    addText(slide, sub, x + 22, y + 72, w - 34, 36, { fontSize: 16, color: C.slate });
    if (i < nodes.length - 1) addText(slide, "→", x + w + 7, y + 48, 28, 26, { fontSize: 23, bold: true, color: C.teal, alignment: "center" });
  });
  addBox(slide, 72, 472, 1136, 94, C.navy, 18, "none");
  addText(slide, "Khi một dữ liệu thay đổi, các vai trò liên quan nhìn thấy cùng một trạng thái đã được phân quyền.", 108, 501, 1050, 38, { fontSize: 24, bold: true, color: C.white, alignment: "center" });
  addFooter(slide, 3);
  addNotes(slide, "Nguồn nội bộ: src/lib/employment.ts, src/lib/recruiters.ts, src/lib/staff-log.ts, src/lib/salary.ts và PROJECT_MAP.md.");
}

// 4. Product evidence
{
  const slide = presentation.slides.add();
  slide.background.fill = C.mist;
  addTitle(slide, "Những gì ứng dụng đã sẵn sàng", "Năng lực sản phẩm");
  addMetric(slide, 72, 160, 252, "01", "Dashboard nhân lực cho admin", C.teal);
  addMetric(slide, 344, 160, 252, "02", "Nhóm vai trò: admin và staff", C.cyan);
  addMetric(slide, 616, 160, 252, "Nhiều", "Nhà máy, nhà chính, đối tác", C.orange);
  addMetric(slide, 888, 160, 320, "500+", "Bản ghi mỗi lần tải dữ liệu", C.green);
  const featureRows = [
    ["Theo dõi nhân lực", "Lọc theo nhà máy, người tuyển, đang làm/nghỉ; xem chi tiết từng NLĐ."],
    ["Nhập và xuất Excel", "Nhập mới/cập nhật theo UID; dòng lỗi được tách để sửa, không làm dừng dòng hợp lệ."],
    ["Tài chính vận hành", "Bảng công, bảng lương, ứng lương, giữ lương và quy trình phê duyệt."],
    ["Kiểm soát dữ liệu", "Chặn lịch sử đang làm trùng, theo dõi CCCD phiên bản và lưu nhật ký thao tác."],
  ];
  featureRows.forEach(([label, desc], i) => {
    const y = 310 + i * 72;
    addBox(slide, 72, y, 1136, 56, i % 2 ? C.white : "#EAF4F4", 12, "none");
    addText(slide, label, 96, y + 16, 250, 24, { fontSize: 18, bold: true, color: C.navy });
    addText(slide, desc, 360, y + 16, 815, 28, { fontSize: 17, color: C.slate });
  });
  addFooter(slide, 4);
  addNotes(slide, "Nguồn nội bộ: PROJECT_MAP.md; src/routes/_authenticated/admin/workforce.tsx; src/routes/_authenticated/admin/imports.tsx; src/lib/salary.ts; src/lib/uid-counter.ts; src/components/admin/AccountActivityStats.tsx.");
}

// 5. Pain to fix table
{
  const slide = presentation.slides.add();
  slide.background.fill = C.white;
  addTitle(slide, "5 điểm đau được khắc phục", "Giá trị trực tiếp");
  const table = slide.tables.add({
    rows: 6,
    columns: 3,
    left: 72,
    top: 155,
    width: 1136,
    height: 415,
    columnWidths: [270, 410, 456],
    values: [
      ["Nỗi đau với Excel", "Ảnh hưởng", "Ứng dụng khắc phục bằng cách"],
      ["Dữ liệu phân tán", "Không xuyên suốt giữa tuyển dụng, nhà máy và lương", "Gom hồ sơ, lịch sử và quan hệ vào một tenant công ty"],
      ["Sai tên và mã", "Trùng hoặc nhầm người, khó truy ngược", "UID, snapshot tại nhà máy và kiểm tra trùng lịch sử"],
      ["Báo cáo chậm", "Giám đốc ra quyết định sau khi sự việc đã xảy ra", "Dashboard lọc theo kỳ, nhà máy và người tuyển"],
      ["Phê duyệt mơ hồ", "Không rõ ai chịu trách nhiệm", "Trạng thái phê duyệt và nhật ký actor / thời điểm"],
      ["Đối soát thủ công", "Tốn giờ tổng hợp, dễ bỏ sót", "Nhập Excel có template, báo lỗi theo từng dòng, xuất lại file lỗi"],
    ],
  });
  table.styleOptions = { headerRow: true, bandedRows: true };
  table.borders.assign({ style: "solid", fill: C.line, width: 1 });
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 3; c++) {
      const cell = table.getCell(r, c);
      cell.text.style = { typeface: family, fontSize: r === 0 ? 16 : 15, bold: r === 0 || c === 0, color: r === 0 ? C.white : C.ink };
      if (r === 0) cell.fill = C.navy;
      else if (c === 0) cell.fill = "#EEF7F7";
    }
  }
  addText(slide, "Mục tiêu thương mại hóa: biến dữ liệu vận hành thành tài sản dùng chung, không phải file của riêng một người.", 72, 603, 1136, 38, { fontSize: 21, bold: true, color: C.teal, alignment: "center" });
  addFooter(slide, 5);
  addNotes(slide, "Bảng tổng hợp lợi ích định tính từ các luồng tính năng hiện có. Không gắn số liệu năng suất chưa được đo tại khách hàng.");
}

// 6. Executive view
{
  const slide = presentation.slides.add();
  slide.background.fill = C.mist;
  addTitle(slide, "Giám đốc thấy gì trong 5 phút?", "Góc nhìn điều hành");
  addText(slide, "Một màn hình tốt phải trả lời được câu hỏi tiếp theo, không chỉ hiển thị thêm dữ liệu.", 72, 136, 850, 40, { fontSize: 23, color: C.slate });
  addBox(slide, 72, 210, 500, 360, C.navy, 20, "none");
  addText(slide, "Câu hỏi điều hành", 108, 244, 410, 32, { fontSize: 24, bold: true, color: C.white });
  addBulletList(slide, [
    "Hôm nay có bao nhiêu NLĐ đang làm?",
    "Nhà máy nào tuyển mới hoặc rời việc nhiều?",
    "Nguồn tuyển nội bộ hay đối tác hiệu quả hơn?",
    "Có yêu cầu nào đang chờ phê duyệt?",
  ], 108, 298, 420, 58, "#D9F5F3", 18);
  addBox(slide, 620, 210, 588, 360, C.white, 20, C.line);
  addText(slide, "Câu trả lời từ hệ thống", 656, 244, 490, 32, { fontSize: 24, bold: true, color: C.navy });
  const qRows = [
    ["Trạng thái làm việc", "Đang làm / đã nghỉ / theo kỳ", C.teal],
    ["Hiệu quả tuyển", "Theo nhà máy và người tuyển", C.orange],
    ["Công lương", "Bảng công, lương, số giờ", C.green],
    ["Kiểm soát", "Phê duyệt, log, cảnh báo trùng", C.red],
  ];
  qRows.forEach(([a, b, tone], i) => {
    const y = 298 + i * 55;
    addBox(slide, 656, y + 3, 10, 34, tone, 5, "none");
    addText(slide, a, 680, y, 188, 26, { fontSize: 17, bold: true, color: C.ink });
    addText(slide, b, 876, y, 280, 26, { fontSize: 17, color: C.slate });
  });
  addText(slide, "Kết quả: cuộc họp bắt đầu từ quyết định, không bắt đầu từ việc hỏi “file nào mới nhất?”.", 72, 612, 1136, 30, { fontSize: 20, bold: true, color: C.teal, alignment: "center" });
  addFooter(slide, 6);
  addNotes(slide, "Nguồn nội bộ: dashboard nhân lực và các component workforce / approval / hour-stats trong PROJECT_MAP.md.");
}

// 7. Pricing table
{
  const slide = presentation.slides.add();
  slide.background.fill = C.white;
  addTitle(slide, "Gói giá theo quy mô vận hành", "Đề xuất giá niêm yết");
  addText(slide, "Đơn vị tính theo dữ liệu cần quản lý. Mỗi gói gồm một công ty, hỗ trợ onboarding từ xa và cập nhật tính năng nền tảng.", 72, 136, 1050, 40, { fontSize: 21, color: C.slate });
  const table = slide.tables.add({
    rows: 5,
    columns: 5,
    left: 72,
    top: 204,
    width: 1136,
    height: 320,
    columnWidths: [238, 180, 238, 238, 242],
    values: [
      ["Gói", "Giá / tháng", "Lịch sử đi làm", "Tài khoản staff", "Đối tác / Nhà máy"],
      ["Khởi động", "500.000 đ", "500", "5", "5 / 5"],
      ["Tăng trưởng", "1.500.000 đ", "2.000", "15", "15 / 15"],
      ["Chuyên nghiệp", "3.000.000 đ", "5.000", "30", "30 / 30"],
      ["Doanh nghiệp", "5.000.000 đ", "15.000", "100", "100 / 100"],
    ],
  });
  table.styleOptions = { headerRow: true, bandedRows: true };
  table.borders.assign({ style: "solid", fill: C.line, width: 1 });
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const cell = table.getCell(r, c);
      cell.text.style = { typeface: family, fontSize: r === 0 ? 15 : 18, bold: r === 0 || c === 0 || c === 1, color: r === 0 ? C.white : C.ink, alignment: c === 0 ? "left" : "center" };
      if (r === 0) cell.fill = C.navy;
      if (r === 1 && c === 1) cell.fill = C.paleOrange;
      if (r === 3 && c === 1) cell.fill = C.paleGreen;
    }
  }
  addBox(slide, 72, 558, 1136, 58, C.paleOrange, 14, "none");
  addText(slide, "Nguyên tắc mở rộng: nâng gói khi chạm 80% hạn mức; không cần thay đổi quy trình hay di chuyển dữ liệu.", 94, 575, 1090, 26, { fontSize: 18, bold: true, color: "#805A00", alignment: "center" });
  addFooter(slide, 7, "Đề xuất giá tham khảo | Có thể điều chỉnh theo số công ty, SLA và nhu cầu tích hợp");
  addNotes(slide, "Đây là đề xuất giá tham khảo theo yêu cầu người dùng, không phải bảng giá đã được phê duyệt. Hạn mức minh họa: lịch sử đi làm, tài khoản staff, đối tác và nhà máy.");
}

// 8. ROI chart
{
  const slide = presentation.slides.add();
  slide.background.fill = C.mist;
  addTitle(slide, "Chi phí nhỏ hơn một lỗi vận hành", "Lập luận giá trị");
  addText(slide, "Mô hình minh họa: chỉ cần giảm một phần thời gian đối soát mỗi tháng, gói phần mềm đã có thể tự hoàn vốn.", 72, 136, 1080, 40, { fontSize: 22, color: C.slate });
  const chart = slide.charts.add("bar", {
    position: { left: 72, top: 218, width: 770, height: 350 },
    categories: ["Khởi động", "Tăng trưởng", "Chuyên nghiệp", "Doanh nghiệp"],
    series: [
      { name: "Giá gói (triệu đ)", values: [0.5, 1.5, 3, 5], fill: C.navy },
      { name: "Giá trị thời gian (triệu đ)", values: [1.2, 3.2, 5.8, 9.5], fill: C.teal },
    ],
    barOptions: { direction: "column", grouping: "clustered", gapWidth: 50 },
    hasLegend: true,
    legend: { position: "bottom", textStyle: { typeface: family, fontSize: 14, fill: C.slate } },
    yAxis: { numberFormatCode: "0.0", title: { text: "Triệu đồng / tháng" }, majorGridlines: { style: "solid", fill: C.line, width: 1 }, textStyle: { typeface: family, fontSize: 13, fill: C.slate } },
    xAxis: { textStyle: { typeface: family, fontSize: 13, fill: C.slate } },
    dataLabels: { showValue: true, position: "outEnd", textStyle: { typeface: family, fontSize: 12, fill: C.ink, bold: true } },
  });
  applyPresentationChartFont(chart, { fontFamily: family });
  addBox(slide, 900, 218, 308, 350, C.white, 18, C.line);
  addText(slide, "Giả định minh họa", 932, 250, 245, 28, { fontSize: 22, bold: true, color: C.navy });
  addBulletList(slide, [
    "10 giờ đối soát giảm mỗi tháng",
    "120.000 đ / giờ chi phí thời gian",
    "Giá trị trực tiếp: 1,2 triệu đ",
    "Chưa tính lỗi dữ liệu và quyết định chậm",
  ], 932, 305, 245, 55, C.ink, 16);
  addBox(slide, 932, 526, 244, 32, C.paleGreen, 12, "none");
  addText(slide, "Khởi động: 2,4×", 944, 534, 220, 16, { fontSize: 15, bold: true, color: C.green, alignment: "center" });
  addFooter(slide, 8, "Giả định minh họa, cần đo lại trong pilot 30 ngày");
  addNotes(slide, "Biểu đồ không phải số liệu khách hàng. Giả định minh họa: 10 giờ đối soát giảm mỗi tháng x 120.000 đ/giờ = 1,2 triệu đ; các gói lớn dùng giả định thời gian tiết kiệm cao hơn để minh họa logic định giá.");
}

// 9. Pilot roadmap
{
  const slide = presentation.slides.add();
  slide.background.fill = C.white;
  addTitle(slide, "Lộ trình thí điểm 30 ngày", "Cách bán và triển khai");
  addText(slide, "Bắt đầu nhỏ, đo được, và chỉ mở rộng khi người dùng đã nhìn thấy dữ liệu của chính họ.", 72, 136, 920, 40, { fontSize: 22, color: C.slate });
  const weeks = [
    ["Tuần 1", "Thiết lập", "Chốt công ty, nhà máy, staff, đối tác và quyền truy cập.", C.teal],
    ["Tuần 2", "Di chuyển dữ liệu", "Nhập Excel theo template; xử lý các dòng lỗi còn lại.", C.cyan],
    ["Tuần 3", "Đưa vào nhịp", "Chạy luồng hồ sơ, lịch sử đi làm, phê duyệt và công/lương.", C.orange],
    ["Tuần 4", "Đo và mở rộng", "Đo giờ đối soát, lỗi dữ liệu, thời gian ra báo cáo; chọn gói phù hợp.", C.green],
  ];
  weeks.forEach(([week, title, desc, tone], i) => {
    const x = 72 + i * 284;
    addBox(slide, x, 240, 248, 255, C.mist, 18, tone);
    addBox(slide, x, 240, 248, 12, tone, 6, "none");
    addText(slide, week, x + 24, 274, 200, 22, { fontSize: 15, bold: true, color: tone });
    addText(slide, title, x + 24, 314, 200, 32, { fontSize: 24, bold: true, color: C.navy });
    addText(slide, desc, x + 24, 372, 200, 86, { fontSize: 17, color: C.slate });
    if (i < weeks.length - 1) addText(slide, "→", x + 252, 350, 30, 28, { fontSize: 24, bold: true, color: C.teal, alignment: "center" });
  });
  addBox(slide, 72, 548, 1136, 66, C.navy, 16, "none");
  addText(slide, "Đầu ra sau pilot: số liệu trước/sau, danh sách lỗi đã giảm và đề xuất gói theo quy mô thật.", 100, 568, 1080, 28, { fontSize: 21, bold: true, color: C.white, alignment: "center" });
  addFooter(slide, 9);
  addNotes(slide, "Lộ trình là đề xuất triển khai thương mại, không phải tính năng đã có sẵn trong ứng dụng.");
}

// 10. Close
{
  const slide = presentation.slides.add();
  slide.background.fill = C.navy;
  addBox(slide, 0, 0, 1280, 9, C.orange, 0, "none");
  addText(slide, "Bắt đầu với gói Khởi động", 92, 142, 850, 64, { fontSize: 48, bold: true, color: C.white });
  addText(slide, "500.000 đ / tháng", 94, 238, 500, 52, { fontSize: 34, bold: true, color: C.orange });
  addText(slide, "500 lịch sử đi làm · 5 staff · 5 đối tác · 5 nhà máy", 94, 312, 760, 34, { fontSize: 22, color: "#D9F5F3" });
  addBox(slide, 94, 408, 540, 76, C.teal, 18, "none");
  addText(slide, "Mục tiêu đầu tiên: một nguồn dữ liệu mà cả công ty cùng tin.", 122, 430, 485, 32, { fontSize: 21, bold: true, color: C.white, alignment: "center" });
  addText(slide, "Đề xuất tiếp theo: chọn một công ty hoặc một cụm nhà máy để chạy pilot 30 ngày.", 94, 594, 850, 30, { fontSize: 19, color: "#B7D1D3" });
  addText(slide, "Tuyển dụng 4.0", 1012, 622, 170, 24, { fontSize: 16, bold: true, color: C.white, alignment: "right" });
  addNotes(slide, "Đề xuất CTA cho buổi bán hàng. Giá và pilot cần được phê duyệt trước khi công bố chính thức.");
}

const candidatePath = path.join(buildDir, "candidate.pptx");
await (await PresentationFile.exportPptx(presentation)).save(candidatePath);
const montage = await presentation.export({ format: "webp", montage: true, scale: 1 });
await fs.writeFile(path.join(buildDir, "montage.webp"), new Uint8Array(await montage.arrayBuffer()));

const result = await finalizePresentation({
  explicitTotalSlideCount: 10,
  requiredNativeTableOwnerSlides: [5, 7],
  requiredNativeChartOwnerSlides: [8],
  materializeLiteralChartWorkbooks: true,
  workspaceDir,
  candidatePath,
  finalPath,
  pythonExecutable: runtimePython,
  integrityValidatorPath: path.join(skillDir, "container_tools/inspect_presentation_package_integrity.py"),
  layoutValidatorPath: path.join(skillDir, "container_tools/inspect_presentation_layout_geometry.py"),
  layoutArgs: ["--expected-slide-size-emu", "12192000,6858000", "--validate-heading-fit", "--validate-bullet-geometry", "--require-native-table-slide", "5", "--require-native-table-slide", "7"],
  requiredNativeTableOwnerSlides: [5, 7],
  requiredNativeChartOwnerSlides: [8],
  fontPolicy: { basis: "design", families: [family] },
  verifyArtifactToolImport: true,
  receiptPath: path.join(buildDir, "validation-v3.json"),
});
console.log(JSON.stringify({ finalPath, candidatePath, family, result }, null, 2));
