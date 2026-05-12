// remark 插件：修复 CJK 全角标点紧贴 **bold** 的解析失败
// remark-gfm 在遇到 **【...】** 或 **...。** 时无法正确识别为 strong
// 此插件找到残留的 ** 字面量，在 AST 层面将其包裹为 strong 节点

import { visit } from "unist-util-visit";

// 扫描片段中的所有残留 ** 字面量，将每对之间（含 **）替换为 strong 节段
function extractStrongFromText(text: string): Array<{ type: "text" | "strong"; value: string }> {
  const segments: Array<{ type: "text" | "strong"; value: string }> = [];
  const pattern = /\*\*([^*]+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    // 前面的文字
    if (match.index > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }
    // strong 内容（去掉前后的 **）
    segments.push({ type: "strong", value: match[1] });
    lastIndex = match.index + match[0].length;
  }
  // 剩余文字
  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }
  return segments;
}

export default function remarkFixBold() {
  return (tree: any) => {
    visit(tree, "text", (node: any, index: number | undefined, parent: any) => {
      if (!node.value || typeof node.value !== "string") return;
      // 只处理包含 ** 且 remark-gfm 未能解析的节点
      if (!node.value.includes("**")) return;

      const value: string = node.value;
      if (!/\*\*[^*]+?\*\*/.test(value)) return;

      const segments = extractStrongFromText(value);
      if (segments.length <= 1) return;

      const children = segments.map((seg) => {
        if (seg.type === "text") {
          return { type: "text", value: seg.value };
        }
        return {
          type: "strong",
          children: [{ type: "text", value: seg.value }],
        };
      });

      // unist-util-visit v5: index can be undefined, check parent
      if (parent && typeof index === "number") {
        parent.children.splice(index, 1, ...children);
      }
      // 如果 index 是 undefined，尝试找到节点位置
      else if (parent) {
        const pos = parent.children.indexOf(node);
        if (pos !== -1) {
          parent.children.splice(pos, 1, ...children);
        }
      }
    });
  };
}
