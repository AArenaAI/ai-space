import type { UserFacingError } from "./types";

export function mapTranslateError(raw: string): Partial<UserFacingError> | null {
  const message = raw.trim();
  if (!message) return null;

  if (/target language|目标语言|language.*(unsupported|not support)|不支持.*语言|unsupported.*language/i.test(message)) {
    return {
      code: "translate_language_unsupported",
      category: "translation",
      severity: "warning",
      title: "目标语言暂不支持",
      message: "当前翻译服务暂不支持这个目标语言，请换一种目标语言后重试。",
      action: "retry",
      actionLabel: "重试",
    };
  }

  if (/mime|format|格式|unsupported|not support|不支持/i.test(message)) {
    return {
      code: "translate_provider_unsupported",
      category: "translation",
      severity: "warning",
      title: "翻译暂不支持",
      message: "当前翻译服务暂不支持这个翻译请求，请换一种目标语言或稍后重试。",
      action: "retry",
      actionLabel: "重试",
    };
  }

  if (/translate|translation|Google Translate|翻译/i.test(message)) {
    return {
      code: "translate_failed",
      category: "translation",
      severity: "error",
      title: "翻译失败",
      message: "翻译服务暂时不可用，请稍后重试。",
      action: "retry",
      actionLabel: "重试",
    };
  }

  return null;
}
