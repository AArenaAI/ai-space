import AppSidebar from "@/components/sidebar/AppSidebar";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      {/* 侧边栏 - 隐藏在移动端 */}
      <div className="hidden md:flex">
        <AppSidebar />
      </div>

      {/* 主内容区 */}
      <main className="flex-1 min-w-0">
        {children}
      </main>
    </div>
  );
}
