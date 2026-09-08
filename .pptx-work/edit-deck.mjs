import fs from 'node:fs/promises';
import { FileBlob, PresentationFile } from '@oai/artifact-tool';

const sourcePath = 'D:/My App/newApp/Tuyển Dụng 4.0 - Đề Xuất Số Hóa Vận Hành Nhân Sự.pptx';
const draftPath = 'D:/My App/newApp/.pptx-work/candidate.pptx';
const presentation = await PresentationFile.importPptx(await FileBlob.load(sourcePath));

const textUpdates = new Map([
  ['sh/4bq1wzmp', 'Một nguồn dữ liệu thống nhất cho Giám đốc, HR và vận hành nhà máy\nRa quyết định nhanh hơn, giảm đối soát, rõ trách nhiệm'],
  ['sh/rq9g7mhs', 'Nội dung chính: từ vấn đề đến quyết định mua'],
  ['sh/9w76xob6', '1. Hiện trạng và rủi ro'],
  ['sh/mtgn29sf', '2. Giải pháp, giá trị và chi phí'],
  ['sh/7up4vet0', 'Dòng công việc hiện tại:\nNhập liệu → gửi file → tổng hợp → đối soát → báo cáo lãnh đạo.'],
  ['sh/wzi583ah', 'Đội ngũ phải dành nhiều giờ để tìm dữ liệu đúng thay vì xử lý công việc chuyên môn.'],
  ['sh/uxwf6xgz', 'Sai lệch dữ liệu: Tên, mã nhân viên và nhà máy không đồng nhất giữa các file.'],
  ['sh/fi5gz2hk', 'Thiếu cập nhật: Không biết bản ghi nào là mới nhất để báo cáo.'],
  ['sh/gjyx87y5', 'Rủi ro tài chính: Sai sót khi đối soát tuyển dụng, tạm ứng và giữ lương.'],
  ['sh/hk7y1czq', 'Phụ thuộc cá nhân: Chỉ một người nắm file tổng hợp, báo cáo dễ chậm.'],
  ['sh/7y5gnepg', 'Một nguồn dữ liệu cho toàn bộ vòng đời người lao động'],
  ['sh/dkrilsrq', 'Hồ sơ người lao động chuẩn hóa'],
  ['sh/sji1s7q5', 'Định danh UID, CCCD và tài khoản. Một hồ sơ theo dõi lịch sử đi làm, mã NV, nhà máy và đối tác.'],
  ['sh/qh0jqx8z', 'Công và tài chính vận hành'],
  ['sh/1oripcrm', 'Liên kết lịch sử đi làm với công, lương, thâm niên, tạm ứng và giữ lương; mọi yêu cầu đều có trạng thái duyệt.'],
  ['sh/fm90n29w', 'Phân quyền và nhật ký'],
  ['sh/el0jux8b', 'Mỗi vai trò chỉ xem phần cần thiết. Lưu ai làm, lúc nào và thay đổi gì để dễ kiểm tra.'],
  ['sh/nqp8ju1k', 'Năng lực sẵn sàng cho vận hành'],
  ['sh/7uxsfy9w', 'Quản lý tập trung, dễ kiểm soát'],
  ['sh/8v6983qh', '• Dashboard nhân lực theo thời gian thực: Xử lý 500+ bản ghi mỗi lần tải, lọc theo nhà máy, người tuyển và trạng thái đang làm/đã nghỉ.'],
  ['sh/9wfah8rm', '• Nhập/xuất Excel theo UID: Dòng lỗi tách riêng, không làm gián đoạn dữ liệu hợp lệ.'],
  ['sh/uxobad87', '• Kiểm soát rủi ro: Cảnh báo trùng lịch sử đi làm, kiểm tra phiên bản CCCD và bảo mật dữ liệu tài chính.'],
  ['sh/3yxkfm5s', 'Giá trị thấy ngay trong vận hành'],
  ['sh/uxo32x4r', 'Giám đốc nắm tình hình trong 5 phút'],
  ['sh/2p0n2lg7', 'Phút để xem bức tranh tổng thể'],
  ['sh/nqt4v6hs', 'Xem và quyết định ngay'],
  ['sh/0ni50by1', 'Không cần hỏi “File Excel nào mới nhất?”. Hệ thống trả lời bốn câu hỏi điều hành:'],
  ['sh/1ormtgzm', 'Hiện có bao nhiêu lao động đang đi làm?'],
  ['sh/twfmts36', 'Nhà máy hoặc nguồn tuyển nào đang hiệu quả?'],
  ['sh/sb6l0nm1', 'Công, tạm ứng và lương hiện tại thế nào?'],
  ['sh/7ax4rilg', 'Yêu cầu tài chính nào đang chờ duyệt?'],
  ['sh/cbu9ofmt', 'Mức giá mở rộng theo quy mô'],
  ['sh/qh0vaxwv', '* Khi chạm 80% hạn mức, hệ thống đề xuất nâng gói; quy trình và dữ liệu vẫn giữ nguyên.'],
  ['sh/ilgjit0r', 'Chi phí phần mềm thấp hơn chi phí đối soát thủ công'],
  ['sh/xkvq9gr2', 'Lộ trình thí điểm 30 ngày'],
  ['sh/i58bypsr', 'Đội ngũ đồng hành từng bước để chuyển đổi an toàn, không gián đoạn vận hành:'],
  ['sh/vihs3atg', '1. Thiết lập hệ thống'],
  ['sh/uh8bu5sv', 'Khởi tạo Workspace, nhà máy, đối tác và phân quyền Staff (1-2 ngày).'],
  ['sh/8f69sfap', '2. Chuẩn hóa dữ liệu'],
  ['sh/yl47218n', 'Chuẩn hóa file Excel theo mẫu và xử lý các dòng lỗi cũ.'],
  ['sh/knmp4bqt', '3. Vận hành thực tế'],
  ['sh/lovqdgry', 'Chạy hồ sơ, lịch sử đi làm, phê duyệt tạm ứng và công/lương trên ứng dụng.'],
  ['sh/bid8769w', '4. Đo lường và bàn giao'],
  ['sh/cjmp0bqh', 'Đo thời gian đối soát, kiểm tra lỗi và chốt gói theo quy mô thực tế.'],
  ['sh/ipw7e1g3', 'Bắt đầu bằng gói thí điểm'],
  ['sh/d8ridcb2', 'Gói thí điểm khởi động'],
  ['sh/cfuxgjap', 'Cam kết thử nghiệm:\nNếu sau 30 ngày thời gian đối soát không giảm tối thiểu 50%, doanh nghiệp được hoàn lại 100% phí thí điểm.'],
  ['sh/adcfe9sz', 'Kích hoạt trong 15 phút'],
  ['sh/ho7ahkj2', 'Xác nhận gói thí điểm và khởi tạo hệ thống riêng cho công ty.'],
  ['sh/gnyt8fih', 'Gửi file Excel mẫu; kỹ thuật chuẩn hóa và nhập dữ liệu ban đầu miễn phí.'],
  ['sh/fmpsfa1w', 'Nhận bàn giao và bắt đầu vận hành trong tuần này.'],
  ['sh/29sfa9sn', 'Hỗ trợ kỹ thuật qua Hotline/Zalo: 24/7'],
  ['sh/w3ip0byt', 'Nguồn hình ảnh tham chiếu'],
  ['sh/ypk72lgj', 'Ảnh dashboard tham chiếu: adminlte.io'],
]);

