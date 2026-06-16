import type { CharacterBlock, DirectorBlock, FixedElement, PosePreset, SceneBlock, SemanticAsset, StoredAsset, StoryboardShot } from "./types";

// ===== 导演台 Prompt 构建 =====

export function buildSceneLockPrompt(sceneBlock: SceneBlock, semanticAssets: SemanticAsset[]): string {
  const lines: string[] = [];

  // 场景基础
  const sceneAsset = sceneBlock.sceneAssetId
    ? semanticAssets.find((a) => a.id === sceneBlock.sceneAssetId)
    : undefined;

  if (sceneAsset) {
    lines.push(`【场景锁定】${sceneAsset.name}：${sceneAsset.summary}`);
  } else if (sceneBlock.roomShape) {
    const dim = sceneBlock.dimensions
      ? `，纵深${sceneBlock.dimensions.depth}米×宽${sceneBlock.dimensions.width}米×层高${sceneBlock.dimensions.height}米`
      : "";
    lines.push(`【场景锁定】${sceneBlock.roomShape}空间${dim}`);
  }

  // 固定建筑元素（不可变）
  if (sceneBlock.fixedElements?.length) {
    lines.push("【固定建筑元素】以下元素在所有镜头中必须保持位置、尺寸、外观一致：");
    for (const el of sceneBlock.fixedElements) {
      const pos = el.position === "custom" ? el.customPosition : el.position;
      lines.push(`  - ${el.name}：位于${pos}，尺寸${el.size}，${el.description}`);
    }
  }

  // 光源
  const ls = sceneBlock.lightSource;
  if (ls) {
    lines.push(`【光源锁定】${ls.position}，${ls.color}，${ls.intensity}亮度${ls.direction ? `，方向${ls.direction}` : ""}`);
  }

  // 氛围
  if (sceneBlock.atmosphere) {
    lines.push(`【氛围锁定】${sceneBlock.atmosphere}`);
  }

  return lines.join("\n");
}

export function buildCharacterPositionPrompt(characters: CharacterBlock[], semanticAssets: SemanticAsset[]): string {
  if (!characters?.length) return "";

  const lines: string[] = [];
  lines.push("【人物站位锁定】");

  for (const ch of characters) {
    const asset = semanticAssets.find((a) => a.id === ch.semanticAssetId);
    const name = asset?.name || "角色";

    const facingMap: Record<string, string> = {
      left: "面向左侧",
      right: "面向右侧",
      front: "面向镜头",
      back: "背对镜头",
      "front-left": "左前方",
      "front-right": "右前方",
      "back-left": "左后方",
      "back-right": "右后方",
    };

    const poseMap: Record<string, string> = {
      standing: "站立",
      sitting: "坐姿",
      walking: "行走",
      running: "奔跑",
      fighting: "战斗姿态",
      crouching: "蹲伏",
      kneeling: "跪姿",
      pointing: "指向",
      holding: "手持物品",
      custom: "",
    };

    const parts: string[] = [
      `${name}：画面坐标(${Math.round(ch.x * 100)}%, ${Math.round(ch.y * 100)}%)`,
      facingMap[ch.facing] || ch.facing,
      `占画面高度${Math.round(ch.heightRatio * 100)}%`,
    ];

    if (ch.pose === "custom" && ch.poseDescription) {
      parts.push(`姿势：${ch.poseDescription}`);
    } else if (ch.pose !== "custom") {
      parts.push(`姿势：${poseMap[ch.pose] || ch.pose}`);
    }

    // 姿势参考图
    if (ch.poseRefAssetId) {
      const poseAsset = semanticAssets.find((a) => a.id === ch.poseRefAssetId);
      if (poseAsset) {
        parts.push(`  - 姿势参考：${poseAsset.name}，${poseAsset.summary}`);
      }
    }

    // 骨骼关键点（如果有）
    if (ch.skeleton) {
      const sk = ch.skeleton;
      const boneDesc: string[] = [];
      // 手臂状态
      if (sk.leftWrist.y < sk.leftElbow.y) boneDesc.push("左臂上举");
      else if (sk.leftWrist.y > sk.leftElbow.y) boneDesc.push("左臂下垂");
      if (sk.rightWrist.y < sk.rightElbow.y) boneDesc.push("右臂上举");
      else if (sk.rightWrist.y > sk.rightElbow.y) boneDesc.push("右臂下垂");
      // 腿部状态
      if (sk.leftKnee.y < sk.leftHip.y) boneDesc.push("左腿弯曲");
      if (sk.rightKnee.y < sk.rightHip.y) boneDesc.push("右腿弯曲");
      // 头部
      if (sk.head.x !== sk.neck.x) boneDesc.push(sk.head.x < sk.neck.x ? "头部左倾" : "头部右倾");
      
      if (boneDesc.length) {
        parts.push(`  - 骨骼姿态：${boneDesc.join("，")}`);
      }
    }

    if (ch.zIndex !== undefined) {
      parts.push(`层级：${ch.zIndex > 0 ? "前" : "后"}`);
    }

    if (ch.visible === false) {
      parts.push("【本镜头不可见】");
    }

    lines.push(`  - ${parts.join("，")}`);
  }

  return lines.join("\n");
}

