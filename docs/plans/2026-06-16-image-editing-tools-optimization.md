# AI Space 六大图片编辑工具优化方案

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 将 `/create` 六大图片编辑工具从“单次模型/脚本处理”升级为“工具级专业编辑流水线”，让背景移除、背景替换、文字移除、画质高清、局部重绘、区域涂抹都更精准、更可控、更稳定。

**Architecture:** 保留现有六工具入口和历史任务体系，在后端增加图片理解预处理、工具意图层、模型/算法路由层、后处理质检层。严格保真类工具优先使用本地确定性处理；生成/创意类工具按任务选择 OpenAI、Seedream、Flux/SDXL/本地模型等 provider。

**Tech Stack:** Next.js `/create` 工具页、Go backend image handler/service、Python OpenCV/rembg/SAM/OCR/ESRGAN scripts、OpenAI Images Edit、Seedream/Volcengine image generation、future provider adapters.

---

## 1. 当前判断

当前 AI Space 六大图片工具的关键优化点不是单纯“接更多模型”，而是：

1. **工具语义需要更细。**
   - 画质高清要区分“保真增强”和“AI 高清/超分”。
   - 区域涂抹要明确是“删除并修复背景”，不是创意生成。
   - 局部重绘要区分替换、修改、新增、修复。
   - 背景替换要区分纯色、电商、摄影棚、真实环境、风格化背景。

2. **需要多阶段流水线。**

   ```text
   上传/选择图片
    → 图片理解/类型识别
    → 目标/mask/OCR/主体识别
    → 工具意图解析
    → 模型/算法路由
    → 编辑执行
    → 后处理融合/修边/尺寸回写
    → 自动质检/必要时重试
   ```

3. **多模型应服务于功能精度。**
   - OpenAI/Seedream/Flux 等生成模型不能替代所有工具。
   - 背景移除、文字移除、保真高清等工具仍应以确定性/局部处理为主。
   - Seedream/OpenAI 等更适合生成背景、创意重绘、参考图资产生成。

---

## 2. 建议新增通用能力

### 2.1 图片理解预处理层

每次上传图片后，可选做一次轻量分析，生成结构化 metadata：

```json
{
  "image_type": "portrait | product | screenshot | poster | anime | photo | document",
  "main_subjects": ["person", "bag", "chair"],
  "has_text": true,
  "has_face": true,
  "has_transparency": false,
  "background_complexity": "low | medium | high",
  "recommended_tools": ["remove-bg", "text-removal"]
}
```

用途：

- 背景移除根据人像/商品/动物/动漫选择不同 matting 模型。
- 文字移除根据截图/海报/水印/字幕选择不同 OCR 和 inpaint 策略。
- 画质高清根据人脸/动漫/文字截图选择不同增强方式。
- 背景替换根据商品/人像自动补接触阴影、光照匹配。

### 2.2 工具意图层

在后端引入 normalized intent：

```ts
type ImageEditIntent =
  | "remove_background"
  | "replace_background"
  | "remove_text"
  | "faithful_enhance"
  | "ai_upscale"
  | "local_replace"
  | "local_modify"
  | "local_add"
  | "local_repair"
  | "object_remove_repair";
```

前端可以仍然保持六个工具，内部根据用户选择/子模式映射到更细意图。

### 2.3 模型/算法路由层

后端根据工具、图片类型、mask 覆盖、用户 prompt、质量模式选择处理器。

示例：

```text
remove-bg + portrait       → portrait matting / hair matting
remove-bg + product        → RMBG/BiRefNet/rembg + edge cleanup
replace-bg + product       → local cutout + Seedream/OpenAI background + local composite + shadow
text-removal + screenshot  → OCR + icon protection + OpenCV inpaint
text-removal + poster text → OCR mask + generative inpaint
upscale + face photo       → face restore + background enhance
upscale + anime            → anime upscaler
inpaint + precise replace  → OpenAI Images Edit
inpaint + creative style   → Seedream/Flux if mask edit is verified
region-brush               → object removal prompt + inpaint + residual check
```

