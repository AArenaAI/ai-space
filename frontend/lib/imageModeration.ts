/**
 * gpt-image-2 违禁内容检测工具
 * 在用户发送图片生成请求前做前端检测，避免触发 OpenAI 安全审核
 *
 * 设计原则：
 * - 中文 pattern 不使用 \b 单词边界（JavaScript 的 \b 不支持中文）
 * - 英文 pattern 保留 \b
 * - 组合检测：同时命中多个类别关键词时触发（写实+暴力的组合比单一名词更危险）
 * - 语义范围检测：根据上下文判断风险等级
 */

export interface ModerationMatch {
  category: string;
  matchedWords: string[];
  reason: string;
  level: 'block' | 'warning';
}

type ComboRule = {
  name: string;
  category: string;
  reason: string;
  require: number; // need at least this many of the groups to match
  groups: RegExp[]; // each is a regex; at least 'require' groups must match
};

// ============================================================
// 1. 单次匹配违禁词（命中即拦截）
// ============================================================
const FORBIDDEN_PATTERNS: { pattern: RegExp; category: string; reason: string; level?: 'block' | 'warning' }[] = [
  // ==================== 未成年人保护（最严格） ====================
  // 任何未成年人 + 不当内容的组合（单个词也拦截，因为很容易组合）
  { pattern: /(儿童色情|儿童裸露|儿童裸体|儿童性|恋童|娈童|幼女色情)/i, category: "未成年人", reason: "涉及未成年人的性内容为绝对禁止，OpenAI 安全策略零容忍" },
  { pattern: /(未成年人|未成年|青少年|儿童|幼女|少女|小男孩|小女孩|萝莉|小学生|初中生|高中生|校服|制服).*(裸|色情|性感|sex|nude|sexy|诱惑|挑逗|露|擦边|恋爱|约会|亲密)/i, category: "未成年人", reason: "prompt 将未成年人/学生与成人化、性化内容关联，OpenAI 安全策略严格禁止" },
  { pattern: /(裸|色情|性感|sex|nude|撩人|诱惑|挑逗|ang).*(未成年人|未成年|儿童|幼女|学生|萝莉|少女|初中生|高中生|校服)/i, category: "未成年人", reason: "prompt 将成人化内容与未成年人关联，OpenAI 安全策略严格禁止" },
  { pattern: /\\b(underage|minor|child|teen|teenager|girl|boy|kid|toddler|infant|babys|youth)\\b.*\\b(nude|naked|sexy|erotic|sexual|porn|explicit|lingerie|bikini|undress|stripper|seductive|provocative)\\b/i, category: "未成年人", reason: "Minors combined with adult/sexualized content — strictly prohibited by OpenAI safety policy" },
  { pattern: /\\b(underage|minor|child|teen|teenager|kid|youth|schoolgirl|schoolboy|student|uniform)\\b.*\\b(date|dating|kiss|romance|boyfriend|girlfriend|love.?scene)\\b/i, category: "未成年人", reason: "Minors associated with romantic/dating content — OpenAI has strict restrictions on such depictions" },
  // 单独 "未成年" 相关词也拦截（防绕过）
  { pattern: /\\b(underage|minor)\\b/i, category: "未成年人", reason: "prompt 涉及未成年人相关内容，OpenAI 安全策略对此有严格限制" },

  // ==================== Deepfake / 真人伪造 ====================
  { pattern: /(deepfake|deep.?fake|换脸|AI换脸)/i, category: "Deepfake", reason: "prompt 涉及 Deepfake/AI 换脸，OpenAI 安全策略严格禁止此类内容" },
  { pattern: /(明星|名人|网红|主播|政客|总统).*(裸|裸体|ang|脱|不雅|床照|露点|裸照|nude)/i, category: "Deepfake", reason: "prompt 试图生成真实人物的不当/色情内容，OpenAI 安全策略严格禁止" },
  { pattern: /(nude|naked|undress|ang).*(celebrity|actor|actress|star|politician|influencer|streamer|president|famous|public.?figure)/i, category: "Deepfake", reason: "Prompt attempts to generate nude/inappropriate content of real persons — strictly prohibited" },
  { pattern: /(给.*脱衣|脱.*衣服|脱光|P图|PS|伪造照片|合成照片)/i, category: "Deepfake", reason: "prompt 涉及伪造/合成真人图像，OpenAI 安全策略严格禁止" },
  { pattern: /\\b(fake|forged|manipulated|photoshop|deepfake)\\b.*\\b(photo|image|picture|video|nude|naked|ang)\\b/i, category: "Deepfake", reason: "Prompt involves forged/manipulated media of real persons — strictly prohibited" },

  // ==================== 暴力/色情的极端组合 ====================
  { pattern: /(强迫|强奸|迷奸|qiangjian|迷.*药|下药|捆绑|虐待|SM|BDSM|施虐|受虐)/i, category: "性暴力", reason: "prompt 中包含强迫/暴力性内容，OpenAI 安全策略严格禁止非自愿性内容" },
  { pattern: /\\b(rape|non.?consent|forced|drugged|tied.?up|bondage|sadism|masochism|torture|abuse|humiliation)\\b/i, category: "性暴力", reason: "Prompt contains non-consensual/violent sexual content — strictly prohibited" },
  { pattern: /(血腥|写实.*血|真实.*血|超写实.*血|血.*肉|内脏|器官|血肉模糊|血淋淋|血浆)/i, category: "极端血腥", reason: "prompt 中包含超写实血腥/内脏内容，OpenAI 安全策略会严格限制此类图像" },
  { pattern: /\\b(realistic|photorealistic|hyper.?realistic)\\b.*\\b(gore|blood|bleeding|wound|corpse|dismember|decapitate|eviscerate|flay|butcher)\\b/i, category: "极端血腥", reason: "Prompt combines photorealistic style with extreme gore — highly likely to be blocked" },
  { pattern: /(断头|砍头|腰斩|五马分尸|分尸|碎尸|开膛|挖眼|割喉)/i, category: "极端血腥", reason: "prompt 中包含极端暴力血腥内容，OpenAI 安全策略严格禁止" },

  // ==================== 违法犯罪内容 ====================
  { pattern: /(制毒|制毒教程|制造毒品|毒品制作|冰毒制作|炸弹制作|炸弹教程|造炸弹|爆炸物制作|武器制作|3D打印枪)/i, category: "违法犯罪", reason: "prompt 中包含违法物品制造相关内容，OpenAI 安全策略严格禁止" },
  { pattern: /\\b(drug.?manufacture|how.?to.?make.?bomb|explosive.?tutorial|weapon.?crafting|3D.?print.?gun|ghost.?gun)\\b/i, category: "违法犯罪", reason: "Prompt contains illegal item manufacturing instructions — strictly prohibited" },
  { pattern: /(伪造证件|假证|假身份证|假护照|假驾照|造假币|假币|伪造货币|诈骗教程|黑客教程|网络攻击教程)/i, category: "违法犯罪", reason: "prompt 中包含伪造证件/诈骗/违法教程内容，OpenAI 安全策略严格禁止" },
  { pattern: /(儿童|幼女|未成年人).*(犯罪|伤害|虐待|暴力|色情|裸|杀害)/i, category: "违法犯罪/未成年人", reason: "prompt 涉及未成年人的犯罪/虐待内容，OpenAI 安全策略零容忍" },
  { pattern: /\\b(child.*abuse|child.*porn|child.*exploit|minor.*abuse|child.*traffick|child.*safety)\\b/i, category: "违法犯罪/未成年人", reason: "Content involving child exploitation — OpenAI has zero tolerance policy" },

  // ==================== 政治造假 / 误导 ====================
  { pattern: /(伪造|捏造|编造|假新闻|fake.*news).*(新闻|照片|视频|现场|报道|犯罪|逮捕|吸毒|坐牢|监狱|丑闻|丑事)/i, category: "政治造假", reason: "prompt 涉及伪造政治/新闻内容，OpenAI 安全策略严格禁止误导性内容" },
  { pattern: /(特朗普|拜登|习近平|普京|总统|总理|主席|King|Queen).*(吸毒|犯罪|逮捕|监狱|坐牢|丑闻|裸照|不雅|伪造)/i, category: "政治造假", reason: "prompt 涉及政治人物的虚假/丑化描述，OpenAI 安全策略拒绝生成误导性政治内容" },
  { pattern: /\\b(president|prime.?minister|premier|chancellor|king|queen|dictator)\\b.*\\b(fake|false|manipulated|propaganda|misinformation|arrest|drug|corrupt|scandal|nude)\\b/i, category: "政治造假", reason: "Prompt contains false/misleading depictions of political figures — strictly prohibited" },
  { pattern: /(选举|election|投票|vote).*(操纵|操控|篡改|造假|欺诈|fraud|rigged|fake|misinformation)/i, category: "政治造假", reason: "prompt 涉及选举操纵/造假内容，OpenAI 安全策略严格禁止" },

  // ==================== 自残/自杀美化 ====================
  { pattern: /(自残|自虐|自伤|割腕|割脉|上吊|跳楼|服毒|割肉|自焚)/i, category: "自伤", reason: "prompt 包含自伤/自残行为，OpenAI 安全策略严格禁止此类内容" },
  { pattern: /\\b(self.?harm|self.?hurt|self.?injure|self.?mutilate|suicide|cutting|self.?cut|hang.?self|overdose)\\b/i, category: "自伤", reason: "Prompt contains self-harm/suicide content — strictly prohibited" },
  { pattern: /(美化|鼓励|提倡|赞扬|歌颂|推荐).*(自杀|自残|自伤|割腕|上吊|跳楼|厌食|暴食)/i, category: "自伤美化", reason: "prompt 美化/鼓励自伤行为，OpenAI 安全策略严格禁止" },
  { pattern: /(厌食|暴食|催吐|厌食症|暴食症|eating.?disorder).*(瘦|骨感|体重|减肥|thin|skinny|weight.?loss)/i, category: "自伤", reason: "prompt 涉及饮食失调/极端减肥内容，OpenAI 安全策略可能拒绝" },

  // ==================== 色情（扩展） ====================
  { pattern: /(精液|射精|口交|肛交|阴道交|插入|抽插|潮吹|高潮|性高潮)/i, category: "色情", reason: "prompt 中包含明确性行为描述，OpenAI 安全策略严格禁止" },
  { pattern: /\\b(semen|ejaculate|fellatio|cunnilingus|penetrate|orgasm|climax|cum|thrust|anal|oral)\\b/i, category: "色情", reason: "Prompt contains explicit sexual descriptions — strictly prohibited" },
  { pattern: /(群交|多人性爱|乱交|杂交|3P|4P|NP|gangbang|orgy)/i, category: "色情", reason: "prompt 中包含群体性行为描述，OpenAI 安全策略严格禁止" },
  { pattern: /(偷拍|偷窥|露阴|暴露狂|窥阴|voyeur|up.?skirt|down.?blouse)/i, category: "色情", reason: "prompt 中包含偷拍/露阴内容，OpenAI 安全策略严格禁止" },
  { pattern: /\b(voyeur|upskirt|downblouse|creepshot|hidden.?camera|up.?skirt|down.?blouse)\b/i, category: "色情", reason: "Prompt contains voyeuristic/non-consensual imagery — strictly prohibited" },
  // 纯中文裸体词（无\b，独立拦截）
  { pattern: /(裸男|裸女|全裸|赤身裸体|一丝不挂|裸体|裸露|半裸|上身裸|下身裸)/i, category: "色情", reason: "prompt 包含裸露/裸体内容，OpenAI 安全策略对裸体图像有严格限制" },

  // ==================== 武器/暴力（扩展） ====================
  { pattern: /(ak47|ak-47|ar15|ar-15|m16|m4a1|冲锋枪|突击步枪|狙击步枪|自动步枪)/i, category: "武器", reason: "prompt 包含军用枪械型号，OpenAI 安全策略可能拦截武器相关内容" },
  { pattern: /\\b(ak-?47|ar-?15|m16|m4a1|assault.?rifle|sniper.?rifle|submachine.?gun|machine.?gun)\\b/i, category: "武器", reason: "Prompt contains military-grade firearm references — may be blocked" },

  // ==================== 仇恨/歧视（扩展） ====================
  { pattern: /(种族清洗|种族屠杀|种族灭绝|ethnic.?cleansing|genocide|大屠杀)/i, category: "仇恨内容", reason: "prompt 涉及种族灭绝/大屠杀内容，OpenAI 安全策略严格禁止" },
  { pattern: /(ISIS|伊斯兰国|基地组织|塔利班|恐怖组织|极端组织|恐怖分子)/i, category: "恐怖主义", reason: "prompt 涉及恐怖组织内容，OpenAI 安全策略严格禁止" },
  { pattern: /\\b(ISIS|Al.?Qaeda|Taliban|terrorist|extremist|jihadist|white.?supremacy|neo.?nazi)\\b/i, category: "仇恨内容", reason: "Prompt contains terrorist/extremist references — strictly prohibited" },

  // ==================== 版权角色/IP（系统内置拦截） ====================
  // === Marvel ===
  { pattern: /(Spider.?Man|蜘蛛侠)/i, category: "版权角色", reason: "「蜘蛛侠 (Spider-Man)」为 Marvel 版权角色，OpenAI 版权政策会拦截此类内容" },
  { pattern: /(Iron.?Man|钢铁侠)/i, category: "版权角色", reason: "「钢铁侠 (Iron Man)」为 Marvel 版权角色，OpenAI 版权政策会拦截此类内容" },
  { pattern: /(Captain.?America|美国队长)/i, category: "版权角色", reason: "「美国队长 (Captain America)」为 Marvel 版权角色，OpenAI 版权政策会拦截此类内容" },
  { pattern: /(Thor|雷神)/i, category: "版权角色", reason: "「雷神 (Thor)」为 Marvel 版权角色，OpenAI 版权政策会拦截此类内容" },
  { pattern: /(Hulk|绿巨人|浩克)/i, category: "版权角色", reason: "「绿巨人 (Hulk)」为 Marvel 版权角色，OpenAI 版权政策会拦截此类内容" },
  { pattern: /(Avenger|复仇者联盟)/i, category: "版权角色", reason: "「复仇者联盟 (Avengers)」为 Marvel 版权资产，OpenAI 版权政策会拦截" },
  { pattern: /(Black.?Widow|黑寡妇)/i, category: "版权角色", reason: "「黑寡妇 (Black Widow)」为 Marvel 版权角色，OpenAI 会拦截此类内容" },
  { pattern: /(Doctor.?Strange|奇异博士|奇怪博士)/i, category: "版权角色", reason: "「奇异博士」为 Marvel 版权角色，OpenAI 版权政策会拦截" },
  { pattern: /(Deadpool|死侍)/i, category: "版权角色", reason: "「死侍 (Deadpool)」为 Marvel 版权角色，OpenAI 版权政策会拦截" },
  { pattern: /(Wolverine|金刚狼|金钢狼)/i, category: "版权角色", reason: "「金刚狼 (Wolverine)」为 Marvel 版权角色，OpenAI 版权政策会拦截" },
  { pattern: /(Ant.?Man|蚁人)/i, category: "版权角色", reason: "「蚁人 (Ant-Man)」为 Marvel 版权角色，OpenAI 版权政策会拦截" },
  { pattern: /(Thanos|灭霸)/i, category: "版权角色", reason: "「灭霸 (Thanos)」为 Marvel 版权角色，OpenAI 版权政策会拦截" },
  { pattern: /(Loki|洛基)/i, category: "版权角色", reason: "「洛基 (Loki)」为 Marvel 版权角色，OpenAI 版权政策会拦截" },
  { pattern: /(Venom|毒液)/i, category: "版权角色", reason: "「毒液 (Venom)」为 Marvel 版权角色，OpenAI 版权政策会拦截" },
  { pattern: /(Marvel|漫威)/i, category: "版权角色", reason: "「Marvel/漫威」为版权方名称，OpenAI 版权政策会拦截相关内容" },
  // === DC ===
  { pattern: /(Superman|超人)/i, category: "版权角色", reason: "「超人 (Superman)」为 DC 版权角色，OpenAI 版权政策会拦截此类内容" },
  { pattern: /(Batman|蝙蝠侠)/i, category: "版权角色", reason: "「蝙蝠侠 (Batman)」为 DC 版权角色，OpenAI 版权政策会拦截此类内容" },
  { pattern: /(Wonder.?Woman|神奇女侠|神力女超人)/i, category: "版权角色", reason: "「神奇女侠 (Wonder Woman)」为 DC 版权角色，OpenAI 版权政策会拦截此类内容" },
  { pattern: /(Flash|闪电侠)/i, category: "版权角色", reason: "「闪电侠 (Flash)」为 DC 版权角色，OpenAI 版权政策会拦截此类内容" },
  { pattern: /(Green.?Lantern|绿灯侠)/i, category: "版权角色", reason: "「绿灯侠 (Green Lantern)」为 DC 版权角色，OpenAI 版权政策会拦截此类内容" },
  { pattern: /(Aquaman|海王)/i, category: "版权角色", reason: "「海王 (Aquaman)」为 DC 版权角色，OpenAI 版权政策会拦截此类内容" },
  { pattern: /(Joker|小丑)/i, category: "版权角色", reason: "「小丑 (Joker)」为 DC 版权角色，OpenAI 版权政策会拦截此类内容" },
  { pattern: /(Harley.?Quinn|小丑女|哈莉.?奎因)/i, category: "版权角色", reason: "「小丑女 (Harley Quinn)」为 DC 版权角色，OpenAI 版权政策会拦截" },
  { pattern: /(Lex.?Luthor|卢瑟)/i, category: "版权角色", reason: "「卢瑟 (Lex Luthor)」为 DC 版权角色，OpenAI 版权政策会拦截" },
  { pattern: /(DC.?Comics|DC漫画)/i, category: "版权角色", reason: "「DC 漫画」为版权方名称，OpenAI 版权政策会拦截相关内容" },
  // === 任天堂 ===
  { pattern: /(Mario|马里奥|玛利欧)/i, category: "版权角色", reason: "「马里奥 (Mario)」为任天堂版权角色，OpenAI 版权政策会拦截此类内容" },
  { pattern: /(Luigi|路易吉)/i, category: "版权角色", reason: "「路易吉 (Luigi)」为任天堂版权角色，OpenAI 版权政策会拦截此类内容" },
  { pattern: /(Pikachu|皮卡丘)/i, category: "版权角色", reason: "「皮卡丘 (Pikachu)」为任天堂/宝可梦公司版权角色，OpenAI 版权政策会拦截" },
  { pattern: /(Pokemon|宝可梦|精灵宝可梦|神奇宝贝|宠物小精灵)/i, category: "版权角色", reason: "「宝可梦 (Pokemon)」为任天堂/宝可梦公司版权资产，会触发 OpenAI 版权检测" },
  { pattern: /(Zelda|塞尔达|林克|Link)/i, category: "版权角色", reason: "「塞尔达传说」为任天堂版权游戏IP，OpenAI 版权政策会拦截" },
  { pattern: /(Nintendo|任天堂)/i, category: "版权角色", reason: "「任天堂 (Nintendo)」为版权方名称，OpenAI 版权政策会拦截相关内容" },
  { pattern: /(Kirby|星之卡比)/i, category: "版权角色", reason: "「星之卡比 (Kirby)」为任天堂/HAL 版权角色，OpenAI 会拦截" },
  // === 迪斯尼/皮克斯 ===
  { pattern: /(Mickey.?Mouse|米老鼠|米奇)/i, category: "版权角色", reason: "「米老鼠 (Mickey Mouse)」为迪士尼版权角色，OpenAI 版权政策会拦截此类内容" },
  { pattern: /(Minnie.?Mouse|米妮)/i, category: "版权角色", reason: "「米妮 (Minnie Mouse)」为迪士尼版权角色，OpenAI 版权政策会拦截此类内容" },
  { pattern: /(Winnie.?the.?Pooh|小熊维尼)/i, category: "版权角色", reason: "「小熊维尼」为迪士尼版权角色，OpenAI 版权政策会拦截此类内容" },
  { pattern: /(Elsa|安娜|Anna|Frozen|冰雪奇缘)/i, category: "版权角色", reason: "「冰雪奇缘 (Frozen)」角色为迪士尼版权资产，OpenAI 版权政策会拦截此类内容" },
  { pattern: /(Moana|莫阿娜|海洋奇缘)/i, category: "版权角色", reason: "「海洋奇缘 (Moana)」为迪士尼版权作品，OpenAI 版权政策会拦截" },
  { pattern: /(Simpson|辛普森)/i, category: "版权角色", reason: "「辛普森一家 (The Simpsons)」为迪士尼/20世纪版权资产，会触发 OpenAI 版权检测" },
  { pattern: /(Toy.?Story|玩具总动员|Woody|胡迪|Buzz.?Lightyear|巴斯光年)/i, category: "版权角色", reason: "「玩具总动员」为迪士尼/皮克斯版权作品，OpenAI 版权政策会拦截" },
  { pattern: /(Pixar|皮克斯)/i, category: "版权角色", reason: "「皮克斯 (Pixar)」为迪士尼旗下动画工作室，受版权保护" },
  // === 吉卜力 ===
  { pattern: /(Totoro|龙猫|多多洛)/i, category: "版权角色", reason: "「龙猫 (Totoro)」为吉卜力工作室版权角色，OpenAI 版权政策会拦截此类内容" },
  { pattern: /(Spirited.?Away|千与千寻|千与千寻的神隐)/i, category: "版权角色", reason: "「千与千寻」为吉卜力工作室版权作品，OpenAI 版权政策会拦截" },
  { pattern: /(Howl|哈尔|移动城堡)/i, category: "版权角色", reason: "「哈尔的移动城堡」为吉卜力工作室版权作品，OpenAI 版权政策会拦截" },
  { pattern: /(Princess.?Mononoke|幽灵公主|魔法公主)/i, category: "版权角色", reason: "「幽灵公主」为吉卜力工作室版权作品，OpenAI 版权政策会拦截" },
  { pattern: /(My.?Neighbor.?Totoro|となりのトトロ)/i, category: "版权角色", reason: "吉卜力工作室版权内容，OpenAI 版权政策会拦截此类内容" },
  // === 其他知名IP ===
  { pattern: /(Harry.?Potter|哈利.?波特|霍格沃茨|Hogwarts)/i, category: "版权角色", reason: "「哈利·波特 (Harry Potter)」为华纳兄弟版权内容，OpenAI 版权政策会拦截" },
  { pattern: /(Star.?Wars|星球大战|绝地|Jedi|尤达|Yoda|达斯.?维达|Darth.?Vader|天行者|Skywalker)/i, category: "版权角色", reason: "「星球大战 (Star Wars)」为迪士尼/卢卡斯影业版权作品，OpenAI 版权政策会拦截" },
  { pattern: /(Peter.?Pan|小飞侠|彼得.?潘)/i, category: "版权角色", reason: "「小飞侠 (Peter Pan)」为迪士尼/JM Barrie Estate 版权角色，OpenAI 会拦截" },
  { pattern: /(Pinocchio|小木偶|皮诺曹)/i, category: "版权角色", reason: "「小木偶 (Pinocchio)」为迪士尼版权角色，OpenAI 版权政策会拦截" },
  { pattern: /(Alice|爱丽丝|梦游仙境|Wonderland)/i, category: "版权角色", reason: "「爱丽丝梦游仙境」为迪士尼版权改编作品，OpenAI 版权政策会拦截" },
  { pattern: /(Shrek|史瑞克|怪物史莱克)/i, category: "版权角色", reason: "「史瑞克 (Shrek)」为梦工厂版权角色，OpenAI 版权政策会拦截" },
  { pattern: /(Kung.?Fu.?Panda|功夫熊猫)/i, category: "版权角色", reason: "「功夫熊猫」为梦工厂版权作品，OpenAI 版权政策会拦截" },
  { pattern: /(Mulan|花木兰)/i, category: "版权角色", reason: "「花木兰」为迪士尼版权作品，OpenAI 版权政策会拦截此类内容" },
  { pattern: /(Pocahontas|宝嘉康蒂|风中奇缘)/i, category: "版权角色", reason: "「风中奇缘」为迪士尼版权作品，OpenAI 版权政策会拦截" },
  { pattern: /(Snoopy|史努比)/i, category: "版权角色", reason: "「史努比 (Snoopy)」为花生漫画版权角色，OpenAI 版权政策会拦截" },
  { pattern: /(Garfield|加菲猫)/i, category: "版权角色", reason: "「加菲猫 (Garfield)」为 Paws 版权角色，OpenAI 版权政策会拦截此类内容" },
  // === 日本动漫IP ===
  { pattern: /(Dragon.?Ball|龙珠|七龙珠|悟空|Son.?Goku|贝吉塔|Vegeta)/i, category: "版权角色", reason: "「龙珠 (Dragon Ball)」为集英社/东映版权作品，OpenAI 版权政策会拦截" },
  { pattern: /(Naruto|火影忍者|鸣人|Naruto)/i, category: "版权角色", reason: "「火影忍者 (Naruto)」为集英社/岸本齐史版权作品，OpenAI 版权政策会拦截" },
  { pattern: /(One.?Piece|海贼王|航海王|路飞|Luffy|索隆|Zoro)/i, category: "版权角色", reason: "「海贼王 (One Piece)」为集英社/尾田荣一郎版权作品，OpenAI 版权政策会拦截" },
  { pattern: /(Detective.?Conan|名侦探柯南|柯南|Conan)/i, category: "版权角色", reason: "「名侦探柯南」为小学馆/青山刚昌版权作品，OpenAI 版权政策会拦截" },
  { pattern: /(Doraemon|哆啦A梦|多啦A梦|机器猫|小叮当)/i, category: "版权角色", reason: "「哆啦A梦 (Doraemon)」为藤子·F·不二雄版权作品，OpenAI 版权政策会拦截" },
  { pattern: /(Sailor.?Moon|美少女战士)/i, category: "版权角色", reason: "「美少女战士 (Sailor Moon)」为武内直子/讲谈社版权作品，OpenAI 版权政策会拦截" },
  { pattern: /(Attack.?on.?Titan|进击的巨人|巨人)/i, category: "版权角色", reason: "「进击的巨人」为谏山创/讲谈社版权作品，OpenAI 版权政策会拦截" },
  { pattern: /(Demon.?Slayer|鬼灭之刃|鬼灭)/i, category: "版权角色", reason: "「鬼灭之刃」为吾峠呼世晴/集英社版权作品，OpenAI 版权政策会拦截" },
  { pattern: /(Ghibli|吉卜力|Studio.?Ghibli)/i, category: "版权角色", reason: "「吉卜力工作室 (Studio Ghibli)」为日本动画工作室，受版权保护" },
  // === 其它知名IP ===
  { pattern: /(SpongeBob|海绵宝宝)/i, category: "版权角色", reason: "「海绵宝宝 (SpongeBob)」为尼克儿童频道/派拉蒙版权角色，会触发版权检测" },
  { pattern: /(Transformers|变形金刚|擎天柱|Optimus.?Prime|大黄蜂|Bumblebee)/i, category: "版权角色", reason: "「变形金刚」为孩之宝/派拉蒙版权作品，OpenAI 版权政策会拦截此类内容" },
  { pattern: /(Godzilla|哥斯拉)/i, category: "版权角色", reason: "「哥斯拉 (Godzilla)」为东宝版权角色，OpenAI 版权政策会拦截此类内容" },
  { pattern: /(Ultraman|奥特曼|咸蛋超人)/i, category: "版权角色", reason: "「奥特曼 (Ultraman)」为圆谷制作版权角色，OpenAI 版权政策会拦截此类内容" },
  { pattern: /(Monster.?Inc|怪兽电力公司|怪物公司)/i, category: "版权角色", reason: "「怪兽电力公司」为迪士尼/皮克斯版权作品，OpenAI 版权政策会拦截" },
  { pattern: /(Hello.?Kitty|凯蒂猫|HelloKitty)/i, category: "版权角色", reason: "「Hello Kitty」为三丽鸥版权角色，OpenAI 版权政策会拦截此类内容" },
];

