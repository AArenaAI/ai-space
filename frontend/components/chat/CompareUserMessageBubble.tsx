"use client";

import { memo } from "react";
import type { Message } from "@/lib/chatTypes";
import UserMessageContent from "./UserMessageContent";

type CompareUserMessageBubbleProps = {
  message: Message;
  imageLoadFailedLabel: string;
};

function CompareUserMessageBubble({ message, imageLoadFailedLabel }: CompareUserMessageBubbleProps) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[88%] rounded-2xl rounded-br-sm bg-[#EFF6FF] px-4 py-3 text-text-primary shadow-sm dark:bg-[#1E293B]">
        <UserMessageContent message={message} imageLoadFailedLabel={imageLoadFailedLabel} />
      </div>
    </div>
  );
}

export default memo(CompareUserMessageBubble);
