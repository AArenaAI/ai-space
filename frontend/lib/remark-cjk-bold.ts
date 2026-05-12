// remark 插件：修复中文/全角标点紧贴 **bold** 的解析问题
// 例如 **【商家自研应用】** → 在 ** 两侧插入零宽空格再解析
import { visit } from "unist-util-visit";

// CJK 字符和全角标点范围
const CJK_RE =
  /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\u2e80-\u2eff\u31c0-\u31ef\u3200-\u32ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\ufe10-\ufe1f\ufe30-\ufe4f]/;

export default function remarkCjkBold() {
  return (tree: any) => {
    visit(tree, "text", (node: any) => {
      if (!node.value) return;
      let val: string = node.value;
      // 匹配中文/全角标点后紧跟 **，或 ** 后紧跟中文/全角标点
      // 在中间插入零宽空格 \u200B
      val = val.replace(/([\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])\*\*/g, "$1\u200b**");
      val = val.replace(/\*\*([\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])/g, "**\u200b$1");
      node.value = val;
    });
  };
}
