"use client";

import { memo } from "react";
import type { Message } from "@/lib/chatTypes";
import UserMessageContent from "./UserMessageContent";

type CompareSharedPromptBlockProps = {
  message: Message;
  imageLoadFailedLabel: string;
};

function CompareSharedPromptBlock({ message, imageLoadFailedLabel }: CompareSharedPromptBlockProps) {
  return (
    <div className="rounded-2xl rounded-br-sm bg-surface-elevated px-4 py-3 text-text-primary shadow-sm">
      <UserMessageContent message={message} imageLoadFailedLabel={imageLoadFailedLabel} />
    </div>
  );
}

export default memo(CompareSharedPromptBlock);