### 2.4 后处理与自动质检层

每个工具增加结果检查：

| 工具 | 质检项 |
|---|---|
| 背景移除 | 输出尺寸、alpha 非空、主体面积合理、边缘是否过脏 |
| 背景替换 | 输出尺寸、主体像素/构图保真、背景无额外主体、边缘融合 |
| 文字移除 | OCR 是否仍读到目标文字、mask 是否过大、图标是否被误删 |
| 画质高清 | 尺寸/倍率正确、人脸不崩、文字不变形、锐化不过度 |
| 局部重绘 | 非 mask 区域是否变化、目标是否被替换/修改 |
| 区域涂抹 | 是否仍有残影、是否生成新物体、背景纹理是否断裂 |

必要时自动二次处理：扩大 mask、换 prompt、切换模型或降级到保守路径。

---

## 3. 六大工具优化方案

## 3.1 背景移除

### 当前目标

严格语义：只去除背景，保留原主体像素和视觉尺寸，不走整图生成式重绘。

### 建议优化

1. **按图片类型选择抠图模型。**

   | 图片类型 | 策略 |
   |---|---|
   | 人像 | 人像 matting / hair matting |
   | 商品 | RMBG/BiRefNet/rembg + 硬边优化 |
   | 动物 | SAM/SAM2 + matting |
   | 动漫/插画 | anime segmentation / SAM |
   | 透明物体 | alpha 边缘修正 |
   | 复杂背景 | 多模型 mask 投票或用户补抠 |

2. **增加边缘后处理。**
   - feather / alpha smooth
   - remove white fringe
   - remove black fringe
   - edge decontamination
   - foreground color recovery

3. **增加手动补抠/擦除。**
   - 自动抠图后，用户可以涂抹“保留/删除”。
   - 输出更新后的 alpha mask。

4. **增加模式预设。**
   - 标准
   - 精细毛发
   - 商品硬边
   - 去白边
   - 去黑边

### 不建议

- 不要默认用 OpenAI/Seedream 处理背景移除。
- 不要为了透明背景把整张图送进生成模型，否则会发生主体重绘、构图放大、边缘漂移。

### 验收标准

- 输出 PNG/RGBA 视觉尺寸等于输入视觉尺寸。
- 非背景主体不被明显重绘。
- 人像毛发/商品边缘比当前更干净。
- 提供 mask/alpha 可视化或调试输出。

---

## 3.2 背景替换

### 当前目标

替换背景，但主体像素、位置、尺寸和视觉构图尽量保持原样。

### 建议流水线

```text
原图
 → 本地抠主体 alpha
 → 背景 prompt 改写
 → OpenAI/Seedream/Flux 生成纯背景层
 → 背景 cover-crop 到原图尺寸
 → 原主体 alpha composite 回去
 → 光照/色调/阴影/边缘融合
```

### 建议优化

1. **背景模型路由。**

   | 需求 | 推荐路线 |
   |---|---|
   | 纯色/渐变/证件照 | 本地生成背景，不调用模型 |
   | 电商白底/摄影棚 | Seedream/OpenAI 背景 + 接触阴影 |
   | 写实环境 | Seedream/OpenAI/Flux 背景生成 |
   | 风格化场景 | Seedream/Flux |
   | 品牌海报背景 | OpenAI/Seedream + 模板 prompt |

2. **自动改写背景 prompt。**

   用户输入：

   ```text
   沙滩夕阳
   ```

   系统改写：

   ```text
   Create only an empty background scene: beach at sunset, no people, no animals,
   no product, no foreground subject, no main object. Natural lighting, clean background,
   suitable for compositing the original subject.
   ```

3. **增加光照和色调匹配。**
   - 估计主体主光方向/色温。
   - 背景 prompt 加光照方向。
   - 合成后对主体做轻微色温/对比度匹配。
   - 增加边缘环境光 light wrap。

4. **增加接触阴影。**
   - 商品/人物站地时自动添加 soft contact shadow。
   - 可选“无阴影/自然阴影/强阴影”。

