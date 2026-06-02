import { ERROR_CATALOG } from "./errorCatalog";
import { mapChatError } from "./chatErrorMap";
import { mapFileError } from "./fileErrorMap";
import { mapMediaError } from "./mediaErrorMap";
import { mapTranslateError } from "./translateErrorMap";
import type { ApiErrorPayload, NormalizeErrorOptions, UserFacingError } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractApiPayload(input: unknown): ApiErrorPayload {
  if (input instanceof Error) {
    return { message: input.message };
  }
  if (typeof input === "string") {
    return { message: input };
  }
  if (isRecord(input)) {
    const code = typeof input.code === "string" ? input.code : typeof input.error_code === "string" ? input.error_code : undefined;
    const error = typeof input.error === "string" ? input.error : undefined;
    const message = typeof input.message === "string" ? input.message : error;
    const debug = typeof input.debug === "string" ? input.debug : typeof input.detail === "string" ? input.detail : undefined;
    const status = typeof input.status === "number" ? input.status : undefined;
    const rawText = typeof input.rawText === "string" ? input.rawText : undefined;
    return { code, error, message, debug, status, rawText };
  }
  return {};
}

const LOCALIZED_ERROR_COPY: Record<string, Record<string, Partial<Pick<UserFacingError, "title" | "message" | "actionLabel">>>> = {
  file_unsupported: {
    en: {
      title: "Unsupported file format",
      message: "This file format is not supported. Please upload a different file.",
      actionLabel: "Upload again",
    },
    "zh-CN": {
      title: "文件格式不支持",
      message: "文件格式不支持，请换一个文件上传。",
      actionLabel: "重新上传",
    },
    "zh-TW": {
      title: "檔案格式不支援",
      message: "檔案格式不支援，請換一個檔案上傳。",
      actionLabel: "重新上傳",
    },
  },
  translate_language_unsupported: {
    en: {
      title: "Target language not supported",
      message: "The translation service does not support this target language yet. Please choose another target language and try again.",
      actionLabel: "Retry",
    },
    "zh-CN": {
      title: "目标语言暂不支持",
      message: "当前翻译服务暂不支持这个目标语言，请换一种目标语言后重试。",
      actionLabel: "重试",
    },
    "zh-TW": {
      title: "目標語言暫不支援",
      message: "目前翻譯服務暫不支援這個目標語言，請換一種目標語言後重試。",
      actionLabel: "重試",
    },
  },
  translate_provider_unsupported: {
    en: {
      title: "Translation not supported",
      message: "The translation service does not support this request yet. Please choose another target language or try again later.",
      actionLabel: "Retry",
    },
    "zh-CN": {
      title: "翻译暂不支持",
      message: "当前翻译服务暂不支持这个翻译请求，请换一种目标语言或稍后重试。",
      actionLabel: "重试",
    },
    "zh-TW": {
      title: "翻譯暫不支援",
      message: "目前翻譯服務暫不支援這個翻譯請求，請換一種目標語言或稍後重試。",
      actionLabel: "重試",
    },
  },
  translate_failed: {
    en: {
      title: "Translation failed",
      message: "The translation service is temporarily unavailable. Please try again later.",
      actionLabel: "Retry",
    },
    "zh-CN": {
      title: "翻译失败",
      message: "翻译服务暂时不可用，请稍后重试。",
      actionLabel: "重试",
    },
    "zh-TW": {
      title: "翻譯失敗",
      message: "翻譯服務暫時不可用，請稍後重試。",
      actionLabel: "重試",
    },
  },
};

function currentLanguageForErrorCopy() {
  if (typeof document === "undefined") return "zh-CN";
  const lang = document.documentElement.lang || localStorage.getItem("language") || "zh-CN";
  if (lang === "zh-CN" || lang === "zh-TW") return lang;
  return "en";
}

function localizeErrorCopy(error: UserFacingError): UserFacingError {
  const localized = LOCALIZED_ERROR_COPY[error.code]?.[currentLanguageForErrorCopy()];
  return localized ? { ...error, ...localized } : error;
}

function apply(input: Partial<UserFacingError>, base?: Partial<UserFacingError>): UserFacingError {
  const fallback: Partial<UserFacingError> = base || ERROR_CATALOG.unknown;
  return localizeErrorCopy({
    code: input.code || fallback.code || ERROR_CATALOG.unknown.code,
    category: input.category || fallback.category || ERROR_CATALOG.unknown.category,
    severity: input.severity || fallback.severity || ERROR_CATALOG.unknown.severity,
    title: input.title || fallback.title || ERROR_CATALOG.unknown.title,
    message: input.message || fallback.message || ERROR_CATALOG.unknown.message,
    action: input.action || fallback.action || ERROR_CATALOG.unknown.action,
    actionLabel: input.actionLabel || fallback.actionLabel,
    debugMessage: input.debugMessage || fallback.debugMessage,
    httpStatus: input.httpStatus || fallback.httpStatus,
    raw: input.raw ?? fallback.raw,
  });
}