for (const [id, value] of textUpdates) presentation.resolve(id).text.set(value);

const table = presentation.resolve('tb/upozutcf');
const tableRows = [
  ['Vấn đề hiện tại', 'Chi phí vận hành', 'Ứng dụng giải quyết'],
  ['Dữ liệu phân tán', 'Không liền mạch từ tuyển dụng đến tính lương', 'Một Workspace cho hồ sơ và lịch sử'],
  ['Sai tên, trùng mã NV', 'Khó truy trách nhiệm, rủi ro tài chính', 'Định danh UID, lưu phiên bản và cảnh báo trùng'],
  ['Báo cáo chậm', 'Quyết định dựa trên dữ liệu cũ', 'Dashboard cập nhật ngay khi có dữ liệu'],
  ['Phê duyệt mơ hồ', 'Tranh cãi khi có sai sót ứng/giữ lương', 'Lưu trạng thái, thời điểm và tài khoản duyệt'],
];
for (let r = 0; r < tableRows.length; r += 1) for (let c = 0; c < tableRows[r].length; c += 1) table.getCell(r, c).text.set(tableRows[r][c]);

// Normalize all editable text, including table cells, to a Vietnamese-safe family.
for (const slide of presentation.slides.items) {
  for (const shape of slide.shapes.items) if (shape.text) shape.text.typeface = 'Arial';
  for (const t of slide.tables.items) for (let r = 0; r < t.rowCount; r += 1) for (let c = 0; c < t.columnCount; c += 1) t.getCell(r, c).text.typeface = 'Arial';
}

// Make the ROI comparison transparent about its assumption.
const roiSlide = presentation.slides.items[7];
const note = roiSlide.shapes.add({ geometry: 'textbox', position: { left: 60, top: 145, width: 1160, height: 26 }, fill: 'none', line: { fill: 'none', width: 0 } });
note.text = 'Minh họa theo giả định 12 giờ đối soát/tháng; xác nhận lại bằng số liệu thực tế trước khi ký hợp đồng.';
note.text.style = { typeface: 'Arial', fontSize: 14, color: '#64748B', italic: true, alignment: 'left', autoFit: 'shrinkTextOnOverflow' };

await (await PresentationFile.exportPptx(presentation)).save(draftPath);
console.log(JSON.stringify({ draftPath, slideCount: presentation.slides.items.length }));
