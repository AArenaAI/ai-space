// 修复 CJK 场景下 **bold** 解析失败的问题
// 例如 **【商家自研应用】** → 在 ** 两侧插入空格帮助 markdown 解析
export function fixCjkBold(text: string): string {
  return text
    .replace(
      /([\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\u2e80-\u2eff\u31c0-\u31ef\u3400-\u4dbf\uf900-\ufaff\ufe10-\ufe1f\ufe30-\ufe4f])\*\*/g,
      "$1 **"
    )
    .replace(
      /\*\*([\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\u2e80-\u2eff\u31c0-\u31ef\u3400-\u4dbf\uf900-\ufaff\ufe10-\ufe1f\ufe30-\ufe4f])/g,
      "** $1"
    );
}
