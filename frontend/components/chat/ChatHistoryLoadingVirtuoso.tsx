"use client";

import { memo, type Ref, type UIEvent } from "react";
import { Virtuoso, type Components, type VirtuosoHandle } from "react-virtuoso";

export type ChatHistoryLoadingVirtuosoProps<T> = {
  data: T[];
  virtuosoRef: Ref<VirtuosoHandle>;
  scrollerRef: (ref: Window | HTMLElement | null) => void;
  onScroll: (event: UIEvent<HTMLElement>) => void;
  components: Components<T>;
  computeItemKey: (index: number, item: T) => string;
  className?: string;
};

function ChatHistoryLoadingVirtuoso<T>({
  data,
  virtuosoRef,
  scrollerRef,
  onScroll,
  components,
  computeItemKey,
  className,
}: ChatHistoryLoadingVirtuosoProps<T>) {
  const content = (
    <Virtuoso
      style={{ height: "100%", overflowAnchor: "none" }}
      data={data}
      ref={virtuosoRef}
      scrollerRef={scrollerRef}
      followOutput={false}
      computeItemKey={computeItemKey}
      onScroll={onScroll}
      components={components}
      itemContent={() => null}
    />
  );

  if (!className) return content;
  return <div className={className}>{content}</div>;
}

export default memo(ChatHistoryLoadingVirtuoso) as typeof ChatHistoryLoadingVirtuoso;
