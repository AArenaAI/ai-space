"use client";

import { memo } from "react";

export type ChatCompareWelcomeColumnsProps = {
  compareModels: string[];
  greeting: string;
  prompt: string;
};

function ChatCompareWelcomeContent({ greeting, prompt }: { greeting: string; prompt: string }) {
  return (
    <div className="flex min-h-[360px] flex-col">
      <div className="flex-1 px-8 pb-10 pt-20">
        <h2 className="text-3xl font-semibold tracking-tight text-text-primary">{greeting}</h2>
        <p className="mt-3 text-xl font-medium text-text-primary">{prompt}</p>
      </div>
    </div>
  );
}

function ChatCompareWelcomeColumns({ compareModels, greeting, prompt }: ChatCompareWelcomeColumnsProps) {
  return (
    <div className="flex-1 overflow-hidden px-3 py-3">
      <div className="mx-auto flex h-full max-w-[1440px]">
        {compareModels.map((modelId, index) => (
          <div key={modelId || index} className="flex min-w-[320px] flex-1 flex-col border-r border-surface-border last:border-r-0">
            <ChatCompareWelcomeContent greeting={greeting} prompt={prompt} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default memo(ChatCompareWelcomeColumns);