const FORBIDDEN_PATTERNS_WITH_LEVEL = FORBIDDEN_PATTERNS.map(p => ({ ...p, level: 'block' as const }));

// ============================================================
// 2. 组合检测（命中多个维度时阻止）
// ============================================================
const COMBO_RULES: ComboRule[] = [
  // 写实暴力组合：写实/照片风格 + 暴力词
  {
    name: "realistic-violence",
    category: "极端暴力",
    reason: "prompt 将超写实/照片级风格与暴力元素组合，极易触发 OpenAI 安全拦截",
    require: 2,
    groups: [
      /\b(photorealistic|hyper.?realistic|realistic.?photo|real.?photo|photography|photo.?real|超写实|真实照片|写实风格|照片级|摄影级|新闻摄影|纪实摄影)\b/i,
      /(暴力|战斗|战争|杀|打斗|攻击|袭击|血|受伤|伤口|尸体|爆炸|炸|毁|破坏).{0,20}(暴力|战斗|战争|杀|打斗|攻击|袭击|血|受伤|伤口|尸体|爆炸|炸|毁|破坏)/i,
    ],
  },
  // 新闻造假组合
  {
    name: "fake-news",
    category: "信息造假",
    reason: "prompt 将真实场景风格与编造事件结合，可能生成误导性内容",
    require: 2,
    groups: [
      /\b(news.?photo|press.?photo|breaking.?news|现场|新闻|报道|纪录片|documentary|新闻摄影|新闻图片)\b/i,
      /(fake|伪造|编造|假|虚假|synthetic|generated|虚构|捏造|不实|篡改)/i,
    ],
  },
  // 真人写实 + 色情
  {
    name: "realistic-erotic",
    category: "色情/真人",
    reason: "prompt 将真人写实风格与性暗示内容组合，OpenAI 安全策略对此严格审查",
    require: 2,
    groups: [
      /\b(photorealistic|hyper.?realistic|real.?photo|写真|写实|照片级|摄影|portrait|肖像|真人)\b/i,
      /(性感|诱惑|挑逗|撩人|惹火|sexy|seductive|provocative|alluring|裸露|暴露|泳装|比基尼|内衣|underwear|lingerie|bikini)/i,
      /(裸|裸体|nude|naked|topless|bare)/i,
    ],
  },
  // 武器 + 犯罪场景
  {
    name: "weapon-crime",
    category: "武器/犯罪",
    reason: "prompt 将武器与犯罪场景组合，OpenAI 安全策略可能拦截",
    require: 2,
    groups: [
      /(枪|刀|炸弹|武器|gun|sword|knife|bomb|weapon|explosive|rifle|pistol)/i,
      /(犯罪|抢劫|杀人|谋杀|暗杀|袭击|恐怖|袭击|assault|robbery|murder|kill|shoot.?up|terror)/i,
    ],
  },
  // 未成年人 + 恋爱/约会
  {
    name: "minor-romance",
    category: "未成年人",
    reason: "prompt 将未成年人与恋爱/约会内容关联，OpenAI 安全策略对此有严格限制",
    require: 2,
    groups: [
      /\b(child|teen|teenager|少女|儿童|未成年|青少年|学生|高中生|初中生|小学生|校园|school|girl|kid|youth|萝莉|小男孩|小女孩)\b/i,
      /(恋爱|约会|浪漫|牵手|接吻|亲吻|爱情|男朋友|女朋友|情侣|初恋|date|dating|boyfriend|girlfriend|romance|love|crush|kiss|sweetheart)/i,
    ],
  },
  // 自杀 + 美化
  {
    name: "suicide-glamorize",
    category: "自伤美化",
    reason: "prompt 将自杀/自伤与美化/诗意化描述结合，OpenAI 安全策略严格禁止",
    require: 2,
    groups: [
      /(自杀|自尽|自刎|suicide|kill.?self|end.?life|ending.?it.?all|jump.?off|overdose|割腕)/i,
      /(beautiful|beauty|peaceful|诗意的|优美|安宁|解脱|解脱了|自由|scenic|美|优雅|动人|凄美|震撼)/i,
    ],
  },
];

