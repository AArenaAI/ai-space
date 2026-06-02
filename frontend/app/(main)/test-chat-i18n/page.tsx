import dynamic from "next/dynamic";

const ChatI18nResidueFixture = dynamic(() => import("@/components/chat/ChatI18nResidueFixture"), {
  ssr: false,
});

export default function TestChatI18nPage() {
  return <ChatI18nResidueFixture />;
}
