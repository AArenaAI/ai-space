"use client";

import MarkdownTokenRenderer from "@/components/chat/markdown/MarkdownTokenRenderer";

const fixtureContent = `# Token Markdown Fixture

This paragraph has **bold text**, *italic text*, ~~deleted text~~, \`inline code\`, and [a link](https://example.com).

- first bullet
- [x] checked task
- [ ] unchecked task

> quoted line

| Name | Value |
| --- | --- |
| Alpha | **One** |

\`\`\`ts
export function hello() {
  return "ok";
}
\`\`\`
`;

export default function TestChatMarkdownTokenPage() {
  return (
    <main className="p-8">
      <div data-testid="markdown-token-fixture" className="prose max-w-none">
        <MarkdownTokenRenderer content={fixtureContent} compactPreview />
      </div>
    </main>
  );
}
