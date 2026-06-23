import type { UserFacingError } from "./types";

function authError(
  code: string,
  message: string,
  action: UserFacingError["action"] = "none"
): Partial<UserFacingError> {
  return {
    code,
    category: "auth",
    severity: "warning",
    title: "认证失败",
    message,
    action,
  };
}

export function mapAuthError(raw: string): Partial<UserFacingError> | null {
  const message = raw.trim();
  if (!message) return null;

  if (/邮箱或密码错误|invalid.*(email|password)|incorrect.*(email|password)|wrong.*password|invalid credentials/i.test(message)) {
    return authError("auth_invalid_credentials", "邮箱或密码错误");
  }

  if (/该邮箱已被注册|email.*(already|exists|registered)|already.*registered/i.test(message)) {
    return authError("auth_email_registered", "该邮箱已被注册", "login");
  }

  if (/该邮箱尚未注册|邮箱尚未注册|email.*not.*registered|user.*not.*found/i.test(message)) {
    return authError("auth_email_not_registered", "该邮箱尚未注册，请先注册账号。", "none");
  }

  if (/验证码|verification code|code/i.test(message)) {
    return authError("auth_verification_code", message, "none");
  }

  if (/发送过于频繁|too many requests|rate.?limit|稍后再试/i.test(message)) {
    return authError("auth_rate_limited", message, "wait");
  }

  if (/邮件服务未配置|邮件.*发送失败|验证码邮件发送失败|SMTP|mail.*failed|email.*failed/i.test(message)) {
    return authError("auth_email_send_failed", message, "retry");
  }

  if (/创建账号失败|create.*account|register.*failed|signup.*failed/i.test(message)) {
    return authError("auth_register_failed", "注册失败，请稍后重试。", "retry");
  }

  if (/生成 token 失败|token/i.test(message)) {
    return authError("auth_token_failed", "登录状态创建失败，请稍后重试。", "retry");
  }

  if (/未登录|认证信息无效|unauthorized|login required/i.test(message)) {
    return {
      code: "login_required",
      category: "auth",
      severity: "warning",
      title: "需要登录",
      message: "请先登录后继续使用。",
      action: "login",
      actionLabel: "去登录",
    };
  }

  if (/Field validation|binding|required|email|min/i.test(message)) {
    return authError("auth_invalid_input", "请检查邮箱和密码是否填写正确。");
  }

  return null;
}
