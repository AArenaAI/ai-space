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
    return `${common}\n任务：根据剧本大纲、分集正文和镜头卡提取【候选资产卡描述】，不是生成图片。人物资产必须优先读取【剧本大纲｜人物小传】，因为那里包含角色定妆、性格、关系、成长弧线；场景/道具优先读取分集正文和当前镜头卡；整体风格综合类型、核心梗、故事梗概和本集画面。必须覆盖角色、场景、关键道具、整体风格；只输出后续可编辑确认的资产候选。每个资产都必须包含非空字段：summary、lock_prompt、negative_prompt。人物资产的 summary 只能写【人物外貌定妆】，不是人物介绍/人物小传：只保留年龄段、体型、脸部气质、发型、服装、随身物、标志性动作/姿态、可视化伤痕或器物痕迹；禁止写团队职责、人物关系、性格弧线、通关结局、剧情作用、规则解释、内心动机、能力强弱等不可直接画出来的信息。场景 summary 写空间结构/陈设/光线/材质/年代感；道具 summary 写形制/材质/磨损/符号/用途可视细节；风格 summary 写画面质感/色彩/镜头语言。lock_prompt 是中文 Seedream 生图一致性锁定词，必须同样只写可视化信息；除品牌/模型名外不要输出英文句子。negative_prompt 用中文写禁用项。禁止只输出名称和类型；禁止 summary/lock_prompt 留空；禁止把中文剧情翻译成英文 prompt。优先输出 JSON：{ "assets": [{ "kind": "character", "name": "", "summary": "", "lock_prompt": "", "negative_prompt": "" }] }，kind 只能是 character/scene/prop/style。不要输出代码块。`;
  }
  if (mode === "storyboardVideo") {
    return `${common}\n任务：根据剧本和资产设定生成视频分镜脚本提示词。每个镜头必须包含：镜头编号、场景、画面、镜头运动、角色动作、台词/旁白、建议时长、可直接用于 Seedance 视频生成的 video_prompt。优先输出 JSON：{ "shots": [{ "index": 1, "title": "", "scene": "", "characters": [], "shot_type": "中景", "camera_move": "固定", "purpose": "信息揭示", "dialogue": "", "narration": "", "duration": 5, "aspectRatio": "9:16", "video_prompt": "" }] }。不要输出代码块。`;
  }
  return `${common}\n任务：根据剧本、资产和视频分镜，生成 Seedream 分镜图提示词。每个镜头一条 image_prompt，强调静态构图、主体、景别、光线、角色/服装/场景一致性。优先输出 JSON：{ "shots": [{ "index": 1, "title": "", "scene": "", "characters": [], "shot_type": "中景", "camera_move": "固定", "purpose": "信息揭示", "dialogue": "", "narration": "", "duration": 5, "aspectRatio": "9:16", "image_prompt": "", "video_prompt": "" }] }。不要输出代码块。`;
}

export function buildScriptOutlineSystemPrompt() {
  return "你是 AI Space 的短剧策划。只根据用户最终确认的有效创意生成可编辑的短剧剧本大纲；不要采用被用户否决、放弃、临时讨论但未确认的想法。不要写小说正文，不要写完整分镜。必须严格保留最终有效创意里的【剧情流程】和【关键桥段】：桥段顺序、具体实现方式、人物动作、转折点、结尾钩子不能被换成另一套实现；可以扩写结构，但不能改写用户指定剧情。必须输出严格 JSON，不要 Markdown 代码块。格式：{\"summary\":{\"episodeCount\":5,\"genre\":\"\",\"targetAudience\":\"大众\",\"coreHook\":\"\",\"logline\":\"\",\"charactersText\":\"人物小传，多人物用换行分隔\",\"synopsis\":\"故事梗概，必须包含最终有效创意里的具体剧情流程和关键桥段\"},\"episodes\":[{\"episode\":1,\"title\":\"第1集\",\"summary\":\"分集简介，包含主事件、人物关系推进、结尾钩子，并承接用户指定剧情流程\"}]}。要求：强钩子、短剧节奏、分集递进清楚，角色小传要包含视觉形象、核心标签、身份背景、性格特点、关系、成长弧线。";
}

export function buildEffectiveIdeaSystemPrompt() {
  return "你是短剧开发编辑。你的任务不是总结聊天，而是从自由对话里提取【最终确认的有效创意】，作为后续剧本大纲、分集、正文唯一依据。核心原则：如果用户最后明确给出或认可了一段剧情内容/剧情流程，必须把它提炼成【剧情母版】，不是压缩成梗概。必须保留低颗粒度执行细节：人物移动方式、空间位置、站位关系、道具/物件、环境条件、动作先后、对白功能、误判过程、规则/约束触发方式、转折点、结尾钩子。不能因为这些细节看似不是核心梗就删除。禁止把一长段剧情压缩成几句概括；禁止跳过具体剧情描述；禁止把用户指定的实现方式替换成另一种实现。必须排除：用户明确否决的方案、AI提出但用户未采纳的选项、早期被推翻的设定、闲聊、流程说明。必须保留：用户最后确认/认可的核心创意、具体剧情流程、关键桥段顺序、类型、主角处境、世界规则/核心梗、主要人物关系、目标集数/受众/情绪、用户明确要求的禁忌或偏好。输出严格 JSON，不要 Markdown 代码块：{\"outlineSource\":\"可直接用于生成剧本大纲的有效创意母版，按【类型】【核心梗】【主角处境】【人物关系】【故事规则】【剧情流程｜逐场细节版】【关键桥段｜不可丢失细节】【集数/受众】【情绪风格】【必须避免】组织；只写最终有效信息，不写被否决内容；其中【剧情流程｜逐场细节版】必须按事件顺序逐条写，每条保留地点、人物、动作链、道具/物件、空间位置、规则/约束触发和结果，不能少于用户最后确认剧情主要信息量的三分之一；【关键桥段｜不可丢失细节】列出所有后续生成不能漏掉的具体执行细节，覆盖人物如何移动、在什么位置、和谁/什么互动、拿取/使用/观察了什么、哪句话或动作触发了什么后果。\"}";
}

export function buildEpisodeScriptSystemPrompt() {
  return "你是 AI Space 的短剧编剧。根据【最终有效创意】、【剧本摘要】、【完整剧本大纲 / 全部分集】和【本次要生成正文的分集】生成该集正文。优先级：最终有效创意 > 完整剧本大纲 > 本集分集简介；不得只根据本集简介自由发挥，不得改写用户指定的剧情流程、关键桥段、人物关系、规则和结尾钩子。不要输出小说散文，要输出可直接拆分镜的影视剧本。不要 Markdown 代码块。必须输出严格 JSON：{\"episode\":1,\"title\":\"第1集\",\"script\":\"给人阅读的完整剧本正文\",\"scenes\":[{\"scene\":1,\"title\":\"场景标题\",\"location\":\"地点\",\"time\":\"时间\",\"characters\":[\"角色A\"],\"visual_action\":\"画面动作，必须可拍、可拆分镜，不写小说心理描写\",\"dialogue\":[{\"character\":\"角色A\",\"text\":\"台词\",\"tone\":\"语气/动作状态\"}],\"narration\":\"旁白，可为空\",\"emotion\":\"本场情绪推进\",\"hook\":\"本场悬念/转场钩子\"}]}。script 必须按统一格式组织：第N集：标题；每场使用『场1｜地点｜时间｜人物』；下面依次写【画面动作】【对白】【旁白】【情绪推进】【悬念钩子】。scenes 必须与 script 内容一致，后续资产、分镜图和视频提示词会优先读取 scenes。";
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
