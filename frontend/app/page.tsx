import AppSidebar from "@/components/sidebar/AppSidebar";
import ChatWrapper from "@/components/chat/ChatWrapper";
import MobileNav from "@/components/mobile/MobileNav";

export default function Home() {
  return (
    <div className="flex flex-col h-screen bg-surface overflow-hidden">
      {/* 移动端导航栏 */}
      <MobileNav />

      {/* 主区域：侧边栏 + 聊天 */}
      <div className="flex flex-1 min-h-0">
        <div className="hidden md:flex">
          <AppSidebar />
        </div>
        <main className="flex-1 min-w-0">
          <ChatWrapper />
        </main>
      </div>
    </div>
  );
}
