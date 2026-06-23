"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  Eye,
  EyeOff,
  GripVertical,
  Layers,
  Lightbulb,
  Maximize2,
  Minimize2,
  Move,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  User,
  X,
} from "lucide-react";
import type {
  CharacterBlock,
  DirectorBlock,
  Facing,
  FixedElement,
  LightSource,
  PosePreset,
  SceneBlock,
  SemanticAsset,
  StoredAsset,
} from "./types";
import {
  buildCameraPositionPrompt,
  buildCharacterPositionPrompt,
  buildSceneLockPrompt,
  createDefaultCharacterBlock,
  createDefaultDirectorBlock,
  createDefaultSceneBlock,
  getCharacterReferenceAssets,
  getSceneReferenceAssets,
} from "./directorBlock";

// ===== 常量 =====
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 450; // 16:9
const GRID_SIZE = 40;

const FACING_OPTIONS: { value: Facing; label: string; icon: string }[] = [
  { value: "front", label: "正面", icon: "↑" },
  { value: "front-left", label: "左前", icon: "↖" },
  { value: "front-right", label: "右前", icon: "↗" },
  { value: "left", label: "左侧", icon: "←" },
  { value: "right", label: "右侧", icon: "→" },
  { value: "back-left", label: "左后", icon: "↙" },
  { value: "back", label: "背面", icon: "↓" },
  { value: "back-right", label: "右后", icon: "↘" },
];

const POSE_OPTIONS: { value: PosePreset; label: string }[] = [
  { value: "standing", label: "站立" },
  { value: "sitting", label: "坐姿" },
  { value: "walking", label: "行走" },
  { value: "running", label: "奔跑" },
  { value: "fighting", label: "战斗姿态" },
  { value: "crouching", label: "蹲伏" },
  { value: "kneeling", label: "跪姿" },
  { value: "pointing", label: "指向" },
  { value: "holding", label: "手持" },
  { value: "custom", label: "自定义" },
];

const POSITION_OPTIONS = [
  "left", "right", "front", "back", "center",
  "left-front", "right-front", "left-back", "right-back", "custom",
] as const;

const LIGHT_INTENSITY_OPTIONS = ["dim", "normal", "bright", "harsh"] as const;

