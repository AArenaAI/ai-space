"use client";

import { useRef, useState, useCallback, useEffect, Suspense } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Grid,
  GizmoHelper,
  GizmoViewport,
  OrbitControls,
  TransformControls,
  PerspectiveCamera,
  Environment,
  ContactShadows,
  Box,
  Capsule,
  Text,
  Html,
  useTexture,
  Line,
} from "@react-three/drei";
import * as THREE from "three";
import { cn } from "@/lib/utils";
import {
  Camera,
  Move,
  RotateCw,
  Maximize2,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Copy,
  Video,
  ImageIcon,
  Grid3X3,
  Layers,
  X,
} from "lucide-react";
import type { DirectorBlock, CharacterBlock, SceneBlock } from "./types";

// ===== 3D 场景组件 =====

function SceneGrid({ visible = true }: { visible?: boolean }) {
  if (!visible) return null;
  return (
    <>
      <Grid
        position={[0, -0.01, 0]}
        args={[20, 20]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#6b7280"
        sectionSize={5}
        sectionThickness={1}
        sectionColor="#374151"
        fadeDistance={25}
        fadeStrength={1}
        infiniteGrid
      />
      <axesHelper args={[5]} />
    </>
  );
}

function Character3D({
  char,
  asset,
  isSelected,
  onSelect,
  onUpdate,
}: {
  char: CharacterBlock;
  asset?: { name: string; color?: string };
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<CharacterBlock>) => void;
}) {
  const meshRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);

  // 将归一化坐标转换为 3D 空间坐标
  const x = (char.x - 0.5) * 10; // -5 到 5
  const z = (char.y - 0.5) * 10; // -5 到 5（Y 在 2D 中对应 Z 在 3D）
  const y = char.heightRatio * 2; // 高度

  const color = asset?.color || (isSelected ? "#6366f1" : "#4b5563");

  return (
    <group
      ref={meshRef}
      position={[x, y / 2, z]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      {/* 角色胶囊体 */}
      <Capsule args={[0.3, y - 0.6, 4, 8]}>
        <meshStandardMaterial
          color={hovered || isSelected ? "#6366f1" : color}
          roughness={0.3}
          metalness={0.1}
        />
      </Capsule>

      {/* 朝向指示器 */}
      <group rotation={[0, getFacingAngle(char.facing), 0]}>
        <Line
          points={[
            [0, 0, 0],
            [0, 0, 1.2],
          ]}
          color={isSelected ? "#6366f1" : "#9ca3af"}
          lineWidth={2}
        />
        {/* 箭头 */}
        <mesh position={[0, 0, 1.2]} rotation={[0, 0, Math.PI / 2]}>
          <coneGeometry args={[0.1, 0.2, 4]} />
          <meshStandardMaterial color={isSelected ? "#6366f1" : "#9ca3af"} />
        </mesh>
      </group>

      {/* 角色标签 */}
      <Html position={[0, y / 2 + 0.5, 0]} center distanceFactor={10}>
        <div
          className={cn(
            "whitespace-nowrap rounded px-2 py-1 text-xs font-medium",
            isSelected
              ? "bg-brand text-white"
              : "bg-surface-card text-text-secondary"
          )}
        >
          {asset?.name || "未命名"}
          {!char.visible && " (隐藏)"}
        </div>
      </Html>

      {/* 选中时显示变换控制 */}
      {isSelected && (
        <TransformControls
          mode="translate"
          onObjectChange={() => {
            if (meshRef.current) {
              const pos = meshRef.current.position;
              onUpdate({
                x: pos.x / 10 + 0.5,
                y: pos.z / 10 + 0.5, // Z 对应 2D Y
              });
            }
          }}
        />
      )}
    </group>
  );
}

function getFacingAngle(facing: string): number {
  const map: Record<string, number> = {
    front: 0,
    "front-right": -Math.PI / 4,
    right: -Math.PI / 2,
    "back-right": -Math.PI * 3 / 4,
    back: Math.PI,
    "back-left": Math.PI * 3 / 4,
    left: Math.PI / 2,
    "front-left": Math.PI / 4,
  };
  return map[facing] || 0;
}