// ============================================================
// 3. 词汇过滤（暴力武器等已有单次匹配）
// ============================================================

/**
 * 检测 prompt 中是否包含违禁内容
 * @returns 匹配结果数组，空数组表示无问题
 */
export function checkImagePrompt(prompt: string): ModerationMatch[] {
  const results: ModerationMatch[] = [];
  const lowerPrompt = prompt.toLowerCase();

  // === 单次匹配检测 ===
    for (const { pattern, category, reason, level } of FORBIDDEN_PATTERNS_WITH_LEVEL) {
    if (pattern.test(lowerPrompt) || pattern.test(prompt)) {
      const matches = prompt.match(pattern) || lowerPrompt.match(pattern);
      const matchedWords = matches
        ? matches.filter((m): m is string => typeof m === 'string' && m.trim().length > 0).slice(0, 5)
        : [];

      const existing = results.find((r) => r.category === category);
      if (existing) {
        existing.matchedWords = existing.matchedWords.concat(
          matchedWords.filter((w) => existing.matchedWords.indexOf(w) < 0)
        );
      } else {
        const deduped = matchedWords.filter((w, i, a) => a.indexOf(w) === i);
        results.push({ category, matchedWords: deduped, reason, level: level || 'block' });
      }
    }
  }

  // === 组合检测 ===
  for (const rule of COMBO_RULES) {
    const matchedGroups: string[] = [];
    for (const group of rule.groups) {
      if (group.test(lowerPrompt) || group.test(prompt)) {
        matchedGroups.push(group.source);
      }
    }
    if (matchedGroups.length >= rule.require) {
      // 检查是否已经命中相同类别
      const existing = results.find((r) => r.category === rule.category);
      if (existing) {
        // 已经命中，更新原因
        if (!existing.reason.includes(rule.reason)) {
          existing.reason = existing.reason + '；' + rule.reason;
        }
      } else {
        results.push({
          category: rule.category,
          matchedWords: [],
          reason: rule.reason,
          level: 'block',
        });
      }
    }
  }

  return results;
}

