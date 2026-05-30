import { useEffect } from "react";

export type UseChatRuntimeCleanupOptions = {
  stopAllBackgroundPollers: () => void;
  stopAllTaskStreams: () => void;
};

export function useChatRuntimeCleanup({
  stopAllBackgroundPollers,
  stopAllTaskStreams,
}: UseChatRuntimeCleanupOptions) {
  useEffect(() => {
    return () => {
      stopAllBackgroundPollers();
      stopAllTaskStreams();
    };
  }, [stopAllBackgroundPollers, stopAllTaskStreams]);
}