export function buildCameraPositionPrompt(directorBlock: DirectorBlock): string {
  const lines: string[] = [];

  if (directorBlock.cameraPosition) {
    const cp = directorBlock.cameraPosition;
    lines.push(`【机位锁定】画面坐标(${Math.round(cp.x * 100)}%, ${Math.round(cp.y * 100)}%)${cp.z !== undefined ? `，高度${cp.z}` : ""}`);
  }

  if (directorBlock.cameraTarget) {
    const ct = directorBlock.cameraTarget;
    lines.push(`【镜头朝向】看向画面坐标(${Math.round(ct.x * 100)}%, ${Math.round(ct.y * 100)}%)`);
  }

  if (directorBlock.notes) {
    lines.push(`【导演备注】${directorBlock.notes}`);
  }

  return lines.join("\n");
}

/**
 * 将导演台数据注入到 image/video prompt 中
 * 优先级：场景锁定 > 人物站位 > 机位
 */
export function injectDirectorBlockToPrompt(
  basePrompt: string,
  directorBlock: DirectorBlock | undefined,
  semanticAssets: SemanticAsset[]
): string {
  if (!directorBlock) return basePrompt;

  const parts: string[] = [];

  const sceneLock = buildSceneLockPrompt(directorBlock.sceneBlock, semanticAssets);
  if (sceneLock) parts.push(sceneLock);

  const charLock = buildCharacterPositionPrompt(directorBlock.characters, semanticAssets);
  if (charLock) parts.push(charLock);

  const cameraLock = buildCameraPositionPrompt(directorBlock);
  if (cameraLock) parts.push(cameraLock);

  if (!parts.length) return basePrompt;

  // 注入到 prompt 开头，确保 AI 优先读取空间约束
  return `${parts.join("\n\n")}\n\n${basePrompt}`;
}

// ===== 导演台默认创建 =====

export function createDefaultSceneBlock(sceneAsset?: SemanticAsset): SceneBlock {
  return {
    id: `scene-${Date.now()}`,
    sceneAssetId: sceneAsset?.id,
    roomShape: "rectangular",
    fixedElements: [],
    lightSource: {
      position: "未指定",
      color: "自然光",
      intensity: "normal",
    },
  };
}