// ===== 辅助函数 =====
function snapToGrid(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// ===== 组件 =====

export type DirectorPanelProps = {
  directorBlock: DirectorBlock;
  semanticAssets: SemanticAsset[];
  assets: StoredAsset[];
  onChange: (block: DirectorBlock) => void;
  onClose?: () => void;
  shotTitle?: string;
  shotScene?: string;
};

export default function DirectorPanel({
  directorBlock,
  semanticAssets,
  assets,
  onChange,
  onClose,
  shotTitle,
  shotScene,
}: DirectorPanelProps) {
  const [activeTab, setActiveTab] = useState<"canvas" | "scene" | "preview">("canvas");
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const [draggingCharId, setDraggingCharId] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const canvasRef = useRef<HTMLDivElement>(null);

  const sceneAssets = semanticAssets.filter((a) => a.kind === "scene");
  const characterAssets = semanticAssets.filter((a) => a.kind === "character");
  const sceneImages = getSceneReferenceAssets(directorBlock, assets);

  // ===== 场景操作 =====
  const updateScene = useCallback(
    (patch: Partial<SceneBlock>) => {
      onChange({
        ...directorBlock,
        sceneBlock: { ...directorBlock.sceneBlock, ...patch },
      });
    },
    [directorBlock, onChange]
  );

  const addFixedElement = useCallback(() => {
    const newEl: FixedElement = {
      id: `el-${Date.now()}`,
      name: "新元素",
      position: "center",
      size: "1m x 1m",
      description: "",
      fixed: true,
    };
    updateScene({
      fixedElements: [...directorBlock.sceneBlock.fixedElements, newEl],
    });
  }, [directorBlock.sceneBlock.fixedElements, updateScene]);

  const removeFixedElement = useCallback(
    (id: string) => {
      updateScene({
        fixedElements: directorBlock.sceneBlock.fixedElements.filter((e) => e.id !== id),
      });
    },
    [directorBlock.sceneBlock.fixedElements, updateScene]
  );

  const updateFixedElement = useCallback(
    (id: string, patch: Partial<FixedElement>) => {
      updateScene({
        fixedElements: directorBlock.sceneBlock.fixedElements.map((e) =>
          e.id === id ? { ...e, ...patch } : e
        ),
      });
    },
    [directorBlock.sceneBlock.fixedElements, updateScene]
  );

  // ===== 角色操作 =====
  const addCharacter = useCallback(
    (semanticAssetId: string) => {
      const newChar = createDefaultCharacterBlock(semanticAssetId);
      // 自动分散位置
      const count = directorBlock.characters.length;
      newChar.x = 0.3 + count * 0.2;
      newChar.y = 0.5;
      onChange({
        ...directorBlock,
        characters: [...directorBlock.characters, newChar],
      });
      setSelectedCharId(newChar.id);
    },
    [directorBlock, onChange]
  );

  const removeCharacter = useCallback(
    (id: string) => {
      onChange({
        ...directorBlock,
        characters: directorBlock.characters.filter((c) => c.id !== id),
      });
      if (selectedCharId === id) setSelectedCharId(null);
    },
    [directorBlock, onChange, selectedCharId]
  );

  const updateCharacter = useCallback(
    (id: string, patch: Partial<CharacterBlock>) => {
      onChange({
        ...directorBlock,
        characters: directorBlock.characters.map((c) =>
          c.id === id ? { ...c, ...patch } : c
        ),
      });
    },
    [directorBlock, onChange]
  );

  // ===== 拖拽逻辑 =====
  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;

      // 检查是否点击了角色
      const clickedChar = directorBlock.characters.find((c) => {
        const dx = c.x - x;
        const dy = c.y - y;
        return Math.sqrt(dx * dx + dy * dy) < 0.06; // 6% 半径
      });

      if (clickedChar) {
        setSelectedCharId(clickedChar.id);
        setDraggingCharId(clickedChar.id);
      } else {
        setSelectedCharId(null);
      }
    },
    [directorBlock.characters]
  );

  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!draggingCharId || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      const y = clamp((e.clientY - rect.top) / rect.height, 0, 1);

      updateCharacter(draggingCharId, { x, y });
    },
    [draggingCharId, updateCharacter]
  );

  const handleCanvasMouseUp = useCallback(() => {
    setDraggingCharId(null);
  }, []);

  // ===== 渲染画布 =====
  const renderCanvas = () => {
    const w = CANVAS_WIDTH;
    const h = CANVAS_HEIGHT;

    return (
      <div
        ref={canvasRef}
        className="relative cursor-crosshair overflow-hidden rounded-xl border-2 border-surface-border bg-surface-elevated"
        style={{ width: w, height: h, maxWidth: "100%" }}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
        onMouseLeave={handleCanvasMouseUp}
      >
        {/* 背景图 */}
        {sceneImages[0]?.publicId && (
          <img
            src={sceneImages[0].publicId}
            alt="scene"
            className="absolute inset-0 h-full w-full object-cover opacity-40"
          />
        )}

        {/* 网格 */}
        {showGrid && (
          <svg className="absolute inset-0 h-full w-full pointer-events-none">
            <defs>
              <pattern id="grid" width={GRID_SIZE} height={GRID_SIZE} patternUnits="userSpaceOnUse">
                <path d={`M ${GRID_SIZE} 0 L 0 0 0 ${GRID_SIZE}`} fill="none" stroke="rgba(148,163,184,0.15)" strokeWidth={1} />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
            {/* 中心线 */}
            <line x1={w / 2} y1={0} x2={w / 2} y2={h} stroke="rgba(148,163,184,0.3)" strokeWidth={1} strokeDasharray="4 4" />
            <line x1={0} y1={h / 2} x2={w} y2={h / 2} stroke="rgba(148,163,184,0.3)" strokeWidth={1} strokeDasharray="4 4" />
            {/* 三分线 */}
            <line x1={w / 3} y1={0} x2={w / 3} y2={h} stroke="rgba(148,163,184,0.2)" strokeWidth={1} strokeDasharray="2 4" />
            <line x1={(w * 2) / 3} y1={0} x2={(w * 2) / 3} y2={h} stroke="rgba(148,163,184,0.2)" strokeWidth={1} strokeDasharray="2 4" />
            <line x1={0} y1={h / 3} x2={w} y2={h / 3} stroke="rgba(148,163,184,0.2)" strokeWidth={1} strokeDasharray="2 4" />
            <line x1={0} y1={(h * 2) / 3} x2={w} y2={(h * 2) / 3} stroke="rgba(148,163,184,0.2)" strokeWidth={1} strokeDasharray="2 4" />
          </svg>
        )}

        {/* 固定元素标记 */}
        {directorBlock.sceneBlock.fixedElements.map((el, i) => {
          const posMap: Record<string, { x: number; y: number }> = {
            left: { x: 0.15, y: 0.5 },
            right: { x: 0.85, y: 0.5 },
            front: { x: 0.5, y: 0.8 },
            back: { x: 0.5, y: 0.2 },
            center: { x: 0.5, y: 0.5 },
            "left-front": { x: 0.25, y: 0.75 },
            "right-front": { x: 0.75, y: 0.75 },
            "left-back": { x: 0.25, y: 0.25 },
            "right-back": { x: 0.75, y: 0.25 },
          };
          const pos = posMap[el.position] || { x: 0.5, y: 0.5 };
          return (
            <div
              key={el.id}
              className="absolute flex items-center justify-center rounded border border-amber-400/60 bg-amber-400/20 text-[10px] font-medium text-amber-700"
              style={{
                left: `${pos.x * 100}%`,
                top: `${pos.y * 100}%`,
                transform: "translate(-50%, -50%)",
                width: 48,
                height: 32,
              }}
            >
              {el.name}
            </div>
          );
        })}

        {/* 角色标记 */}
        {directorBlock.characters.map((char) => {
          const asset = characterAssets.find((a) => a.id === char.semanticAssetId);
          const isSelected = char.id === selectedCharId;
          const isDragging = char.id === draggingCharId;

          return (
            <div
              key={char.id}
              className={cn(
                "absolute flex flex-col items-center transition-transform",
                isDragging && "scale-110",
                isSelected ? "z-50" : "z-10"
              )}
              style={{
                left: `${char.x * 100}%`,
                top: `${char.y * 100}%`,
                transform: "translate(-50%, -50%)",
              }}
            >
              {/* 角色圆圈 */}
              <div
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-full border-2 text-xs font-bold",
                  isSelected
                    ? "border-brand bg-brand text-white"
                    : "border-surface-border bg-surface-card text-text-primary",
                  !char.visible && "opacity-40"
                )}
              >
                {asset?.name?.[0] || "?"}
              </div>
              {/* 朝向箭头 */}
              <div
                className="mt-0.5 text-[10px] text-text-tertiary"
                style={{ transform: getFacingRotation(char.facing) }}
              >
                ▲
              </div>
              {/* 高度指示线 */}
              <div
                className="absolute w-px bg-brand/40"
                style={{
                  height: `${char.heightRatio * h * 0.5}px`,
                  bottom: "100%",
                  left: "50%",
                }}
              />
              {/* 骨骼可视化 */}
              {char.skeleton && (
                <svg
                  className="absolute pointer-events-none"
                  style={{
                    width: 60,
                    height: char.heightRatio * h * 0.5,
                    bottom: "100%",
                    left: "50%",
                    transform: "translateX(-50%)",
                  }}
                  viewBox="0 0 100 200"
                >
                  {/* 骨骼连线 */}
                  <g stroke="rgba(99,102,241,0.6)" strokeWidth="2" fill="none">
                    {/* 头-颈 */}
                    <line x1={char.skeleton.head.x * 100} y1={char.skeleton.head.y * 200} x2={char.skeleton.neck.x * 100} y2={char.skeleton.neck.y * 200} />
                    {/* 颈-肩 */}
                    <line x1={char.skeleton.neck.x * 100} y1={char.skeleton.neck.y * 200} x2={char.skeleton.leftShoulder.x * 100} y2={char.skeleton.leftShoulder.y * 200} />
                    <line x1={char.skeleton.neck.x * 100} y1={char.skeleton.neck.y * 200} x2={char.skeleton.rightShoulder.x * 100} y2={char.skeleton.rightShoulder.y * 200} />
                    {/* 肩-肘 */}
                    <line x1={char.skeleton.leftShoulder.x * 100} y1={char.skeleton.leftShoulder.y * 200} x2={char.skeleton.leftElbow.x * 100} y2={char.skeleton.leftElbow.y * 200} />
                    <line x1={char.skeleton.rightShoulder.x * 100} y1={char.skeleton.rightShoulder.y * 200} x2={char.skeleton.rightElbow.x * 100} y2={char.skeleton.rightElbow.y * 200} />
                    {/* 肘-腕 */}
                    <line x1={char.skeleton.leftElbow.x * 100} y1={char.skeleton.leftElbow.y * 200} x2={char.skeleton.leftWrist.x * 100} y2={char.skeleton.leftWrist.y * 200} />
                    <line x1={char.skeleton.rightElbow.x * 100} y1={char.skeleton.rightElbow.y * 200} x2={char.skeleton.rightWrist.x * 100} y2={char.skeleton.rightWrist.y * 200} />
                    {/* 颈-髋 */}
                    <line x1={char.skeleton.neck.x * 100} y1={char.skeleton.neck.y * 200} x2={char.skeleton.leftHip.x * 100} y2={char.skeleton.leftHip.y * 200} />
                    <line x1={char.skeleton.neck.x * 100} y1={char.skeleton.neck.y * 200} x2={char.skeleton.rightHip.x * 100} y2={char.skeleton.rightHip.y * 200} />
                    {/* 髋-膝 */}
                    <line x1={char.skeleton.leftHip.x * 100} y1={char.skeleton.leftHip.y * 200} x2={char.skeleton.leftKnee.x * 100} y2={char.skeleton.leftKnee.y * 200} />
                    <line x1={char.skeleton.rightHip.x * 100} y1={char.skeleton.rightHip.y * 200} x2={char.skeleton.rightKnee.x * 100} y2={char.skeleton.rightKnee.y * 200} />
                    {/* 膝-踝 */}
                    <line x1={char.skeleton.leftKnee.x * 100} y1={char.skeleton.leftKnee.y * 200} x2={char.skeleton.leftAnkle.x * 100} y2={char.skeleton.leftAnkle.y * 200} />
                    <line x1={char.skeleton.rightKnee.x * 100} y1={char.skeleton.rightKnee.y * 200} x2={char.skeleton.rightAnkle.x * 100} y2={char.skeleton.rightAnkle.y * 200} />
                  </g>
                  {/* 关节点 */}
                  <g fill="rgba(99,102,241,0.9)">
                    <circle cx={char.skeleton.head.x * 100} cy={char.skeleton.head.y * 200} r="4" />
                    <circle cx={char.skeleton.neck.x * 100} cy={char.skeleton.neck.y * 200} r="3" />
                    <circle cx={char.skeleton.leftShoulder.x * 100} cy={char.skeleton.leftShoulder.y * 200} r="3" />
                    <circle cx={char.skeleton.rightShoulder.x * 100} cy={char.skeleton.rightShoulder.y * 200} r="3" />
                    <circle cx={char.skeleton.leftElbow.x * 100} cy={char.skeleton.leftElbow.y * 200} r="2.5" />
                    <circle cx={char.skeleton.rightElbow.x * 100} cy={char.skeleton.rightElbow.y * 200} r="2.5" />
                    <circle cx={char.skeleton.leftWrist.x * 100} cy={char.skeleton.leftWrist.y * 200} r="2.5" />
                    <circle cx={char.skeleton.rightWrist.x * 100} cy={char.skeleton.rightWrist.y * 200} r="2.5" />
                    <circle cx={char.skeleton.leftHip.x * 100} cy={char.skeleton.leftHip.y * 200} r="3" />
                    <circle cx={char.skeleton.rightHip.x * 100} cy={char.skeleton.rightHip.y * 200} r="3" />
                    <circle cx={char.skeleton.leftKnee.x * 100} cy={char.skeleton.leftKnee.y * 200} r="2.5" />
                    <circle cx={char.skeleton.rightKnee.x * 100} cy={char.skeleton.rightKnee.y * 200} r="2.5" />
                    <circle cx={char.skeleton.leftAnkle.x * 100} cy={char.skeleton.leftAnkle.y * 200} r="2.5" />
                    <circle cx={char.skeleton.rightAnkle.x * 100} cy={char.skeleton.rightAnkle.y * 200} r="2.5" />
                  </g>
                </svg>
              )}
              {/* 名字标签 */}
              <div className="mt-1 whitespace-nowrap rounded bg-surface-card px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
                {asset?.name || "未命名"}
                {!char.visible && " (隐藏)"}
              </div>
            </div>
          );
        })}

        {/* 坐标显示 */}
        <div className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-[10px] text-white">
          {directorBlock.characters.find((c) => c.id === selectedCharId)
            ? `选中: ${characterAssets.find((a) => a.id === directorBlock.characters.find((c) => c.id === selectedCharId)?.semanticAssetId)?.name || "?"} (${Math.round((directorBlock.characters.find((c) => c.id === selectedCharId)?.x || 0) * 100)}%, ${Math.round((directorBlock.characters.find((c) => c.id === selectedCharId)?.y || 0) * 100)}%)`
            : "点击画布添加或选择角色"}
        </div>
      </div>
    );
  };

  const getFacingRotation = (facing: Facing): string => {
    const map: Record<string, string> = {
      front: "rotate(0deg)",
      "front-right": "rotate(45deg)",
      right: "rotate(90deg)",
      "back-right": "rotate(135deg)",
      back: "rotate(180deg)",
      "back-left": "rotate(225deg)",
      left: "rotate(270deg)",
      "front-left": "rotate(315deg)",
    };
    return map[facing] || "rotate(0deg)";
  };

  // ===== 预览 Prompt =====
  const previewPrompt = (() => {
    const parts: string[] = [];
    const sceneLock = buildSceneLockPrompt(directorBlock.sceneBlock, semanticAssets);
    if (sceneLock) parts.push(sceneLock);
    const charLock = buildCharacterPositionPrompt(directorBlock.characters, semanticAssets);
    if (charLock) parts.push(charLock);
    const cameraLock = buildCameraPositionPrompt(directorBlock);
    if (cameraLock) parts.push(cameraLock);
    return parts.join("\n\n") || "暂无导演台数据";
  })();

  // ===== 渲染 =====
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-surface-border bg-surface-card">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/10 text-brand">
            <Layers className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-text-primary">导演台</div>
            <div className="text-[11px] text-text-tertiary">
              {shotTitle || "未命名镜头"} · {shotScene || "未指定场景"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowGrid(!showGrid)}
            className={cn(
              "rounded-lg px-2 py-1 text-xs font-medium transition-colors",
              showGrid ? "bg-brand/10 text-brand" : "text-text-tertiary hover:bg-surface-elevated"
            )}
          >
            网格
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-text-tertiary hover:bg-surface-elevated hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Tab */}
      <div className="flex border-b border-surface-border">
        {[
          { key: "canvas" as const, label: "站位画布", icon: Move },
          { key: "scene" as const, label: "场景结构", icon: Maximize2 },
          { key: "preview" as const, label: "Prompt预览", icon: Eye },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2.5 text-xs font-medium transition-colors",
              activeTab === tab.key
                ? "border-brand text-brand"
                : "border-transparent text-text-tertiary hover:text-text-secondary"
            )}
          >
            <tab.icon className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === "canvas" && (
          <div className="space-y-4">
            {/* 画布 */}
            <div className="flex justify-center">{renderCanvas()}</div>

            {/* 添加角色 */}
            <div className="rounded-xl border border-surface-border bg-surface-elevated p-3">
              <div className="mb-2 text-xs font-medium text-text-secondary">添加角色到画布</div>
              <div className="flex flex-wrap gap-2">
                {characterAssets.length === 0 && (
                  <div className="text-xs text-text-tertiary">暂无角色资产，先到资产步骤生成角色</div>
                )}
                {characterAssets.map((asset) => {
                  const alreadyAdded = directorBlock.characters.some(
                    (c) => c.semanticAssetId === asset.id
                  );
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => addCharacter(asset.id)}
                      disabled={alreadyAdded}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                        alreadyAdded
                          ? "border-surface-border bg-surface-card text-text-tertiary"
                          : "border-brand/40 bg-brand/10 text-brand hover:bg-brand/15"
                      )}
                    >
                      <User className="h-3 w-3" />
                      {asset.name}
                      {alreadyAdded && "(已添加)"}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 选中角色属性 */}
            {selectedCharId && (() => {
              const char = directorBlock.characters.find((c) => c.id === selectedCharId);
              if (!char) return null;
              const asset = characterAssets.find((a) => a.id === char.semanticAssetId);

              return (
                <div className="rounded-xl border border-brand/30 bg-brand/5 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-xs font-semibold text-brand">{asset?.name || "角色"} 属性</div>
                    <button
                      type="button"
                      onClick={() => removeCharacter(char.id)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded text-text-tertiary hover:text-red-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {/* 坐标 */}
                    <div className="space-y-1">
                      <label className="text-[11px] text-text-tertiary">水平位置 (x)</label>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(char.x * 100)}
                        onChange={(e) => updateCharacter(char.id, { x: Number(e.target.value) / 100 })}
                        className="w-full"
                      />
                      <div className="text-[10px] text-text-tertiary">{Math.round(char.x * 100)}%</div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-text-tertiary">垂直位置 (y)</label>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(char.y * 100)}
                        onChange={(e) => updateCharacter(char.id, { y: Number(e.target.value) / 100 })}
                        className="w-full"
                      />
                      <div className="text-[10px] text-text-tertiary">{Math.round(char.y * 100)}%</div>
                    </div>

                    {/* 朝向 */}
                    <div className="space-y-1">
                      <label className="text-[11px] text-text-tertiary">朝向</label>
                      <div className="flex flex-wrap gap-1">
                        {FACING_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => updateCharacter(char.id, { facing: opt.value })}
                            className={cn(
                              "h-7 w-7 rounded border text-xs",
                              char.facing === opt.value
                                ? "border-brand bg-brand text-white"
                                : "border-surface-border bg-surface-card text-text-secondary"
                            )}
                            title={opt.label}
                          >
                            {opt.icon}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 高度 */}
                    <div className="space-y-1">
                      <label className="text-[11px] text-text-tertiary">画面高度占比</label>
                      <input
                        type="range"
                        min={10}
                        max={90}
                        value={Math.round(char.heightRatio * 100)}
                        onChange={(e) => updateCharacter(char.id, { heightRatio: Number(e.target.value) / 100 })}
                        className="w-full"
                      />
                      <div className="text-[10px] text-text-tertiary">{Math.round(char.heightRatio * 100)}%</div>
                    </div>

                    {/* 姿势 */}
                    <div className="space-y-1">
                      <label className="text-[11px] text-text-tertiary">姿势</label>
                      <select
                        value={char.pose}
                        onChange={(e) => updateCharacter(char.id, { pose: e.target.value as PosePreset })}
                        className="w-full rounded-lg border border-surface-border bg-surface-card px-2 py-1 text-xs text-text-primary"
                      >
                        {POSE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* 自定义姿势 */}
                    {char.pose === "custom" && (
                      <div className="space-y-1 sm:col-span-2">
                        <label className="text-[11px] text-text-tertiary">自定义姿势描述</label>
                        <input
                          type="text"
                          value={char.poseDescription || ""}
                          onChange={(e) => updateCharacter(char.id, { poseDescription: e.target.value })}
                          placeholder="例如：右手握剑斜指地面，左手自然下垂"
                          className="w-full rounded-lg border border-surface-border bg-surface-card px-2 py-1 text-xs text-text-primary"
                        />
                      </div>
                    )}

                    {/* 姿势参考图 */}
                    <div className="space-y-1 sm:col-span-2">
                      <label className="text-[11px] text-text-tertiary">姿势参考图</label>
                      <div className="flex flex-wrap gap-2">
                        {assets
                          .filter((a) => a.type === "image" && (a.role === "character" || a.role === "reference_image"))
                          .map((asset) => {
                            const active = char.poseRefAssetId === asset.id;
                            return (
                              <button
                                key={asset.id}
                                type="button"
                                onClick={() => updateCharacter(char.id, { poseRefAssetId: active ? undefined : asset.id })}
                                className={cn(
                                  "flex items-center gap-2 rounded-lg border p-1.5 text-left transition-colors",
                                  active ? "border-brand/50 bg-brand/10" : "border-surface-border bg-surface-card hover:border-brand/40"
                                )}
                              >
                                <img src={asset.url || asset.publicId} alt="" className="h-8 w-8 rounded object-cover" />
                                <span className="max-w-[80px] truncate text-[10px] text-text-secondary">{asset.name}</span>
                              </button>
                            );
                          })}
                        {assets.filter((a) => a.type === "image" && (a.role === "character" || a.role === "reference_image")).length === 0 && (
                          <div className="text-xs text-text-tertiary">暂无姿势参考图素材</div>
                        )}
                      </div>
                    </div>

                    {/* 可见性 */}
                    <div className="flex items-center gap-2 sm:col-span-2">
                      <button
                        type="button"
                        onClick={() => updateCharacter(char.id, { visible: !char.visible })}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
                          char.visible
                            ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-700"
                            : "border-surface-border bg-surface-card text-text-tertiary"
                        )}
                      >
                        {char.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                        {char.visible ? "镜头中可见" : "本镜头隐藏"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* 未选中提示 */}
            {!selectedCharId && directorBlock.characters.length > 0 && (
              <div className="text-center text-xs text-text-tertiary">点击画布上的角色圆圈进行编辑</div>
            )}
          </div>
        )}

        {activeTab === "scene" && (
          <div className="space-y-4">
            {/* 场景基础 */}
            <div className="rounded-xl border border-surface-border bg-surface-elevated p-3">
              <div className="mb-2 text-xs font-semibold text-text-secondary">场景基础</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-[11px] text-text-tertiary">关联场景资产</label>
                  <select
                    value={directorBlock.sceneBlock.sceneAssetId || ""}
                    onChange={(e) => updateScene({ sceneAssetId: e.target.value || undefined })}
                    className="w-full rounded-lg border border-surface-border bg-surface-card px-2 py-1 text-xs text-text-primary"
                  >
                    <option value="">不关联</option>
                    {sceneAssets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-text-tertiary">房间形状</label>
                  <select
                    value={directorBlock.sceneBlock.roomShape || "rectangular"}
                    onChange={(e) => updateScene({ roomShape: e.target.value as SceneBlock["roomShape"] })}
                    className="w-full rounded-lg border border-surface-border bg-surface-card px-2 py-1 text-xs text-text-primary"
                  >
                    <option value="rectangular">长方形</option>
                    <option value="L-shaped">L形</option>
                    <option value="square">正方形</option>
                    <option value="circular">圆形</option>
                    <option value="irregular">不规则</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-text-tertiary">纵深(米)</label>
                  <input
                    type="number"
                    value={directorBlock.sceneBlock.dimensions?.depth || ""}
                    onChange={(e) =>
                      updateScene({
                        dimensions: {
                          ...directorBlock.sceneBlock.dimensions,
                          depth: Number(e.target.value),
                        } as SceneBlock["dimensions"],
                      })
                    }
                    className="w-full rounded-lg border border-surface-border bg-surface-card px-2 py-1 text-xs text-text-primary"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-text-tertiary">宽度(米)</label>
                  <input
                    type="number"
                    value={directorBlock.sceneBlock.dimensions?.width || ""}
                    onChange={(e) =>
                      updateScene({
                        dimensions: {
                          ...directorBlock.sceneBlock.dimensions,
                          width: Number(e.target.value),
                        } as SceneBlock["dimensions"],
                      })
                    }
                    className="w-full rounded-lg border border-surface-border bg-surface-card px-2 py-1 text-xs text-text-primary"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-text-tertiary">层高(米)</label>
                  <input
                    type="number"
                    value={directorBlock.sceneBlock.dimensions?.height || ""}
                    onChange={(e) =>
                      updateScene({
                        dimensions: {
                          ...directorBlock.sceneBlock.dimensions,
                          height: Number(e.target.value),
                        } as SceneBlock["dimensions"],
                      })
                    }
                    className="w-full rounded-lg border border-surface-border bg-surface-card px-2 py-1 text-xs text-text-primary"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-text-tertiary">氛围</label>
                  <input
                    type="text"
                    value={directorBlock.sceneBlock.atmosphere || ""}
                    onChange={(e) => updateScene({ atmosphere: e.target.value })}
                    placeholder="压抑、诡异、温暖..."
                    className="w-full rounded-lg border border-surface-border bg-surface-card px-2 py-1 text-xs text-text-primary"
                  />
                </div>
              </div>
            </div>

            {/* 光源 */}
            <div className="rounded-xl border border-surface-border bg-surface-elevated p-3">
              <div className="mb-2 text-xs font-semibold text-text-secondary">光源设置</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-[11px] text-text-tertiary">位置</label>
                  <input
                    type="text"
                    value={directorBlock.sceneBlock.lightSource.position}
                    onChange={(e) =>
                      updateScene({
                        lightSource: { ...directorBlock.sceneBlock.lightSource, position: e.target.value },
                      })
                    }
                    placeholder="天花板中央、左侧墙壁..."
                    className="w-full rounded-lg border border-surface-border bg-surface-card px-2 py-1 text-xs text-text-primary"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-text-tertiary">颜色</label>
                  <input
                    type="text"
                    value={directorBlock.sceneBlock.lightSource.color}
                    onChange={(e) =>
                      updateScene({
                        lightSource: { ...directorBlock.sceneBlock.lightSource, color: e.target.value },
                      })
                    }
                    placeholder="青白色、暖黄、血红..."
                    className="w-full rounded-lg border border-surface-border bg-surface-card px-2 py-1 text-xs text-text-primary"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-text-tertiary">亮度</label>
                  <select
                    value={directorBlock.sceneBlock.lightSource.intensity}
                    onChange={(e) =>
                      updateScene({
                        lightSource: {
                          ...directorBlock.sceneBlock.lightSource,
                          intensity: e.target.value as LightSource["intensity"],
                        },
                      })
                    }
                    className="w-full rounded-lg border border-surface-border bg-surface-card px-2 py-1 text-xs text-text-primary"
                  >
                    <option value="dim">昏暗</option>
                    <option value="normal">正常</option>
                    <option value="bright">明亮</option>
                    <option value="harsh">刺眼</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-text-tertiary">方向</label>
                  <input
                    type="text"
                    value={directorBlock.sceneBlock.lightSource.direction || ""}
                    onChange={(e) =>
                      updateScene({
                        lightSource: {
                          ...directorBlock.sceneBlock.lightSource,
                          direction: e.target.value,
                        },
                      })
                    }
                    placeholder="顶光、侧光、底光..."
                    className="w-full rounded-lg border border-surface-border bg-surface-card px-2 py-1 text-xs text-text-primary"
                  />
                </div>
              </div>
            </div>

            {/* 固定元素 */}
            <div className="rounded-xl border border-surface-border bg-surface-elevated p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs font-semibold text-text-secondary">固定建筑元素</div>
                <button
                  type="button"
                  onClick={addFixedElement}
                  className="inline-flex items-center gap-1 rounded-full border border-brand/40 bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand hover:bg-brand/15"
                >
                  <Plus className="h-3 w-3" />
                  添加
                </button>
              </div>

              {directorBlock.sceneBlock.fixedElements.length === 0 && (
                <div className="text-xs text-text-tertiary">暂无固定元素。添加窗户、门、柱子等不可变建筑结构。</div>
              )}

              <div className="space-y-2">
                {directorBlock.sceneBlock.fixedElements.map((el) => (
                  <div key={el.id} className="flex items-center gap-2 rounded-lg border border-surface-border bg-surface-card p-2">
                    <input
                      type="text"
                      value={el.name}
                      onChange={(e) => updateFixedElement(el.id, { name: e.target.value })}
                      className="w-20 rounded border border-surface-border bg-surface-elevated px-1.5 py-0.5 text-xs text-text-primary"
                    />
                    <select
                      value={el.position}
                      onChange={(e) => updateFixedElement(el.id, { position: e.target.value as FixedElement["position"] })}
                      className="rounded border border-surface-border bg-surface-elevated px-1.5 py-0.5 text-xs text-text-primary"
                    >
                      {POSITION_OPTIONS.map((p) => (
                        <option key={p} value={p}>
                          {p === "custom" ? "自定义" : p}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={el.size}
                      onChange={(e) => updateFixedElement(el.id, { size: e.target.value })}
                      placeholder="尺寸"
                      className="w-20 rounded border border-surface-border bg-surface-elevated px-1.5 py-0.5 text-xs text-text-primary"
                    />
                    <input
                      type="text"
                      value={el.description}
                      onChange={(e) => updateFixedElement(el.id, { description: e.target.value })}
                      placeholder="描述"
                      className="flex-1 rounded border border-surface-border bg-surface-elevated px-1.5 py-0.5 text-xs text-text-primary"
                    />
                    <button
                      type="button"
                      onClick={() => removeFixedElement(el.id)}
                      className="text-text-tertiary hover:text-red-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* 背景素材 */}
            <div className="rounded-xl border border-surface-border bg-surface-elevated p-3">
              <div className="mb-2 text-xs font-semibold text-text-secondary">背景素材</div>
              <div className="text-xs text-text-tertiary">
                当前关联的场景素材：{sceneImages.length > 0 ? `${sceneImages.length} 张` : "无"}
              </div>
              {sceneImages.length > 0 && (
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {sceneImages.map((img) => (
                    <img
                      key={img.id}
                      src={img.publicId || img.url}
                      alt={img.name}
                      className="aspect-video rounded-lg object-cover"
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "preview" && (
          <div className="space-y-3">
            <div className="text-xs font-semibold text-text-secondary">将注入到 Prompt 的空间锁定文本</div>
            <pre className="min-h-[200px] whitespace-pre-wrap rounded-xl border border-surface-border bg-surface-elevated p-3 font-mono text-xs leading-5 text-text-primary">
              {previewPrompt}
            </pre>
            <div className="text-[11px] text-text-tertiary">
              此文本会在生成图片/视频时自动注入到 prompt 开头，确保 AI 优先读取空间约束。
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
