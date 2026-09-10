// Common Vietnamese banks (short name — full name)
export type VnBank = { code: string; name: string; bin: string; qrName?: string };

export const VN_BANKS: VnBank[] = [
  { code: "VCB", name: "Vietcombank - NH TMCP Ngoại thương Việt Nam", bin: "970436" },
  { code: "ICB", name: "VietinBank - NH TMCP Công thương Việt Nam", bin: "970415" },
  { code: "BIDV", name: "BIDV - NH TMCP Đầu tư và Phát triển Việt Nam", bin: "970418" },
  { code: "AGR", name: "Agribank - NH Nông nghiệp và PT Nông thôn", bin: "970405" },
  { code: "TCB", name: "Techcombank - NH TMCP Kỹ thương Việt Nam", bin: "970407" },
  { code: "MB", name: "MB Bank - NH TMCP Quân đội", bin: "970422" },
  { code: "ACB", name: "ACB - NH TMCP Á Châu", bin: "970416" },
  { code: "VPB", name: "VPBank - NH TMCP Việt Nam Thịnh Vượng", bin: "970432" },
  { code: "STB", name: "Sacombank - NH TMCP Sài Gòn Thương Tín", bin: "970403" },
  { code: "TPB", name: "TPBank - NH TMCP Tiên Phong", bin: "970423" },
  { code: "SHB", name: "SHB - NH TMCP Sài Gòn - Hà Nội", bin: "970443" },
  { code: "HDB", name: "HDBank - NH TMCP Phát triển TP.HCM", bin: "970437" },
  { code: "VIB", name: "VIB - NH TMCP Quốc tế Việt Nam", bin: "970441" },
  { code: "MSB", name: "MSB - NH TMCP Hàng Hải Việt Nam", bin: "970426" },
  { code: "OCB", name: "OCB - NH TMCP Phương Đông", bin: "970448" },
  { code: "SEA", name: "SeABank - NH TMCP Đông Nam Á", bin: "970440" },
  { code: "LPB", name: "LPBank - NH TMCP Lộc Phát (LienVietPostBank)", bin: "970449" },
  { code: "EIB", name: "Eximbank - NH TMCP Xuất nhập khẩu Việt Nam", bin: "970431" },
  { code: "NAB", name: "NamABank - NH TMCP Nam Á", bin: "970428" },
  { code: "BAB", name: "BacABank - NH TMCP Bắc Á", bin: "970409" },
  { code: "ABB", name: "ABBank - NH TMCP An Bình", bin: "970425" },
  { code: "PVB", name: "PVcomBank - NH TMCP Đại Chúng Việt Nam", bin: "970412" },
  { code: "SGB", name: "Saigonbank - NH TMCP Sài Gòn Công Thương", bin: "970400" },
  { code: "KLB", name: "KienLongBank - NH TMCP Kiên Long", bin: "970452" },
  { code: "VAB", name: "VietABank - NH TMCP Việt Á", bin: "970427" },
  { code: "VBB", name: "Vietbank - NH TMCP Việt Nam Thương Tín", bin: "970454" },
  { code: "BVB", name: "BaoVietBank - NH TMCP Bảo Việt", bin: "970438" },
  { code: "NCB", name: "NCB - NH TMCP Quốc Dân", bin: "970419" },
  { code: "SCB", name: "SCB - NH TMCP Sài Gòn", bin: "970429" },
  { code: "DAB", name: "DongABank - NH TMCP Đông Á", bin: "970406" },
  { code: "PGB", name: "PGBank - NH TMCP Xăng dầu Petrolimex", bin: "970430" },
  { code: "VCCB", name: "VietCapitalBank - NH Bản Việt", bin: "970454" },
  { code: "CAKE", name: "Cake by VPBank", bin: "546034" },
  { code: "TIMO", name: "Timo", bin: "963388" },
  { code: "UB", name: "Ubank by VPBank", bin: "546035" },
  { code: "SCBVN", name: "Standard Chartered Việt Nam", bin: "970410" },
  { code: "HSBC", name: "HSBC Việt Nam", bin: "458761" },
  { code: "SHBVN", name: "Shinhan Bank Việt Nam", bin: "970424" },
  { code: "WRB", name: "Woori Bank Việt Nam", bin: "970457" },
  { code: "UOB", name: "UOB Việt Nam", bin: "970458" },
  { code: "PBVN", name: "Public Bank Việt Nam", bin: "970439" },
  { code: "CITI", name: "Citibank Việt Nam", bin: "533948" },
  { code: "IVB", name: "Indovina Bank", bin: "970434" },
  { code: "VRB", name: "Vietnam-Russia Joint Venture Bank (VRB)", bin: "970421" },
];