export function createDefaultCharacterBlock(semanticAssetId: string): CharacterBlock {
  return {
    id: `char-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    semanticAssetId,
    x: 0.5,
    y: 0.5,
    facing: "front",
    heightRatio: 0.6,
    pose: "standing",
    visible: true,
  };
}

export function createDefaultDirectorBlock(shotId: string, sceneAsset?: SemanticAsset): DirectorBlock {
  return {
    id: `director-${Date.now()}`,
    shotId,
    sceneBlock: createDefaultSceneBlock(sceneAsset),
    characters: [],
  };
}

// ===== 导演台与镜头关联工具 =====

export function findDirectorBlockForShot(directorBlocks: DirectorBlock[] | undefined, shotId: string): DirectorBlock | undefined {
  return directorBlocks?.find((b) => b.shotId === shotId);
}

export function getSceneAssetForShot(
  shot: { scene: string; semanticAssetIds: string[] },
  semanticAssets: SemanticAsset[]
): SemanticAsset | undefined {
  // 优先从 shot 绑定的语义资产中找场景资产
  const sceneAssetId = shot.semanticAssetIds.find((id) =>
    semanticAssets.find((a) => a.id === id && a.kind === "scene")
  );
  if (sceneAssetId) return semanticAssets.find((a) => a.id === sceneAssetId);

  //  fallback：按名称匹配
  return semanticAssets.find((a) => a.kind === "scene" && (shot.scene.includes(a.name) || a.name.includes(shot.scene)));
}

// ===== 场景参考图提取 =====

export function getSceneReferenceAssets(
  directorBlock: DirectorBlock | undefined,
  assets: StoredAsset[]
): StoredAsset[] {
  if (!directorBlock) return [];

  const refs: StoredAsset[] = [];

  // 背景图/全景图
  if (directorBlock.sceneBlock.backgroundAssetId) {
    const bg = assets.find((a) => a.id === directorBlock.sceneBlock.backgroundAssetId);
    if (bg) refs.push(bg);
  }

  // 场景资产关联的素材
  if (directorBlock.sceneBlock.sceneAssetId) {
    const sceneAssetRelated = assets.filter((a) =>
      a.role === "scene" || a.role === "reference_image"
    );
    refs.push(...sceneAssetRelated);
  }

  return refs;
}

export function getCharacterReferenceAssets(
  directorBlock: DirectorBlock | undefined,
  assets: StoredAsset[]
): StoredAsset[] {
  if (!directorBlock?.characters?.length) return [];

  const charAssetIds = new Set(directorBlock.characters.map((c) => c.semanticAssetId));
  const poseRefIds = new Set(directorBlock.characters.map((c) => c.poseRefAssetId).filter(Boolean) as string[]);
  
  return assets.filter((a) =>
    charAssetIds.has(a.id) || 
    poseRefIds.has(a.id) ||
    a.role === "character" || 
    a.role === "reference_image"
  );
}

/**
 * 获取导演台所有应作为参考图传入的素材
 * 优先级：场景背景 > 场景资产 > 角色资产
 */
export function getDirectorReferenceAssets(
  directorBlock: DirectorBlock | undefined,
  assets: StoredAsset[]
): string[] {
  const allAssets = [
    ...getSceneReferenceAssets(directorBlock, assets),
    ...getCharacterReferenceAssets(directorBlock, assets),
  ];

  // 去重，取 publicId
  return Array.from(new Set(allAssets.map((a) => a.publicId || a.url).filter(Boolean)));
}

// ===== 跨镜头导演台继承（Scene-level） =====

export type SceneDirectorTemplate = {
  id: string;
  sceneName: string;
  sceneBlock: SceneBlock;
  // 角色基础设定（不含位置，位置 per-shot）
  characterDefaults: Array<{
    semanticAssetId: string;
    heightRatio: number;
    pose: string;
    poseDescription?: string;
  }>;
};

/**
 * 从已有导演台提取 Scene-level 模板
 * 保留场景结构 + 角色默认设定，去掉具体位置
 */
export function extractSceneTemplate(directorBlock: DirectorBlock, sceneName: string): SceneDirectorTemplate {
  return {
    id: `template-${Date.now()}`,
    sceneName,
    sceneBlock: directorBlock.sceneBlock,
    characterDefaults: directorBlock.characters.map((c) => ({
      semanticAssetId: c.semanticAssetId,
      heightRatio: c.heightRatio,
      pose: c.pose,
      poseDescription: c.poseDescription,
    })),
  };
}

/**
 * 应用 Scene-level 模板到镜头，生成新的 DirectorBlock
 * 角色位置需要 per-shot 重新设定
 */
export function applySceneTemplate(
  template: SceneDirectorTemplate,
  shotId: string,
  characterPositions?: Array<{ semanticAssetId: string; x: number; y: number; facing: string }>
): DirectorBlock {
  const characters: CharacterBlock[] = template.characterDefaults.map((def, idx) => {
    const pos = characterPositions?.find((p) => p.semanticAssetId === def.semanticAssetId);
    return {
      id: `char-${shotId}-${idx}`,
      semanticAssetId: def.semanticAssetId,
      x: pos?.x ?? 0.3 + idx * 0.2,
      y: pos?.y ?? 0.5,
      facing: (pos?.facing as any) ?? "front",
      heightRatio: def.heightRatio,
      pose: def.pose as PosePreset,
      poseDescription: def.poseDescription,
      visible: true,
    };
  });

  return {
    id: `director-${shotId}`,
    shotId,
    sceneBlock: template.sceneBlock,
    characters,
  };
}

/**
 * 自动为同场景镜头继承导演台
 * 规则：如果镜头没有导演台，且同场景有其他镜头有导演台，则继承场景结构
 */
export function autoInheritDirectorBlocks(
  shots: StoryboardShot[],
  directorBlocks: DirectorBlock[],
  semanticAssets: SemanticAsset[]
): DirectorBlock[] {
  const result = [...directorBlocks];

  // 按场景分组
  const sceneGroups = new Map<string, StoryboardShot[]>();
  for (const shot of shots) {
    const sceneKey = shot.scene || shot.title || "default";
    if (!sceneGroups.has(sceneKey)) sceneGroups.set(sceneKey, []);
    sceneGroups.get(sceneKey)!.push(shot);
  }

  for (const [sceneKey, sceneShots] of Array.from(sceneGroups.entries())) {
    // 找该场景已有导演台的镜头
    const existingBlocks = sceneShots
      .map((s) => findDirectorBlockForShot(directorBlocks, s.id))
      .filter(Boolean) as DirectorBlock[];

    if (!existingBlocks.length) continue;

    // 用第一个作为模板
    const template = extractSceneTemplate(existingBlocks[0], sceneKey);

    // 为没有导演台的镜头生成继承版本
    for (const shot of sceneShots) {
      const hasBlock = result.find((b) => b.shotId === shot.id);
      if (hasBlock) continue;

      // 尝试从同场景其他镜头的角色位置推断
      const siblingPositions = existingBlocks[0].characters.map((c) => ({
        semanticAssetId: c.semanticAssetId,
        x: c.x,
        y: c.y,
        facing: c.facing,
      }));

      const inherited = applySceneTemplate(template, shot.id, siblingPositions);
      result.push(inherited);
    }
  }

  return result;
}

/**
 * 复制导演台到多个镜头
 */
export function copyDirectorBlockToShots(
  sourceBlock: DirectorBlock,
  targetShotIds: string[],
  options?: {
    keepCharacterPositions?: boolean; // true=保留位置，false=重置为默认
    offsetX?: number; // 位置偏移
    offsetY?: number;
  }
): DirectorBlock[] {
  return targetShotIds.map((shotId) => ({
    ...sourceBlock,
    id: `director-${shotId}-${Date.now()}`,
    shotId,
    characters: sourceBlock.characters.map((c) => ({
      ...c,
      id: `char-${shotId}-${c.semanticAssetId}`,
      x: options?.keepCharacterPositions ? c.x + (options.offsetX || 0) : 0.3,
      y: options?.keepCharacterPositions ? c.y + (options.offsetY || 0) : 0.5,
    })),
  }));
}
