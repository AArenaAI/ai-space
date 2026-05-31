import type { UserFacingError } from "./types";

export function mapFileError(raw: string): Partial<UserFacingError> | null {
  const message = raw.trim();
  if (!message) return null;

  if (/guest_id_required|visitor ID|匿名用户.*刷新|localStorage/i.test(message)) {
    return {
      code: "file_guest_id_required",
      category: "auth",
      severity: "warning",
      title: "匿名模式不可用",
      message: "匿名模式初始化失败，请刷新页面后重试。",
      action: "retry",
      actionLabel: "刷新页面",
    };
  }

  if (/file_not_ready|解析中|正在解析/i.test(message)) {
    return {
      code: "file_not_ready",
      category: "file",
      severity: "info",
      title: "文件仍在解析中",
      message: "文件仍在解析中，完成后再发送。",
      action: "wait",
    };
  }

  if (/格式|unsupported|not support|不支持/i.test(message)) {
    return {
      code: "file_unsupported",
      category: "file",
      severity: "warning",
      title: "文件格式不支持",
      message: "文件格式不支持，请换一个文件上传。",
      action: "upload_again",
      actionLabel: "重新上传",
    };
  }

  if (/大小|too large|exceed|exceeded|超过\s*\d+\s*(MB|M|KB|K)|不能超过/i.test(message)) {
    return {
      code: "file_too_large",
      category: "file",
      severity: "warning",
      title: "文件过大",
      message: "文件超过大小限制，请压缩后重新上传。",
      action: "reduce_file",
      actionLabel: "重新上传",
    };
  }

  if (/读取文件|无法读取文件|read file/i.test(message)) {
    return {
      code: "file_read_failed",
      category: "file",
      severity: "error",
      title: "文件读取失败",
      message: "文件读取失败，请重新选择文件。",
      action: "upload_again",
      actionLabel: "重新上传",
    };
  }

  if (/处理失败|解析失败|parse failed|process failed/i.test(message)) {
    return {
      code: "file_process_failed",
      category: "file",
      severity: "error",
      title: "文件处理失败",
      message: "文件处理失败，请稍后重试或换一个文件。",
      action: "upload_again",
      actionLabel: "重新上传",
    };
  }

  return null;
}