function catalogFromCode(code?: string): Partial<UserFacingError> | null {
  if (!code) return null;
  switch (code) {
    case "guest_id_required":
      return {
        code,
        category: "auth",
        severity: "warning",
        title: "匿名模式不可用",
        message: "匿名模式初始化失败，请刷新页面后重试。",
        action: "retry",
        actionLabel: "刷新页面",
      };
    case "guest_limit_exceeded":
      return {
        code,
        category: "quota",
        severity: "warning",
        title: "匿名额度已用完",
        message: "匿名用户每日额度已用完，请登录后继续使用。",
        action: "login",
        actionLabel: "去登录",
      };
    case "file_not_ready":
      return {
        code,
        category: "file",
        severity: "info",
        title: "文件仍在解析中",
        message: "文件正在解析中，请稍后再试。",
        action: "wait",
      };
    case "unauthorized":
    case "login_required":
      return ERROR_CATALOG.loginRequired;
    default:
      return null;
  }
}

function mapGeneric(raw: string, httpStatus?: number): Partial<UserFacingError> | null {
  if (httpStatus === 401 || /unauthorized|401|请先登录|login required/i.test(raw)) return ERROR_CATALOG.loginRequired;
  if (httpStatus === 429 || /rate.?limit|too many requests|429|频率|限流/i.test(raw)) return ERROR_CATALOG.rateLimit;
  if (/timeout|timed?\s*out|deadline|超时/i.test(raw)) return ERROR_CATALOG.timeout;
  if (/network|failed to fetch|fetch failed|ECONN|连接|网络/i.test(raw)) return ERROR_CATALOG.network;
  if (/insufficient|quota|credit|balance|额度|积分|余额/i.test(raw)) return ERROR_CATALOG.quota;
  if (/content policy|safety|unsafe|violat|内容.*(违规|安全|无法)/i.test(raw)) return ERROR_CATALOG.contentPolicy;
  if (httpStatus && httpStatus >= 500) return ERROR_CATALOG.server;
  return null;
}

function shouldPassThrough(message: string) {
  return /^(请先|请输入|请描述|请选择|读取图片失败|上传图片失败|原图上传失败|无可用的视频模型|仅支持上传|参考图不能超过|参考视频不能超过|参考视频仅支持|历史记录只能保存)/.test(message);
}

function looksTechnical(message: string) {
  return (
    message.length > 90 ||
    /^[\[{]/.test(message) ||
    /\b(error|exception|stack|trace|provider|openai|api|json|sql|gorm|panic|invalid_request_error)\b/i.test(message) ||
    /HTTP\s*\d{3}|\(HTTP\s*\d{3}\)/i.test(message)
  );
}

export function normalizeError(input: unknown, options: NormalizeErrorOptions = {}): UserFacingError {
  const payload = extractApiPayload(input);
  const httpStatus = options.httpStatus ?? payload.status;
  const rawMessage = (payload.message || payload.error || payload.code || payload.rawText || "").trim();
  const debugMessage = payload.debug || payload.rawText || rawMessage;

  const fallbackBase: Partial<UserFacingError> = {
    ...ERROR_CATALOG.unknown,
    code: options.fallbackCode || ERROR_CATALOG.unknown.code,
    title: options.fallbackTitle || ERROR_CATALOG.unknown.title,
    message: options.fallbackMessage || ERROR_CATALOG.unknown.message,
    httpStatus,
    debugMessage,
    raw: input,
  };

  const byCode = catalogFromCode(payload.code || payload.error);
  if (byCode) return apply({ ...byCode, httpStatus, debugMessage, raw: input }, fallbackBase);

  const moduleMap =
    options.module === "file"
      ? mapFileError(rawMessage)
      : options.module === "translate"
        ? mapTranslateError(rawMessage)
      : options.module === "chat"
        ? mapChatError(rawMessage) || mapFileError(rawMessage)
        : options.module === "image" || options.module === "image_edit" || options.module === "video"
          ? mapMediaError(rawMessage, options.module) || mapFileError(rawMessage)
          : null;
  if (moduleMap) return apply({ ...moduleMap, httpStatus, debugMessage, raw: input }, fallbackBase);

  const generic = mapGeneric(rawMessage, httpStatus);
  if (generic) return apply({ ...generic, httpStatus, debugMessage, raw: input }, fallbackBase);

  if (rawMessage && shouldPassThrough(rawMessage)) {
    return apply(
      {
        code: payload.code || options.fallbackCode || "validation_error",
        category: "validation",
        severity: "warning",
        title: options.fallbackTitle || "请检查输入",
        message: rawMessage,
        action: "none",
        httpStatus,
        debugMessage,
        raw: input,
      },
      fallbackBase
    );
  }

  if (rawMessage && !looksTechnical(rawMessage)) {
    return apply(
      {
        code: payload.code || options.fallbackCode || "operation_failed",
        category: options.module === "video" ? "video_generation" : options.module === "image_edit" ? "image_edit" : options.module === "image" ? "image_generation" : "unknown",
        severity: "error",
        title: options.fallbackTitle || "操作失败",
        message: rawMessage,
        action: "retry",
        actionLabel: "重试",
        httpStatus,
        debugMessage,
        raw: input,
      },
      fallbackBase
    );
  }

  return apply(fallbackBase);
}

export function getErrorMessage(input: unknown, options?: NormalizeErrorOptions) {
  return normalizeError(input, options).message;
}