5. **背景模板。**
   前端增加快捷模板：
   - 纯色
   - 渐变
   - 电商白底
   - 摄影棚
   - 办公室
   - 家居
   - 城市街景
   - 沙滩
   - 国风
   - 电影感
   - 赛博朋克

### 不建议

- 不要把整张原图直接送进生成模型让它“换背景”。
- Seedream/OpenAI 在此工具中应优先用于生成背景层，不应重绘主体。

### 验收标准

- 输出尺寸等于输入视觉尺寸。
- 主体位置/大小不变。
- 背景没有生成额外人物/主体。
- 主体边缘无明显白边/黑边。
- 商品/人物与地面关系更自然。

---

## 3.3 文字移除

### 当前目标

自动或手动移除文字、水印、字幕、题字，同时尽量不破坏图标、人物、背景内容。

### 建议流水线

```text
原图
 → OCR/文字区域检测
 → 文字 mask 可视化
 → 用户确认/调整
 → mask 扩张/羽化
 → 局部 inpaint
 → OCR/残影检测
 → 必要时二次修复
```

### 建议优化

1. **增加 OCR 识别预览。**
   - 显示将被删除的文字区域。
   - 用户可取消某些区域。
   - 支持“只移除选中的文字”。

2. **增加三种模式。**
   - 自动移除全部文字
   - 只移除水印/字幕
   - 手动框选/涂抹文字

3. **按文字类型选择策略。**

   | 类型 | 策略 |
   |---|---|
   | 截图文字 | OCR mask + 图标保护 + OpenCV inpaint |
   | 字幕 | 横向区域检测 + 背景纹理修复 |
   | 半透明水印 | 低对比增强检测 + mask 扩张 |
   | 黑板/粉笔字 | 高召回浅色笔画检测 |
   | 海报大标题 | OCR mask + 生成式 inpaint |
   | 场景招牌 | 默认不删，除非用户选中 |

4. **残影二次检测。**
   - 移除后再次 OCR 或笔画检测。
   - 若仍有文字痕迹，扩大 mask 二次 inpaint。

5. **图标/内容保护。**
   - 对截图/桌面图标场景，过滤饱和图标、方形图标、大块 UI 元素。
   - 避免文字 mask 与图标连通后吞掉图标。

### 不建议

- 不要默认把整图送给生成模型重绘。
- 不要要求用户必须输入“要删除什么文字”；默认应可自动全文字移除。

### 验收标准

- 常规水印/字幕可自动清理。
- 截图中的图标和 UI 元素不被误删。
- 黑板/粉笔字场景召回提升。
- 海报大字可使用更强 inpaint，但非 mask 区域不明显变化。

---

## 3.4 画质高清

### 当前问题

“画质高清”语义混合：用户可能期待原尺寸保真增强，也可能期待 2x/4x AI 超分、修脸、老照片修复、动漫高清。建议拆分。

### 建议拆成两个主模式

#### A. 保真增强

目标：

```text
不改变尺寸，不改变内容，只提升清晰度/对比/噪声表现。
```

技术：

- denoise
- JPEG artifact removal
- mild CLAHE
- mild sharpening
- same-size output

适合：

- 截图
- 商品图
- 普通照片
- 用户要求“不要变样”

#### B. AI 高清 / 超分

目标：

```text
允许生成细节，可 2x/4x 放大，但需要提示可能轻微改变内容。
```

技术：

- Real-ESRGAN / SwinIR
- GFPGAN / CodeFormer for faces
- anime upscaler
- SD upscale / OpenAI/Seedream 重绘增强（可选）

适合：

- 模糊头像
- 老照片
- 动漫图
- AI 生成图二次高清
- 商品细节增强

### 建议自动路由

| 图片类型 | 推荐处理 |
|---|---|
| 人脸照片 | face restore + 背景轻度增强 |
| 商品图 | Real-ESRGAN + 边缘锐化 |
| 动漫/插画 | anime upscaler |
| 文字截图 | 保真增强，禁止生成式重绘文字 |
| 老照片 | 去噪/修复/可选上色 |
| AI 图 | AI 高清重绘可选 |

