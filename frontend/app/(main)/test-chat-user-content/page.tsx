import dynamic from "next/dynamic";

const ChatUserContentFixture = dynamic(() => import("@/components/chat/ChatUserContentFixture"), {
  ssr: false,
});

export default function TestChatUserContentPage() {
  return <ChatUserContentFixture />;
}
