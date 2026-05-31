import dynamic from "next/dynamic";

const ChatTextSelectionFixture = dynamic(() => import("@/components/chat/ChatTextSelectionFixture"), {
  ssr: false,
});

export default function TestChatTextSelectionPage() {
  return <ChatTextSelectionFixture />;
}