### 前端建议

增加：

- 保真增强
- AI 高清 2x
- AI 高清 4x
- 人脸修复
- 动漫高清
- 老照片修复

或者用简化版：

- 保真
- 标准
- 强力

### 验收标准

- 保真增强模式输出尺寸不变。
- AI 超分模式按选择输出 2x/4x。
- 文字截图不出现文字扭曲。
- 人脸修复不产生明显假脸/崩脸。

---

## 3.5 局部重绘

### 当前目标

用户涂抹局部区域后，按描述替换/修改/新增/修复该区域，非选区尽量保持不变。

### 建议流水线

```text
用户涂抹
 → 识别选中对象/区域
 → SAM/GrabCut/vision bbox 精修 mask
 → 用户确认
 → 选择编辑类型
 → prompt 结构化
 → 模型路由执行
 → 输出尺寸回写/非 mask 区域保护
```

### 建议新增编辑类型

1. **替换物体**
   - “把杯子换成花瓶”
   - mask 需要比物体轮廓略大。

2. **修改属性**
   - “把衣服改成红色”
   - mask 应贴近物体，少扩张。

3. **新增内容**
   - “在桌上加一杯咖啡”
   - mask 可为目标放置区域，不一定是现有物体。

4. **修复瑕疵**
   - “修掉污点/划痕/破损”
   - 可使用本地修复或轻量 inpaint。

### mask 策略

- 替换物体：`精细轮廓 + 用户涂抹 bounds 扩张 + feather`
- 修改属性：`精细轮廓 + 小 feather`
- 新增内容：`用户涂抹区域 + prompt 约束`
- 修复瑕疵：`原始涂抹区域 + 小扩张`

### 模型路由

| 需求 | 推荐模型/算法 |
|---|---|
| 精准局部替换 | OpenAI Images Edit |
| 创意风格重绘 | Seedream/Flux，需先验证 mask edit 能力 |
| 商品局部修复 | OpenAI/SDXL Inpaint |
| 人脸局部修复 | face restoration / dedicated inpaint |
| 颜色/材质修改 | mask edit + prompt |
| 小瑕疵 | OpenCV/LaMa/local inpaint |

### Prompt 规范

局部重绘默认 prompt 应强化：

```text
Only edit the selected transparent/masked area. Replace the original masked content completely.
Preserve all unmasked areas exactly. Do not add the requested object outside the selected area.
```

### 验收标准

- 识别阶段显示对象 label 和 mask 覆盖率。
- 替换物体时原物体不残留，新物体不跑到 mask 外。
- 非 mask 区域视觉变化最小。
- 大图输出尺寸回写到原图尺寸。

---

## 3.6 区域涂抹

### 当前目标

用户涂抹对象或区域后，删除该内容并自然补齐背景。它不是创意重绘，而是内容识别填充/修复。

### 建议流水线

```text
用户涂抹
 → 识别对象/区域
 → mask 精修 + 自动包含阴影/反射
 → 删除语义 prompt 固化
 → inpaint/repair
 → 残影检测
 → 必要时二次扩大修复
```

### 建议优化

1. **固化删除语义。**

   默认 prompt：

   ```text
   Remove the selected object completely. Fill the area naturally using the surrounding background.
   Do not add new objects. Preserve all unmasked areas exactly.
   ```

2. **自动包含阴影和反射。**
   - 删除物体时，紧贴物体的阴影/反射应一并纳入 mask。
   - 提供选项：
     - 只移除涂抹区域
     - 自动包含阴影
     - 强力清除残影

3. **按背景类型选择修复方式。**

   | 背景类型 | 策略 |
   |---|---|
   | 纯色/渐变 | 本地修复 |
   | 天空/墙面/草地 | inpaint + texture continuity |
   | 人群/复杂场景 | 生成式 inpaint |
   | 规则纹理 | patch/texture synthesis |
   | 商品图 | 保守修复，避免改主体 |