/**
 * 生成用户友好的违禁词提示文本
 */
export function formatModerationMessage(results: ModerationMatch[]): string {
  if (results.length === 0) return '';

  const categoryLabels: Record<string, string> = {
    '武器': '🔫 武器/暴力武器',
    '暴力': '💥 暴力内容',
    '性暴力': '🚨 非自愿性内容',
    '血腥暴力': '🩸 血腥暴力',
    '极端血腥': '🩸 极端血腥',
    '色情': '🔞 色情内容',
    '色情/未成年人': '🚨 未成年人色情',
    '色情/真人': '🔞 色情/真人',
    'Deepfake': '🛑 Deepfake/伪造',
    '未成年人': '🚫 未成年人保护',
    '违法犯罪': '⚠️ 违法犯罪内容',
    '违法犯罪/未成年人': '🚨 未成年人犯罪',
    '政治造假': '📰 政治造假/误导',
    '信息造假': '📰 信息造假',
    '仇恨符号': '🚫 仇恨符号',
    '仇恨内容': '🚫 仇恨内容',
    '恐怖主义': '🚫 恐怖主义',
    '自伤': '⚠️ 自伤内容',
    '自伤美化': '⚠️ 自伤美化',
    '版权角色': '©️ 版权角色/IP',
    '公众人物': '👤 公众人物',
    '艺术家版权': '🎨 艺术家版权',
    '未成年人保护': '🔞 未成年人保护',
    '极端暴力': '💥 极端暴力',
    '武器/犯罪': '⚠️ 武器/犯罪',
  };

  const reasons = (function (arr) {
    const seen: Record<string, boolean> = {};
    return arr.filter(function (x: string) {
      if (seen[x]) return false;
      seen[x] = true;
      return true;
    });
  })(results.map((r) => r.reason));

  const categories = (function (arr) {
    const seen: Record<string, boolean> = {};
    return arr.filter(function (x: string) {
      if (seen[x]) return false;
      seen[x] = true;
      return true;
    });
  })(results.map((r) => categoryLabels[r.category] || r.category));

  const hasBlock = results.some((r) => r.level === 'block');

  let message = `您的描述中包含以下受限制内容：\n${categories.map((c) => `• ${c}`).join('\n')}\n\n`;
  message += `${reasons.length === 1 ? reasons[0] : `主要原因：\n${reasons.map((r) => `• ${r}`).join('\n')}`}\n\n`;
  message += `请修改描述后重试。建议：\n`;
  message += `• 避免直接提及受保护的 IP 角色名称\n`;
  message += `• 避免将未成年人/学生与成人化内容关联\n`;
  message += `• 避免使用超写实风格描述暴力或血腥场景\n`;
  message += `• 避免涉及 Deepfake 或真人图像伪造\n`;
  message += `• 避免涉及违法物品制造或诈骗内容\n`;

  return message;
}
