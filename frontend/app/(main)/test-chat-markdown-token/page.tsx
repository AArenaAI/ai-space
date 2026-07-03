"use client";

import MarkdownTokenRenderer from "@/components/chat/markdown/MarkdownTokenRenderer";

const fixtureContent = `# Token Markdown Fixture

## 二级标题

### 三级标题

This paragraph has **paragraph bold**, *italic text*, ~~deleted text~~, \`inline code\`, and [paragraph link](https://example.com/paragraph).

- first bullet
- **list bold** with [list link](https://example.com/list)
- nested parent
  - nested child with **nested bold**
- [x] checked task
- [ ] unchecked task

1. ordered first with **ordered bold**
2. ordered second with [ordered link](https://example.com/ordered)

> quoted line with **quote bold** and [quote link](https://example.com/quote)

| Name | Value | Note |
| --- | --- | --- |
| Alpha | **table bold** | [table link](https://example.com/table) |
| Beta | \`table code\` | plain |

\`\`\`ts
export function hello() {
  return "ok";
}
\`\`\`

---

<span data-custom-html="true">inline html should be visible as text or sanitized output</span>

![Alt 文本](https://example.com/image.png)

Footnote marker[^note] and definition below.

[^note]: footnote content

Inline math $E=mc^2$ and block math:

$$
a^2 + b^2 = c^2
$$

\`\`\`mermaid
graph TD
  A --> B
\`\`\`

Long paragraph start. 这一段模拟较长中文回答，包含很多普通文本，目的是覆盖长文本下 token renderer 的稳定性。它应该保持段落结构稳定，不应该因为内容较长而退回原始 Markdown。第二句继续增加长度，第三句继续增加长度，第四句继续增加长度，第五句继续增加长度。`;

export default function TestChatMarkdownTokenPage() {
  return (
    <main className="p-8">
      <div data-testid="markdown-token-fixture" className="prose max-w-none">
        <MarkdownTokenRenderer content={fixtureContent} compactPreview />
      </div>
    </main>
  );
}