4. **残影二次检测。**
   - 检查 mask 边缘附近是否有原物体颜色/轮廓残留。
   - 失败时扩大 mask 再修复。

### 验收标准

- 删除后不生成新物体。
- 阴影/残影明显减少。
- 非选区变化小。
- 对纯色背景可快速本地处理，不必调用大模型。

---

## 4. Provider / 模型接入原则

### 4.1 不要按品牌绑定工具

不要设计成：

```text
这个工具 = Seedream
那个工具 = OpenAI
```

应该设计成：

```text
工具意图 + 图片类型 + mask 状态 + 用户模式 → provider route
```

### 4.2 推荐 provider 分工

| 能力 | 推荐候选 |
|---|---|
| 语义理解/对象识别 | GPT Vision / Qwen-VL / Gemini Vision |
| 精准分割 | SAM/SAM2/GrabCut/BiRefNet/rembg |
| OCR | PaddleOCR / Tesseract / CRAFT + OCR |
| 局部精准编辑 | OpenAI Images Edit |
| 创意生成/背景生成 | Seedream / OpenAI / Flux |
| 高分辨率修复 | Real-ESRGAN / SwinIR / CodeFormer / GFPGAN |
| 本地修复 | OpenCV inpaint / LaMa / patchmatch |
| 合成融合 | OpenCV/PIL/Poisson/light-wrap/shadow |

### 4.3 Seedream 的合理位置

Seedream 适合：

- 文生图
- 参考图资产生成
- 背景替换中的“纯背景层生成”
- 风格化/创意局部重绘（前提：mask edit 能力验证通过）

Seedream 不应默认替代：

- 背景移除
- 保真画质增强
- 严格文字移除
- 像素保真的局部修复

### 4.4 OpenAI 的合理位置

OpenAI Images Edit 适合：

- 精准局部替换
- 局部重绘
- 复杂区域修复
- 海报大字移除后的生成式补图

但也要注意：

- mask 必须与 source 同尺寸。
- provider mask 语义必须规范化。
- 输出尺寸需要回写到原图尺寸。
- 非 mask 区域仍可能有轻微变化，需要质检。

---

## 5. 前端产品改造建议

### 5.1 保持六个主入口不变

入口仍是：

- 背景移除
- 背景替换
- 文字移除
- 画质高清
- 局部重绘
- 区域涂抹

不要把复杂 provider 暴露给普通用户。

### 5.2 增加少量“模式/强度”

每个工具只暴露必要选项。

示例：

#### 背景移除

- 标准
- 精细毛发
- 商品硬边
- 去白边/黑边

#### 背景替换

- 纯色/渐变
- 电商摄影棚
- 真实场景
- 风格化场景
- 自定义描述

#### 文字移除

- 自动全部
- 只删水印/字幕
- 手动选择

#### 画质高清

- 保真增强
- AI 高清 2x
- AI 高清 4x
- 人脸修复
- 动漫高清

#### 局部重绘

- 替换
- 修改
- 新增
- 修复

#### 区域涂抹

- 标准删除
- 包含阴影
- 强力清除残影

### 5.3 增加 mask/识别预览

必须优先加到：

- 文字移除
- 局部重绘
- 区域涂抹
- 背景移除二次编辑

用户需要知道 AI 到底选中了哪里。

---

## 6. 后端改造建议

### 6.1 新增 image analysis service

建议文件：

- `backend/internal/services/image_analysis_service.go`
- `backend/scripts/analyze_image.py`

职责：

- 检测 image_type
- 检测 face/text/subject
- 输出结构化 metadata

### 6.2 新增 image edit router

建议文件：

- `backend/internal/services/image_edit_router.go`

职责：

- 将 `edit_mode + sub_mode + image_metadata + mask_metadata` 转成处理计划。

示例结构：

```go
type ImageEditPlan struct {
    Intent       string
    Provider     string
    LocalScript  string
    Model        string
    RequiresMask bool
    PostProcess  []string
    QualityCheck []string
}
```

