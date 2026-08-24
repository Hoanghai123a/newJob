import type { ReactNode } from "react";
import { toast as sonnerToast } from "sonner";

type ErrorLike = {
  message?: unknown;
  response?: { message?: unknown };
  data?: { message?: unknown };
};

const NETWORK_ERROR_PATTERN =
  /failed to fetch|networkerror|network request failed|load failed|econnrefused|err_network|offline|timeout/i;
const TECHNICAL_ERROR_PATTERN =
  /\b(error|exception|failed|invalid|unauthorized|forbidden|not found|internal|server|network|fetch|request|response|pocketbase|http)\b/i;
const VIETNAMESE_PATTERN =
  /[\u00C0-\u1EF9]|\b(không|vui lòng|đã|lỗi|không thể|tài khoản|mật khẩu|dữ liệu|cập nhật|tải|nhập|xóa|xoá|gửi|chọn|thiếu)\b/i;

function getErrorText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    const error = value as ErrorLike;
    for (const candidate of [error.response?.message, error.data?.message, error.message]) {
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
  }
  return "";
}

export function getUserErrorMessage(error: unknown, fallback = "Đã xảy ra lỗi. Vui lòng thử lại.") {
  const message = getErrorText(error);
  if (!message) return fallback;
  if (NETWORK_ERROR_PATTERN.test(message)) {
    return "Không kết nối được máy chủ. Vui lòng kiểm tra kết nối mạng và thử lại.";
  }
  if (VIETNAMESE_PATTERN.test(message)) return message;
  return "Đã xảy ra lỗi. Vui lòng thử lại.";
}

function logTechnicalError(error: unknown) {
  const message = getErrorText(error);
  if (
    import.meta.env.DEV &&
    (!message || !VIETNAMESE_PATTERN.test(message) || TECHNICAL_ERROR_PATTERN.test(message))
  ) {
    console.error("[JobConnect] Lỗi gốc:", error);
  }
}

const baseToast = Object.assign(
  (message: ReactNode, data?: Parameters<typeof sonnerToast>[1]) => sonnerToast(message, data),
  sonnerToast,
);

export const toast = Object.assign(baseToast, {
  error: (error: unknown, data?: Parameters<typeof sonnerToast.error>[1]) => {
    logTechnicalError(error);
    return sonnerToast.error(getUserErrorMessage(error), data);
  },
});
