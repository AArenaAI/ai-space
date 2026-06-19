import type { SemanticAsset, SemanticAssetKind, StoryboardShot, WorkflowMode } from "./types";

export type AssetImagePromptMode = "default" | "character-turnaround";

export const ASSET_KIND_LABELS: Record<SemanticAssetKind, string> = {
  character: "角色",
  scene: "场景",
  prop: "道具",
  style: "风格",
};

export function buildWorkflowSystemPrompt(mode: WorkflowMode) {
  const common = "你是 AI Space 的影视/小说创作前期助手。不要联网搜索。输出要直接可编辑、可复制，不要解释思考过程，不要使用 Markdown 代码块。";
  if (mode === "novel") {
    return `${common}\n任务：根据用户创意写完整小说，有明确开端、发展、高潮和结尾；人物动机清楚；画面感强。输出格式：<TITLE>标题</TITLE><CONTENT>完整小说正文</CONTENT>`;
  }
  if (mode === "script") {
    return `${common}\n任务：把用户输入的【本集大概内容】改写成影视剧本。不要要求或依赖整本小说/附件素材；只基于用户提供的本集梗概、关键情节、人物关系和明确改编要求生成。缺失细节可以合理补足，但不要声称读取了原小说。按幕/场组织，每场包含地点、时间、人物、动作、对白/旁白；优先服务本集强钩子和可拍摄性。输出格式：<TITLE>剧本标题</TITLE><SCRIPT>完整剧本</SCRIPT>`;
  }
  if (mode === "assets") {
    return `${common}\n任务：根据剧本提取前期制作资产。必须覆盖角色、场景、关键道具、整体风格。每个资产都要包含可用于 Seedream 生图的 lock_prompt 和 negative_prompt。优先输出 JSON：{ "assets": [{ "kind": "character", "name": "", "summary": "", "lock_prompt": "", "negative_prompt": "" }] }，kind 只能是 character/scene/prop/style。不要输出代码块。`;
  }
  if (mode === "storyboardVideo") {
    return `${common}\n任务：根据剧本和资产设定生成视频分镜脚本提示词。每个镜头必须包含：镜头编号、场景、画面、镜头运动、角色动作、台词/旁白、建议时长、可直接用于 Seedance 视频生成的 video_prompt。优先输出 JSON：{ "shots": [{ "index": 1, "title": "", "scene": "", "characters": [], "shot_type": "中景", "camera_move": "固定", "purpose": "信息揭示", "dialogue": "", "narration": "", "duration": 5, "aspectRatio": "9:16", "video_prompt": "" }] }。不要输出代码块。`;
  }
  return `${common}\n任务：根据剧本、资产和视频分镜，生成 Seedream 分镜图提示词。每个镜头一条 image_prompt，强调静态构图、主体、景别、光线、角色/服装/场景一致性。优先输出 JSON：{ "shots": [{ "index": 1, "title": "", "scene": "", "characters": [], "shot_type": "中景", "camera_move": "固定", "purpose": "信息揭示", "dialogue": "", "narration": "", "duration": 5, "aspectRatio": "9:16", "image_prompt": "", "video_prompt": "" }] }。不要输出代码块。`;
}

export function buildSemanticAssetImagePrompt(asset: SemanticAsset, mode: AssetImagePromptMode = "default") {
  const kindLabel = ASSET_KIND_LABELS[asset.kind] || "资产";
  const base = [
    `【资产类型】${kindLabel}`,
    `【资产名称】${asset.name}`,
    asset.summary ? `【摘要】${asset.summary}` : "",
    asset.lockPrompt ? `【Seedream 资产锁定词】${asset.lockPrompt}` : "",
    mode === "character-turnaround"
      ? "生成角色三视图设定图：同一角色、同一服装、同一发型、同一配色，正面/侧面/背面并排展示；白色或浅灰纯净背景；全身站姿；比例一致；不要换人、不要换衣服、不要加入场景、不要复杂姿势、不要文字水印。"
      : "生成一张可作为漫剧制作资产库使用的清晰参考图。主体单一、特征稳定、构图干净、方便后续作为参考图复用。",
    asset.kind === "character" && mode === "default" ? "角色资产：单人正面或三分之二视角，完整外观、服装、发型、年龄气质清晰，背景简洁。" : "",
    asset.kind === "scene" ? "场景资产：无人或弱人物干扰，空间结构、光线、关键物件位置清晰。" : "",
    asset.kind === "prop" ? "道具资产：单个道具居中展示，材质、形状、使用痕迹清晰，背景干净。" : "",
    asset.kind === "style" ? "风格资产：建立统一美术风格、色彩、光影和质感，不要复杂叙事。" : "",
    asset.negativePrompt ? `【禁用项】${asset.negativePrompt}` : "",
  ];
  return base.filter(Boolean).join("\n");
}

export function buildStoryboardSketchPrompt(shot: StoryboardShot) {
  const source = [
    `分镜${shot.index}：${shot.title}`,
    shot.shotType ? `景别：${shot.shotType}` : "",
    shot.cameraMove ? `运镜：${shot.cameraMove}` : "",
    shot.scene ? `画面内容：${shot.scene}` : "",
    shot.characters.length ? `出场人物：${shot.characters.join("、")}` : "",
    shot.dialogue ? `关键对白：${shot.dialogue}` : "",
    shot.imagePrompt ? `补充描述：${shot.imagePrompt}` : "",
  ].filter(Boolean).join("\n");
  return `根据以下分镜内容绘制故事版草稿图。\n风格要求：松散随性草稿线，黑白单色线稿，低细节，像导演分镜板；只用少量彩色手绘箭头标注运动轨迹、视线方向和动作方向；不要做精修插画，不要电影海报，不要复杂上色，不要清晰可读字幕。\n构图要求：重点验证人物站位、空间关系、景别、运镜方向和动作可读性。\n\n${source}`;
}

export function buildStructuredShotImagePrompt(shot: StoryboardShot) {
  return [
    `分镜${shot.index}：${shot.title}`,
    shot.scene ? `画面场景：${shot.scene}` : "",
    shot.shotType ? `景别：${shot.shotType}` : "",
    shot.cameraMove ? `运镜：${shot.cameraMove}` : "",
    shot.characters.length ? `出场人物：${shot.characters.join("、")}` : "",
    shot.dialogue ? `关键对白：${shot.dialogue}` : "",
    shot.purpose ? `目的：${shot.purpose}` : "",
  ].filter(Boolean).join("\n");
}

export function buildGeneratorGroupSummaryPrompt(params: {
  mode: "image" | "video";
  shotCount: number;
  modelLabel: string;
  aspect: string;
  resolution?: string;
  duration?: number;
}) {
  return [
    `【生成器组】${params.mode === "image" ? "批量分镜图" : "批量视频"}`,
    `镜头数量：${params.shotCount}`,
    `模型：${params.modelLabel}`,
    `画幅：${params.aspect}`,
    params.resolution ? `分辨率：${params.resolution}` : "",
    params.duration ? `时长：${params.duration}s` : "",
    "用途：批量生产前的参数确认与任务入口。",
  ].filter(Boolean).join("\n");
}