### 6.3 保留现有任务表

不建议为每个工具新建表。继续复用 `image_generations` / existing history。

可在 metadata 或新增轻量字段中记录：

- `edit_mode`
- `sub_mode`
- `provider`
- `source_image_type`
- `mask_coverage`
- `pipeline_steps`
- `quality_check_status`

### 6.4 Python 脚本扩展

建议新增/扩展：

- `scripts/remove_background.py`
  - 增加 model preset / edge cleanup
- `scripts/replace_background.py`
  - 增加 light wrap / shadow / color match
- `scripts/remove_text.py`
  - OCR 可选、mask 输出、residual check
- `scripts/enhance_quality.py`
  - faithful enhance 模式保留
- `scripts/upscale_ai.py`
  - 新增 AI 超分模式
- `scripts/refine_mask.py`
  - 支持 intent-aware mask expansion
- `scripts/quality_check.py`
  - 各工具结果质检

---

## 7. 实施优先级

## P0：最高优先级

### P0-1. 画质高清拆分语义

- 保真增强：原尺寸，不改变内容。
- AI 高清：2x/4x，可生成细节。

原因：当前用户最容易混淆“清晰化”和“超分重绘”。

### P0-2. 背景替换升级合成质量

- 背景模型路由。
- 背景-only prompt 改写。
- 色调/光照匹配。
- 接触阴影。
- 边缘融合。

原因：收益最大，Seedream/OpenAI 都能发挥作用，但不破坏主体。

### P0-3. 文字移除增加 OCR/mask 预览

- 自动识别文字区域。
- 展示将删除区域。
- 支持用户取消/手动选择。

原因：减少误删，提高可控性。

### P0-4. 局部重绘/区域涂抹增加编辑类型

- 局部重绘：替换/修改/新增/修复。
- 区域涂抹：标准删除/包含阴影/强力清残影。

原因：当前不同编辑语义混在一起，模型容易误解。

### P0-5. 增加工具级模型路由器

先不实现所有模型，但先把架构做出来，让每个工具能按意图路由到不同处理器。

---

## P1：第二优先级

1. 背景移除支持人像/商品/动物/动漫 preset。
2. 区域涂抹自动包含阴影/反射。
3. 局部重绘 mask 自动扩张策略按 intent 区分。
4. 生成后自动质检/自动重试。
5. 六工具统一增加保守/标准/强力强度档。

---

## P2：后续增强

1. 多模型效果对比。
2. 用户可手动选择 provider/model。
3. ComfyUI/Flux/SDXL 本地工作流。
4. 专业级 mask 编辑器：套索、矩形、羽化半径、反选。
5. 批量处理能力。

---

## 8. 建议任务拆分

### Task 1: 梳理并落地 edit sub-mode schema

**Objective:** 在前后端定义六工具的子模式和 intent 映射，不改变现有功能行为。

**Files:**

- Modify: `frontend/app/(main)/(creative)/image/edit/page.tsx`
- Modify: `backend/internal/api/image.go`
- Create: `backend/internal/services/image_edit_router.go`

**Verification:**

- 现有六工具仍可提交。
- 请求 payload 中可携带 `sub_mode` / `intent`。
- 后端未知 sub_mode 能安全回退现有逻辑。

### Task 2: 画质高清拆分为保真增强和 AI 高清入口

**Objective:** 前端增加模式选择，后端先保留 faithful enhance，AI 高清可先走 placeholder/feature flag。

**Files:**

- Modify: `frontend/app/(main)/(creative)/image/edit/page.tsx`
- Modify: `backend/scripts/enhance_quality.py`
- Create: `backend/scripts/upscale_ai.py` 或预留 router 分支

**Verification:**

- 保真增强输出尺寸不变。
- AI 高清模式不会误走保真文案。

### Task 3: 背景替换增加背景-only prompt rewrite 与 provider route

