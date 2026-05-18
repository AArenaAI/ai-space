/**
 * 图片 URL 统一处理函数
 *
 * 数据库中的 image_url 可能是：
 *   1. 相对路径：/api/images/file/xxx.png  ✅ 直接用
 *   2. 绝对路径（当前 origin）：http://localhost:9091/...  ✅ 去掉无用信息
 *   3. 绝对路径（外网域名）：https://mideastsim.clawdbotgame.com/...  ❌ 替换为当前 origin
 *
 * 统一规则：尽可能使用相对路径 /api/images/file/xxx.png
 */
export function resolveImageUrl(url: string): string {
  if (!url) return "";

  // 已经是相对路径，直接用（浏览器会基于当前 origin 补全）
  if (url.startsWith("/")) return url;

  try {
    const parsed = new URL(url);
    // 只保留 pathname（即 /api/images/file/xxx.png 部分）
    // 这样不论域名是什么，都走当前页面的 origin
    return parsed.pathname;
  } catch {
    // 解析失败（理论上不会发生），原样返回
    return url;
  }
}