function Camera3D({
  cameraId,
  position,
  target,
  isSelected,
  onSelect,
  onUpdate,
  preview,
}: {
  cameraId: string;
  position: [number, number, number];
  target: [number, number, number];
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (pos: [number, number, number], target: [number, number, number]) => void;
  preview?: string;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);

  return (
    <group
      ref={groupRef}
      position={position}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      {/* 相机模型 */}
      <Box args={[0.4, 0.3, 0.5]}>
        <meshStandardMaterial
          color={hovered || isSelected ? "#f59e0b" : "#6b7280"}
          roughness={0.2}
          metalness={0.8}
        />
      </Box>
      {/* 镜头 */}
      <mesh position={[0, 0, 0.3]}>
        <cylinderGeometry args={[0.15, 0.2, 0.2, 16]} />
        <meshStandardMaterial color="#1f2937" metalness={0.9} roughness={0.1} />
      </mesh>

      {/* 视锥线 */}
      <Line
        points={[
          [0, 0, 0],
          [target[0] - position[0], target[1] - position[1], target[2] - position[2]],
        ]}
        color={isSelected ? "#f59e0b" : "#6b7280"}
        lineWidth={1}
        dashed
        dashSize={0.1}
        gapSize={0.05}
      />

      {/* 相机标签 */}
      <Html position={[0, 0.5, 0]} center distanceFactor={10}>
        <div
          className={cn(
            "whitespace-nowrap rounded px-2 py-1 text-xs font-medium",
            isSelected
              ? "bg-amber-500 text-white"
              : "bg-surface-card text-text-secondary"
          )}
        >
          {cameraId}
        </div>
      </Html>

      {isSelected && (
        <TransformControls
          mode="translate"
          onObjectChange={() => {
            if (groupRef.current) {
              const pos = groupRef.current.position;
              onUpdate([pos.x, pos.y, pos.z], target);
            }
          }}
        />
      )}
    </group>
  );
}

function Scene3D({
  directorBlock,
  selectedCharId,
  selectedCameraId,
  onSelectChar,
  onSelectCamera,
  onUpdateChar,
  onUpdateCamera,
  characterAssets,
  cameras,
}: {
  directorBlock: DirectorBlock;
  selectedCharId?: string;
  selectedCameraId?: string;
  onSelectChar: (id: string) => void;
  onSelectCamera: (id: string) => void;
  onUpdateChar: (id: string, updates: Partial<CharacterBlock>) => void;
  onUpdateCamera: (id: string, pos: [number, number, number], target: [number, number, number]) => void;
  characterAssets: Array<{ id: string; name: string; color?: string }>;
  cameras: Array<{ id: string; position: [number, number, number]; target: [number, number, number] }>;
}) {
  return (
    <>
      <SceneGrid visible={directorBlock.sceneBlock?.showGrid !== false} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 10, 5]} intensity={1} castShadow />
      <pointLight position={[-5, 5, -5]} intensity={0.5} />

      {/* 角色 */}
      {directorBlock.characters
        .filter((c) => c.visible)
        .map((char) => (
          <Character3D
            key={char.id}
            char={char}
            asset={characterAssets.find((a) => a.id === char.semanticAssetId)}
            isSelected={char.id === selectedCharId}
            onSelect={() => onSelectChar(char.id)}
            onUpdate={(updates) => onUpdateChar(char.id, updates)}
          />
        ))}

      {/* 机位 */}
      {cameras.map((cam) => (
        <Camera3D
          key={cam.id}
          cameraId={cam.id}
          position={cam.position}
          target={cam.target}
          isSelected={cam.id === selectedCameraId}
          onSelect={() => onSelectCamera(cam.id)}
          onUpdate={(pos, target) => onUpdateCamera(cam.id, pos, target)}
        />
      ))}

      {/* 固定元素（简化表示） */}
      {directorBlock.sceneBlock?.fixedElements?.map((el) => {
        const posMap: Record<string, [number, number, number]> = {
          left: [-4, 0, 0],
          right: [4, 0, 0],
          front: [0, 0, 4],
          back: [0, 0, -4],
          center: [0, 0, 0],
          "left-front": [-3, 0, 3],
          "right-front": [3, 0, 3],
          "left-back": [-3, 0, -3],
          "right-back": [3, 0, -3],
        };
        const pos = posMap[el.position] || [0, 0, 0];
        return (
          <group key={el.id} position={pos}>
            <Box args={[1, 1, 1]}>
              <meshStandardMaterial
                color="#f59e0b"
                transparent
                opacity={0.3}
                wireframe
              />
            </Box>
            <Html position={[0, 0.8, 0]} center distanceFactor={10}>
              <div className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                {el.name}
              </div>
            </Html>
          </group>
        );
      })}

      <ContactShadows
        position={[0, -0.01, 0]}
        opacity={0.4}
        scale={20}
        blur={2}
        far={10}
      />
    </>
  );
}

