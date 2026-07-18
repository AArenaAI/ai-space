import dynamic from "next/dynamic";

const ChatLocalSendSwitchRestoreFixture = dynamic(
  () => import("@/components/chat/ChatLocalSendSwitchRestoreFixture"),
  { ssr: false }
);

export default function TestChatLocalSendSwitchRestorePage() {
  return <ChatLocalSendSwitchRestoreFixture />;
}