const QR_BANK_NAMES: Record<string, string> = {
  ABB: "Ngân hàng TMCP An Bình",
  ACB: "Ngân hàng TMCP Á Châu",
  AGR: "Ngân hàng Nông nghiệp và Phát triển Nông thôn Việt Nam",
  BAB: "Ngân hàng TMCP Bắc Á",
  BIDV: "Ngân hàng TMCP Đầu tư và Phát triển Việt Nam",
  BVB: "Ngân hàng TMCP Bảo Việt",
  DAB: "Ngân hàng TMCP Đông Á",
  EIB: "Ngân hàng TMCP Xuất nhập khẩu Việt Nam",
  HDB: "Ngân hàng TMCP Phát triển Thành phố Hồ Chí Minh",
  ICB: "Ngân hàng TMCP Công thương Việt Nam",
  MB: "Ngân hàng TMCP Quân đội",
  SHBVN: "Ngân hàng TNHH MTV Shinhan Việt Nam",
  VCB: "Ngân hàng TMCP Ngoại thương Việt Nam",
  VPB: "Ngân hàng TMCP Việt Nam Thịnh Vượng",
};

export function getQrBankName(bank: VnBank): string {
  return bank.qrName || QR_BANK_NAMES[bank.code] || bank.name.replace(/^[^-]+-\s*/, "");
}

export function getQrBankLabel(bank: VnBank): string {
  return `${bank.code} - ${getQrBankName(bank)}`;
}

export function findBankByCode(input: string): VnBank | undefined {
  const code = input.trim().toUpperCase();
  return VN_BANKS.find((bank) => bank.code.toUpperCase() === code);
}

function findExactBank(input: string) {
  const value = input.trim();
  if (!value) return undefined;

  const code = value.toLowerCase();
  return VN_BANKS.find((bank) => bank.code.toLowerCase() === code || bank.name === value);
}

export function getBankBin(bankName: string): string | undefined {
  return findExactBank(bankName)?.bin;
}

export function resolveBankName(input: string): string {
  const value = input.trim();
  if (!value) return "";
  return findExactBank(value)?.name || value;
}

/**
 * Chuyển tên đầy đủ hoặc mã ngân hàng đang lưu về mã chuẩn (VD: "STB").
 * - Nhận cả tên đầy đủ hoặc mã (không phân biệt hoa/thường với mã).
 * - Giá trị trống trả về trống.
 * - Giá trị không khớp danh mục giữ nguyên để tránh mất thông tin.
 */
export function resolveBankCode(input: string): string {
  const value = input.trim();
  if (!value) return "";
  return findExactBank(value)?.code || value;
}

export function buildVietQrUrl(opts: {
  bankName: string;
  accountNumber: string;
  accountName?: string;
  amount?: number;
  description?: string;
}): string | null {
  const bin = getBankBin(opts.bankName);
  if (!bin || !opts.accountNumber) return null;
  const params = new URLSearchParams();
  if (opts.amount) params.set("amount", String(opts.amount));
  if (opts.description) params.set("addInfo", opts.description);
  if (opts.accountName) params.set("accountName", opts.accountName);
  return `https://img.vietqr.io/image/${bin}-${opts.accountNumber}-compact2.png?${params.toString()}`;
}