// ===== 主组件 =====

export type Camera3DData = {
  id: string;
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
  near: number;
  far: number;
  shotType?: string;
  cameraMove?: string;
};

export type Director3DPanelProps = {
  directorBlock: DirectorBlock;
  characterAssets: Array<{ id: string; name: string; color?: string }>;
  cameras: Camera3DData[];
  onUpdateDirectorBlock: (block: DirectorBlock) => void;
  onUpdateCameras: (cameras: Camera3DData[]) => void;
  onClose: () => void;
  onGenerateShot?: (cameraId: string) => void;
};

export default function Director3DPanel({
  directorBlock,
  characterAssets,
  cameras,
  onUpdateDirectorBlock,
  onUpdateCameras,
  onClose,
  onGenerateShot,
}: Director3DPanelProps) {
  const [selectedCharId, setSelectedCharId] = useState<string | undefined>();
  const [selectedCameraId, setSelectedCameraId] = useState<string | undefined>(
    cameras[0]?.id
  );
  const [activeTab, setActiveTab] = useState<"scene" | "characters" | "cameras">(
    "characters"
  );
  const [showCameraPreview, setShowCameraPreview] = useState(true);
  const [transformMode, setTransformMode] = useState<"translate" | "rotate" | "scale">(
    "translate"
  );
  const [showGrid, setShowGrid] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [groundSnap, setGroundSnap] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  const updateChar = useCallback(
    (id: string, updates: Partial<CharacterBlock>) => {
      const newChars = directorBlock.characters.map((c) =>
        c.id === id ? { ...c, ...updates } : c
      );
      onUpdateDirectorBlock({
        ...directorBlock,
        characters: newChars,
      });
    },
    [directorBlock, onUpdateDirectorBlock]
  );

  const updateCamera = useCallback(
    (id: string, position: [number, number, number], target: [number, number, number]) => {
      const newCameras = cameras.map((c) =>
        c.id === id ? { ...c, position, target } : c
      );
      onUpdateCameras(newCameras);
    },
    [cameras, onUpdateCameras]
  );

  const addCamera = useCallback(() => {
    const newId = `机位${cameras.length + 1}`;
    const newCamera: Camera3DData = {
      id: newId,
      position: [3, 2, 5],
      target: [0, 1, 0],
      fov: 50,
      near: 0.1,
      far: 100,
    };
    onUpdateCameras([...cameras, newCamera]);
    setSelectedCameraId(newId);
  }, [cameras, onUpdateCameras]);

  const deleteCamera = useCallback(
    (id: string) => {
      if (cameras.length <= 1) return;
      const newCameras = cameras.filter((c) => c.id !== id);
      onUpdateCameras(newCameras);
      if (selectedCameraId === id) {
        setSelectedCameraId(newCameras[0]?.id);
      }
    },
    [cameras, onUpdateCameras, selectedCameraId]
  );

  const selectedChar = directorBlock.characters.find((c) => c.id === selectedCharId);
  const selectedCamera = cameras.find((c) => c.id === selectedCameraId);

  return (
    <div className="fixed inset-0 z-50 flex bg-black/80 backdrop-blur-sm">
      {/* 左侧边栏 - 场景层级 */}
      <div className="flex w-64 flex-col border-r border-surface-border bg-surface-elevated">
        {/* 标题 */}
        <div className="flex items-center justify-between border-b border-surface-border p-3">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-brand" />
            <span className="text-sm font-semibold text-text-primary">3D 导演台</span>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 hover:bg-surface-card"
          >
            <X className="h-4 w-4 text-text-tertiary" />
          </button>
        </div>

        {/* Tab 切换 */}
        <div className="flex border-b border-surface-border">
          {(["scene", "characters", "cameras"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "flex-1 py-2 text-xs font-medium transition-colors",
                activeTab === tab
                  ? "border-b-2 border-brand text-brand"
                  : "text-text-tertiary hover:text-text-secondary"
              )}
            >
              {tab === "scene" && "场景"}
              {tab === "characters" && "角色"}
              {tab === "cameras" && "机位"}
            </button>
          ))}
        </div>

        {/* 层级列表 */}
        <div className="flex-1 overflow-y-auto p-3">
          {activeTab === "scene" && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-text-secondary">
                <Grid3X3 className="h-4 w-4" />
                <span>场景设置</span>
              </div>
              <div className="space-y-3 rounded-lg border border-surface-border bg-surface-card p-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={showGrid}
                    onChange={(e) => setShowGrid(e.target.checked)}
                    className="rounded border-surface-border"
                  />
                  <span className="text-xs text-text-secondary">显示网格</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={showLabels}
                    onChange={(e) => setShowLabels(e.target.checked)}
                    className="rounded border-surface-border"
                  />
                  <span className="text-xs text-text-secondary">角色标签</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={groundSnap}
                    onChange={(e) => setGroundSnap(e.target.checked)}
                    className="rounded border-surface-border"
                  />
                  <span className="text-xs text-text-secondary">地面吸附</span>
                </label>
                <div>
                  <span className="text-xs text-text-tertiary">背景颜色</span>
                  <input
                    type="color"
                    value={directorBlock.sceneBlock?.backgroundColor || "#060608"}
                    onChange={(e) =>
                      onUpdateDirectorBlock({
                        ...directorBlock,
                        sceneBlock: {
                          ...directorBlock.sceneBlock,
                          backgroundColor: e.target.value,
                        } as SceneBlock,
                      })
                    }
                    className="mt-1 h-8 w-full rounded"
                  />
                </div>
              </div>

              {/* 固定元素列表 */}
              <div className="mt-4">
                <div className="mb-2 text-xs font-medium text-text-tertiary">
                  固定元素
                </div>
                {directorBlock.sceneBlock?.fixedElements?.map((el) => (
                  <div
                    key={el.id}
                    className="flex items-center gap-2 rounded py-1 text-xs text-text-secondary"
                  >
                    <Box className="h-3 w-3 text-amber-500" />
                    <span>{el.name}</span>
                    <span className="text-text-tertiary">({el.position})</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "characters" && (
            <div className="space-y-1">
              {directorBlock.characters.map((char) => {
                const asset = characterAssets.find((a) => a.id === char.semanticAssetId);
                return (
                  <div
                    key={char.id}
                    onClick={() => setSelectedCharId(char.id)}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-colors",
                      char.id === selectedCharId
                        ? "bg-brand/10"
                        : "hover:bg-surface-card"
                    )}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        updateChar(char.id, { visible: !char.visible });
                      }}
                      className="text-text-tertiary"
                    >
                      {char.visible ? (
                        <Eye className="h-3 w-3" />
                      ) : (
                        <EyeOff className="h-3 w-3" />
                      )}
                    </button>
                    <div
                      className={cn(
                        "h-2 w-2 rounded-full",
                        char.id === selectedCharId ? "bg-brand" : "bg-surface-border"
                      )}
                    />
                    <span className="flex-1 text-xs text-text-secondary">
                      {asset?.name || "未命名"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === "cameras" && (
            <div className="space-y-1">
              <button
                onClick={addCamera}
                className="mb-2 flex w-full items-center gap-2 rounded-lg border border-dashed border-surface-border px-2 py-1.5 text-xs text-text-tertiary hover:border-brand/40 hover:text-brand"
              >
                <Plus className="h-3 w-3" />
                添加机位
              </button>
              {cameras.map((cam) => (
                <div
                  key={cam.id}
                  onClick={() => setSelectedCameraId(cam.id)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-colors",
                    cam.id === selectedCameraId
                      ? "bg-amber-500/10"
                      : "hover:bg-surface-card"
                  )}
                >
                  <Camera className="h-3 w-3 text-amber-500" />
                  <span className="flex-1 text-xs text-text-secondary">{cam.id}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteCamera(cam.id);
                    }}
                    className="text-text-tertiary hover:text-red-500"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 中间 - 3D 视口 */}
      <div className="relative flex-1">
        <Canvas
          shadows
          camera={{ position: [5, 5, 5], fov: 50 }}
          style={{ background: directorBlock.sceneBlock?.backgroundColor || "#060608" }}
        >
          <Suspense fallback={null}>
            <Scene3D
              directorBlock={{
                ...directorBlock,
                sceneBlock: {
                  ...directorBlock.sceneBlock,
                  showGrid,
                } as SceneBlock,
              }}
              selectedCharId={selectedCharId}
              selectedCameraId={selectedCameraId}
              onSelectChar={setSelectedCharId}
              onSelectCamera={setSelectedCameraId}
              onUpdateChar={updateChar}
              onUpdateCamera={updateCamera}
              characterAssets={characterAssets}
              cameras={cameras}
            />
            <OrbitControls makeDefault />
            <GizmoHelper alignment="top-right" margin={[80, 80]}>
              <GizmoViewport
                axisColors={["#ef4444", "#22c55e", "#3b82f6"]}
                labelColor="white"
              />
            </GizmoHelper>
          </Suspense>
        </Canvas>

        {/* 底部工具栏 */}
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-surface-border bg-surface-elevated/90 p-1 backdrop-blur">
          <button
            onClick={() => setTransformMode("translate")}
            className={cn(
              "rounded p-2 transition-colors",
              transformMode === "translate" ? "bg-brand/20 text-brand" : "text-text-tertiary hover:text-text-secondary"
            )}
            title="移动"
          >
            <Move className="h-4 w-4" />
          </button>
          <button
            onClick={() => setTransformMode("rotate")}
            className={cn(
              "rounded p-2 transition-colors",
              transformMode === "rotate" ? "bg-brand/20 text-brand" : "text-text-tertiary hover:text-text-secondary"
            )}
            title="旋转"
          >
            <RotateCw className="h-4 w-4" />
          </button>
          <button
            onClick={() => setTransformMode("scale")}
            className={cn(
              "rounded p-2 transition-colors",
              transformMode === "scale" ? "bg-brand/20 text-brand" : "text-text-tertiary hover:text-text-secondary"
            )}
            title="缩放"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
          <div className="mx-1 h-4 w-px bg-surface-border" />
          <button
            onClick={() => setShowGrid(!showGrid)}
            className={cn(
              "rounded p-2 transition-colors",
              showGrid ? "bg-brand/20 text-brand" : "text-text-tertiary"
            )}
            title="网格"
          >
            <Grid3X3 className="h-4 w-4" />
          </button>
        </div>

        {/* 机位预览窗口 */}
        {showCameraPreview && selectedCamera && (
          <div className="absolute right-4 top-4 w-48 overflow-hidden rounded-lg border border-surface-border bg-surface-elevated">
            <div className="flex items-center justify-between border-b border-surface-border px-2 py-1">
              <span className="text-[10px] font-medium text-text-secondary">
                {selectedCamera.id} 预览
              </span>
              <button
                onClick={() => setShowCameraPreview(false)}
                className="text-text-tertiary hover:text-text-secondary"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <div className="relative aspect-video bg-black">
              {/* 这里可以渲染机位实际画面 */}
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[10px] text-text-tertiary">
                  FOV: {selectedCamera.fov}°
                </span>
              </div>
              {/* 取景框 */}
              <div className="absolute inset-2 border border-white/20">
                <div className="absolute left-1/3 top-0 h-full w-px bg-white/10" />
                <div className="absolute right-1/3 top-0 h-full w-px bg-white/10" />
                <div className="absolute left-0 top-1/3 h-px w-full bg-white/10" />
                <div className="absolute bottom-1/3 left-0 h-px w-full bg-white/10" />
              </div>
            </div>
            <div className="space-y-1 p-2">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-text-tertiary">位置</span>
                <span className="text-text-secondary">
                  {selectedCamera.position.map((v) => v.toFixed(1)).join(", ")}
                </span>
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-text-tertiary">目标</span>
                <span className="text-text-secondary">
                  {selectedCamera.target.map((v) => v.toFixed(1)).join(", ")}
                </span>
              </div>
              <button
                onClick={() => onGenerateShot?.(selectedCamera.id)}
                className="mt-1 flex w-full items-center justify-center gap-1 rounded bg-brand py-1 text-[10px] font-medium text-white hover:bg-brand-hover"
              >
                <Video className="h-3 w-3" />
                生成视频
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 右侧边栏 - 属性面板 */}
      <div className="w-72 border-l border-surface-border bg-surface-elevated">
        <div className="border-b border-surface-border p-3">
          <span className="text-sm font-semibold text-text-primary">属性</span>
        </div>

        <div className="p-3">
          {selectedChar && (
            <div className="space-y-3">
              <div className="text-xs font-medium text-text-secondary">
                角色: {characterAssets.find((a) => a.id === selectedChar.semanticAssetId)?.name}
              </div>

              {/* 位置 */}
              <div className="space-y-1">
                <span className="text-[10px] text-text-tertiary">位置</span>
                <div className="grid grid-cols-3 gap-1">
                  {["x", "y", "z"].map((axis) => (
                    <div key={axis} className="flex items-center gap-1">
                      <span className="text-[10px] text-text-tertiary">{axis.toUpperCase()}</span>
                      <input
                        type="number"
                        step={0.1}
                        value={
                          axis === "x"
                            ? (selectedChar.x - 0.5) * 10
                            : axis === "z"
                            ? (selectedChar.y - 0.5) * 10
                            : selectedChar.heightRatio * 2
                        }
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          if (axis === "x") {
                            updateChar(selectedChar.id, { x: val / 10 + 0.5 });
                          } else if (axis === "z") {
                            updateChar(selectedChar.id, { y: val / 10 + 0.5 });
                          } else {
                            // y axis = height
                          }
                        }}
                        className="w-full rounded border border-surface-border bg-surface-card px-1 py-0.5 text-[10px] text-text-primary"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* 朝向 */}
              <div>
                <span className="text-[10px] text-text-tertiary">朝向</span>
                <select
                  value={selectedChar.facing}
                  onChange={(e) =>
                    updateChar(selectedChar.id, { facing: e.target.value as any })
                  }
                  className="mt-1 w-full rounded border border-surface-border bg-surface-card px-2 py-1 text-xs text-text-primary"
                >
                  <option value="front">正面</option>
                  <option value="front-right">右前</option>
                  <option value="right">右侧</option>
                  <option value="back-right">右后</option>
                  <option value="back">背面</option>
                  <option value="back-left">左后</option>
                  <option value="left">左侧</option>
                  <option value="front-left">左前</option>
                </select>
              </div>

              {/* 高度 */}
              <div>
                <span className="text-[10px] text-text-tertiary">高度占比</span>
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={selectedChar.heightRatio}
                  onChange={(e) =>
                    updateChar(selectedChar.id, { heightRatio: parseFloat(e.target.value) })
                  }
                  className="mt-1 w-full"
                />
                <div className="text-right text-[10px] text-text-tertiary">
                  {Math.round(selectedChar.heightRatio * 100)}%
                </div>
              </div>

              {/* 姿势 */}
              <div>
                <span className="text-[10px] text-text-tertiary">姿势</span>
                <select
                  value={selectedChar.pose}
                  onChange={(e) =>
                    updateChar(selectedChar.id, { pose: e.target.value as any })
                  }
                  className="mt-1 w-full rounded border border-surface-border bg-surface-card px-2 py-1 text-xs text-text-primary"
                >
                  <option value="standing">站立</option>
                  <option value="sitting">坐姿</option>
                  <option value="walking">行走</option>
                  <option value="running">奔跑</option>
                  <option value="fighting">战斗</option>
                  <option value="kneeling">跪姿</option>
                  <option value="lying">躺卧</option>
                  <option value="jumping">跳跃</option>
                  <option value="crouching">蹲伏</option>
                  <option value="custom">自定义</option>
                </select>
              </div>
            </div>
          )}

          {selectedCamera && !selectedChar && (
            <div className="space-y-3">
              <div className="text-xs font-medium text-text-secondary">
                {selectedCamera.id}
              </div>

              {/* 位置 */}
              <div className="space-y-1">
                <span className="text-[10px] text-text-tertiary">位置</span>
                <div className="grid grid-cols-3 gap-1">
                  {["x", "y", "z"].map((axis, i) => (
                    <div key={axis} className="flex items-center gap-1">
                      <span className="text-[10px] text-text-tertiary">{axis.toUpperCase()}</span>
                      <input
                        type="number"
                        step={0.1}
                        value={selectedCamera.position[i]}
                        onChange={(e) => {
                          const newPos = [...selectedCamera.position] as [number, number, number];
                          newPos[i] = parseFloat(e.target.value);
                          updateCamera(selectedCamera.id, newPos, selectedCamera.target);
                        }}
                        className="w-full rounded border border-surface-border bg-surface-card px-1 py-0.5 text-[10px] text-text-primary"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* 目标 */}
              <div className="space-y-1">
                <span className="text-[10px] text-text-tertiary">目标</span>
                <div className="grid grid-cols-3 gap-1">
                  {["x", "y", "z"].map((axis, i) => (
                    <div key={axis} className="flex items-center gap-1">
                      <span className="text-[10px] text-text-tertiary">{axis.toUpperCase()}</span>
                      <input
                        type="number"
                        step={0.1}
                        value={selectedCamera.target[i]}
                        onChange={(e) => {
                          const newTarget = [...selectedCamera.target] as [number, number, number];
                          newTarget[i] = parseFloat(e.target.value);
                          updateCamera(selectedCamera.id, selectedCamera.position, newTarget);
                        }}
                        className="w-full rounded border border-surface-border bg-surface-card px-1 py-0.5 text-[10px] text-text-primary"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* FOV */}
              <div>
                <span className="text-[10px] text-text-tertiary">FOV (视角)</span>
                <input
                  type="range"
                  min={20}
                  max={120}
                  step={1}
                  value={selectedCamera.fov}
                  onChange={(e) => {
                    const newCameras = cameras.map((c) =>
                      c.id === selectedCamera.id
                        ? { ...c, fov: parseInt(e.target.value) }
                        : c
                    );
                    onUpdateCameras(newCameras);
                  }}
                  className="mt-1 w-full"
                />
                <div className="text-right text-[10px] text-text-tertiary">
                  {selectedCamera.fov}°
                </div>
              </div>

              {/* 景别 */}
              <div>
                <span className="text-[10px] text-text-tertiary">景别</span>
                <select
                  value={selectedCamera.shotType || "medium"}
                  onChange={(e) => {
                    const newCameras = cameras.map((c) =>
                      c.id === selectedCamera.id
                        ? { ...c, shotType: e.target.value }
                        : c
                    );
                    onUpdateCameras(newCameras);
                  }}
                  className="mt-1 w-full rounded border border-surface-border bg-surface-card px-2 py-1 text-xs text-text-primary"
                >
                  <option value="extreme_long">大远景</option>
                  <option value="long">远景</option>
                  <option value="full">全景</option>
                  <option value="medium">中景</option>
                  <option value="close">近景</option>
                  <option value="extreme_close">特写</option>
                </select>
              </div>

              {/* 运镜 */}
              <div>
                <span className="text-[10px] text-text-tertiary">运镜</span>
                <select
                  value={selectedCamera.cameraMove || "static"}
                  onChange={(e) => {
                    const newCameras = cameras.map((c) =>
                      c.id === selectedCamera.id
                        ? { ...c, cameraMove: e.target.value }
                        : c
                    );
                    onUpdateCameras(newCameras);
                  }}
                  className="mt-1 w-full rounded border border-surface-border bg-surface-card px-2 py-1 text-xs text-text-primary"
                >
                  <option value="static">固定</option>
                  <option value="push">推</option>
                  <option value="pull">拉</option>
                  <option value="pan">摇</option>
                  <option value="tilt">移</option>
                  <option value="follow">跟</option>
                  <option value="crane">升降</option>
                  <option value="handheld">手持</option>
                  <option value="orbit">环绕</option>
                </select>
              </div>
            </div>
          )}

          {!selectedChar && !selectedCamera && (
            <div className="text-center text-xs text-text-tertiary">
              选择角色或机位以编辑属性
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
