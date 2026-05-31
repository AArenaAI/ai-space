"use client";

export default function CompareEmptySlot({ isSingleChat }: { isSingleChat: boolean }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="rounded-xl border border-dashed border-surface-border bg-surface-elevated/40 px-3 py-2 text-center text-xs text-text-tertiary">
        {isSingleChat ? "单聊模式的对话" : "当前模型未参与本轮"}
      </div>
    </div>
  );
}
