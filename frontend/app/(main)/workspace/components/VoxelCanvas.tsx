"use client";

import { Suspense, useState, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import VoxelScene from "./VoxelScene";

function Loader() {
  return (
    <div className="flex h-full items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
    </div>
  );
}

export default function VoxelCanvas({ onHouseClick }: { onHouseClick: (key: string) => void }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-[32px] border border-surface-border bg-surface-elevated/60">
        <Loader />
      </div>
    );
  }

  return (
      <div className="relative h-full w-full overflow-hidden rounded-[32px] border border-surface-border bg-[#1E1E3A]">
      <Canvas
        orthographic
        camera={{
          position: [20, 20, 20],
          zoom: 26,
          near: 0.1,
          far: 100,
        }}
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false }}
        style={{ width: "100%", height: "100%" }}
      >
        <Suspense fallback={null}>
          <VoxelScene onHouseClick={onHouseClick} />
        </Suspense>
      </Canvas>

      {/* 角落说明 */}
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-surface-border/30 bg-black/30 px-2.5 py-1.5 text-[10px] text-white/50 backdrop-blur-sm">
        拖拽旋转 · 滚轮缩放 · 点击房子打开功能
      </div>
    </div>
  );
}