**Objective:** 背景替换生成背景层时使用更严格 prompt，并支持路由到 Seedream/OpenAI 等背景生成 provider。

**Files:**

- Modify: `backend/internal/api/image.go`
- Modify: `backend/internal/services/image_service.go`
- Modify: `backend/scripts/replace_background.py`

**Verification:**

- 背景生成 prompt 禁止人物/主体。
- 合成输出尺寸等于原图。
- 主体未被生成模型重绘。

### Task 4: 背景替换加入光照/阴影/色调融合

**Objective:** 在本地合成阶段增加可控融合后处理。

**Files:**

- Modify: `backend/scripts/replace_background.py`

**Verification:**

- 商品/人物底部有自然接触阴影。
- 边缘白边/黑边减少。
- 可通过参数关闭增强。

### Task 5: 文字移除增加 OCR/mask preview API

**Objective:** 在正式移除前返回文字 mask 和区域 metadata，前端展示预览。

**Files:**

- Create: `backend/scripts/detect_text_mask.py`
- Modify: `backend/internal/api/image.go`
- Modify: `frontend/app/(main)/(creative)/image/edit/page.tsx`

**Verification:**

- 上传文字图后可看到待移除区域。
- 用户确认后再执行移除。
- 截图图标不被 mask 大面积吞掉。

### Task 6: 局部重绘/区域涂抹 intent-aware mask expansion

**Objective:** 根据替换/修改/删除/修复意图使用不同 mask 扩张策略。

**Files:**

- Modify: `frontend/app/(main)/(creative)/image/edit/page.tsx`
- Modify: `backend/scripts/refine_mask.py`
- Modify: `backend/internal/api/image.go`

**Verification:**

- 替换物体时 mask 比轮廓略大。
- 修改属性时 mask 更贴合。
- 区域涂抹包含阴影选项能扩大底部/边缘修复区域。

### Task 7: 增加结果质检与自动重试框架

**Objective:** 先实现框架和最基础检查，再逐步扩充每个工具的检查项。

**Files:**

- Create: `backend/scripts/quality_check.py`
- Create: `backend/internal/services/image_quality_check.go`
- Modify: `backend/internal/api/image.go`

**Verification:**

- 每次编辑记录 quality check metadata。
- 尺寸不匹配能被拦截。
- 文字移除后可选执行 OCR residual check。

---

## 9. 验证命令

### Frontend

```bash
cd frontend
npm run build
```

### Backend

```bash
cd backend
go test ./internal/api ./internal/services
go build -o aipool ./cmd/main.go
```

### Python scripts

对每个 touched script 准备 fixture：

```bash
python3 scripts/remove_background.py --input fixtures/person.jpg --output /tmp/remove-bg.png
python3 scripts/replace_background.py --input fixtures/product.jpg --background fixtures/bg.jpg --output /tmp/replace-bg.png
python3 scripts/remove_text.py --input fixtures/text.png --output /tmp/remove-text.png
python3 scripts/enhance_quality.py --input fixtures/photo.jpg --output /tmp/enhance.png
python3 scripts/refine_mask.py --image fixtures/object.jpg --mask-data '<data-url>'
```

### API smoke

- `/api/images/edit` 六个 mode 都能创建任务。
- pending → completed/failed 状态可查询。
- 输出 URL 可访问。
- 输出尺寸与模式预期一致。

---

## 10. 非目标

本阶段不做：

- 一次性替换所有工具模型。
- 把 Seedream/OpenAI 暴露成复杂模型选择器给普通用户。
- 为每个工具新建独立历史表。
- 删除现有本地脚本路径。
- 牺牲像素保真来追求生成式效果。

---

## 11. 最终目标

用户看到的仍然是六个简单工具：

```text
背景移除 / 背景替换 / 文字移除 / 画质高清 / 局部重绘 / 区域涂抹
```

但背后变成六条专业编辑流水线：

```text
识别 → mask/主体/OCR → 意图解析 → 模型路由 → 编辑 → 融合 → 质检
```

这样才能真正让功能效果提升，而不是简单堆模型。
