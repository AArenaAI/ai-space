"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Bot,
  Building2,
  CheckCircle2,
  Download,
  FileText,
  GraduationCap,
  History,
  MapPin,
  MessageSquare,
  RefreshCw,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { apiFetch, apiJson } from "@/lib/api/client";
import { readAuthState } from "@/lib/auth/state";

type RiskBand = "冲" | "稳" | "保" | "垫";
type Strategy = "" | "balanced" | "aggressive" | "safe" | "major" | "city" | "school";

type StudentProfile = {
  province: string;
  score: number | "";
  rank: number | "";
  subjects: string;
  preferredCities: string;
  preferredMajors: string;
  rejectedMajors: string;
  schoolType: "" | "不限" | "公办优先" | "只看公办";
  tuitionLimit: string;
  acceptCooperation: boolean;
  obeyAdjustment: boolean;
  strategy: Strategy;
};

type MajorPoolTier = {
  priority?: string[];
  acceptable?: string[];
  cautious?: string[];
  rejected?: string[];
};

type AdmissionOption = {
  id: string;
  school: string;
  city: string;
  province: string;
  level: string;
  type: string;
  schoolType?: string;
  dualClass?: string;
  department?: string;
  majorGroup: string;
  major: string;
  groupMajors?: string[];
  recommendedMajorPool?: string[];
  majorPoolTier?: MajorPoolTier;
  rejectedMajorsInGroup?: string[];
  hasRejectedMajorRisk?: boolean;
  majorGroupRiskLevel?: string;
  subjectRequirement: string;
  tuition: number;
  ranks: number[];
  planChange: number;
  heat: "高" | "中" | "低";
  employment: string;
  note: string;
  source?: string;
  year?: number;
  dataLevel?: string;
};

type Recommendation = AdmissionOption & {
  band: RiskBand;
  riskScore: number;
  fitScore: number;
  reason: string[];
};

type VolunteerTableItem = {
  index: number;
  band: RiskBand;
  school: string;
  major_group?: string;
  majorGroup?: string;
  major: string;
  city: string;
  risk_tip?: string;
  riskTip?: string;
  adjustment_tip?: string;
  adjustmentTip?: string;
  tuition: number;
  subject_requirement?: string;
  subjectRequirement?: string;
  ranks: number[];
  group_majors?: string[];
  groupMajors?: string[];
  recommended_major_pool?: string[];
  recommendedMajorPool?: string[];
  major_pool_tier?: MajorPoolTier;
  majorPoolTier?: MajorPoolTier;
  rejected_majors_in_group?: string[];
  rejectedMajorsInGroup?: string[];
  has_rejected_major_risk?: boolean;
  hasRejectedMajorRisk?: boolean;
  major_group_risk_level?: string;
  majorGroupRiskLevel?: string;
};

type VolunteerTable = {
  mode: string;
  total_slots: number;
  stats: Record<RiskBand, number>;
  summary: string;
  items: VolunteerTableItem[];
};

type ChatMessage = {
  role: "assistant" | "user";
  content: string;
};

type SavedPlan = {
  id: number;
  title: string;
  province?: string;
  score?: number;
  rank?: number;
  strategy?: string;
  updated_at?: string;
  created_at?: string;
};

type RiskIssue = {
  level: "high" | "medium" | "low";
  title: string;
  detail: string;
};

const defaultProfile: StudentProfile = {
  province: "",
  score: "",
  rank: "",
  subjects: "",
  preferredCities: "",
  preferredMajors: "",
  rejectedMajors: "",
  schoolType: "",
  tuitionLimit: "",
  acceptCooperation: false,
  obeyAdjustment: false,
  strategy: "",
};

const sampleOptions: AdmissionOption[] = [
  { id: "scut-soft", school: "华南理工大学", city: "广州", province: "广东", level: "985 / 双一流", type: "公办", majorGroup: "物理组 203", major: "软件工程", subjectRequirement: "物理+化学", tuition: 6850, ranks: [24500, 26300, 28600], planChange: 3, heat: "高", employment: "互联网、金融科技、智能制造", note: "学校层级强，专业热度高，适合冲刺。" },
  { id: "jnu-ai", school: "暨南大学", city: "广州", province: "广东", level: "211 / 双一流", type: "公办", majorGroup: "物理组 206", major: "人工智能", subjectRequirement: "物理+化学", tuition: 6850, ranks: [30000, 31800, 33700], planChange: 5, heat: "高", employment: "算法工程、数据智能、产业 AI", note: "城市和专业匹配度高，近三年位次有轻微上移。" },
  { id: "sztech-ee", school: "南方科技大学", city: "深圳", province: "广东", level: "双一流建设参考", type: "公办", majorGroup: "综合评价", major: "电子信息类", subjectRequirement: "物理+化学", tuition: 6000, ranks: [28500, 30900, 32600], planChange: 2, heat: "高", employment: "芯片、通信、智能硬件", note: "深圳区位强，但综合评价和录取规则需单独核查。" },
  { id: "scnu-cs", school: "华南师范大学", city: "广州", province: "广东", level: "211 / 双一流", type: "公办", majorGroup: "物理组 214", major: "计算机科学与技术", subjectRequirement: "物理+化学", tuition: 6850, ranks: [33600, 35400, 37100], planChange: 8, heat: "高", employment: "软件开发、教育科技、信息系统", note: "广州 211，专业稳定，是主力稳妥项。" },
  { id: "guang工-auto", school: "广东工业大学", city: "广州", province: "广东", level: "省重点", type: "公办", majorGroup: "物理组 205", major: "自动化", subjectRequirement: "物理+化学", tuition: 6850, ranks: [38200, 40100, 43800], planChange: 10, heat: "中", employment: "工业控制、机器人、新能源", note: "工科就业导向明显，安全边际较好。" },
  { id: "hangdian-cs", school: "杭州电子科技大学", city: "杭州", province: "浙江", level: "省重点", type: "公办", majorGroup: "物理组", major: "计算机类", subjectRequirement: "物理+化学", tuition: 6900, ranks: [29200, 31500, 34600], planChange: 0, heat: "高", employment: "互联网、信息安全、嵌入式", note: "专业口碑强，城市匹配，但省外计划波动需核查。" },
  { id: "njupt-comm", school: "南京邮电大学", city: "南京", province: "江苏", level: "双一流", type: "公办", majorGroup: "物理组", major: "通信工程", subjectRequirement: "物理+化学", tuition: 6380, ranks: [33000, 35100, 37800], planChange: -2, heat: "中", employment: "通信运营商、芯片、网络设备", note: "信息通信强校，适合作为专业优先稳妥项。" },
  { id: "cqupt-soft", school: "重庆邮电大学", city: "重庆", province: "重庆", level: "省重点", type: "公办", majorGroup: "物理组", major: "软件工程", subjectRequirement: "物理+化学", tuition: 9000, ranks: [39500, 42100, 45800], planChange: 6, heat: "中", employment: "软件开发、通信软件、云平台", note: "专业方向清晰，位次安全边际较好。" },
  { id: "scu-ee", school: "四川大学", city: "成都", province: "四川", level: "985 / 双一流", type: "公办", majorGroup: "物理组", major: "电气类", subjectRequirement: "物理+化学", tuition: 6500, ranks: [27600, 29200, 31900], planChange: -3, heat: "高", employment: "电网、新能源、智能装备", note: "学校层级高，适合略冲，需关注计划缩减。" },
  { id: "whut-auto", school: "武汉理工大学", city: "武汉", province: "湖北", level: "211 / 双一流", type: "公办", majorGroup: "物理组", major: "自动化类", subjectRequirement: "物理+化学", tuition: 5850, ranks: [34800, 37200, 40500], planChange: 4, heat: "中", employment: "汽车电子、机器人、制造业数字化", note: "211 工科平台，和当前位次匹配。" },
  { id: "xjtlu-data", school: "西交利物浦大学", city: "苏州", province: "江苏", level: "中外合作", type: "中外合作", majorGroup: "物理组", major: "数据科学与大数据技术", subjectRequirement: "物理+化学", tuition: 88000, ranks: [42000, 47000, 52000], planChange: 12, heat: "中", employment: "数据分析、海外升学、产品技术", note: "适合国际化路线，但学费高。" },
  { id: "dgut-ee", school: "东莞理工学院", city: "东莞", province: "广东", level: "省属本科", type: "公办", majorGroup: "物理组 204", major: "电子信息工程", subjectRequirement: "物理+化学", tuition: 5710, ranks: [52000, 55700, 60300], planChange: 15, heat: "中", employment: "制造业电子、通信设备、嵌入式", note: "珠三角公办保底，安全边际明显。" },
];

const bandStyles: Record<RiskBand, string> = {
  冲: "border-rose-400/30 bg-rose-500/10 text-rose-600 dark:text-rose-300",
  稳: "border-sky-400/30 bg-sky-500/10 text-sky-600 dark:text-sky-300",
  保: "border-emerald-400/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  垫: "border-slate-400/30 bg-slate-500/10 text-slate-600 dark:text-slate-300",
};

const strategyLabels: Record<Strategy, string> = {
  "": "请选择",
  balanced: "均衡推荐",
  aggressive: "冲刺优先",
  safe: "稳妥保录",
  major: "专业优先",
  city: "城市优先",
  school: "名校优先",
};

const provinceOptions = ["广东", "江苏", "浙江", "山东", "河北", "湖南", "湖北", "福建", "辽宁", "重庆", "四川", "河南", "安徽", "江西", "广西", "云南", "贵州", "陕西", "山西", "青海", "北京", "上海", "天津", "海南", "黑龙江", "吉林", "内蒙古", "甘肃", "宁夏", "新疆", "西藏"];

const subjectOptions = [
  "物理 / 化学",
  "物理 / 生物",
  "物理 / 地理",
  "物理 / 政治",
  "历史 / 政治",
  "历史 / 地理",
  "历史 / 生物",
  "理科",
  "文科",
  "综合改革",
];

const cityOptions = [
  "北京", "上海", "天津", "重庆", "广州", "深圳", "珠海", "佛山", "东莞", "中山", "惠州", "汕头", "杭州", "宁波", "温州", "绍兴", "嘉兴", "南京", "苏州", "无锡", "常州", "南通", "扬州", "徐州", "济南", "青岛", "烟台", "威海", "潍坊", "郑州", "洛阳", "开封", "新乡", "武汉", "宜昌", "襄阳", "长沙", "株洲", "湘潭", "衡阳", "成都", "绵阳", "德阳", "西安", "咸阳", "宝鸡", "合肥", "芜湖", "蚌埠", "厦门", "福州", "泉州", "南昌", "赣州", "九江", "南宁", "桂林", "柳州", "昆明", "大理", "贵阳", "遵义", "太原", "大同", "沈阳", "大连", "鞍山", "长春", "吉林", "哈尔滨", "大庆", "呼和浩特", "包头", "兰州", "天水", "西宁", "银川", "乌鲁木齐", "海口", "三亚", "拉萨", "珠三角", "长三角", "京津冀", "成渝", "长江中游", "东北", "西北", "华北", "华东", "华南", "西南"
];

const majorOptions = [
  "计算机科学与技术", "软件工程", "人工智能", "数据科学与大数据技术", "网络工程", "网络空间安全", "信息安全", "物联网工程", "数字媒体技术", "电子信息工程", "通信工程", "微电子科学与工程", "集成电路设计与集成系统", "电子科学与技术", "光电信息科学与工程", "自动化", "机器人工程", "电气工程及其自动化", "智能电网信息工程", "能源与动力工程", "新能源科学与工程", "车辆工程", "机械工程", "机械设计制造及其自动化", "智能制造工程", "航空航天工程", "飞行器设计与工程", "船舶与海洋工程", "土木工程", "建筑学", "城乡规划", "交通工程", "交通运输", "测绘工程", "地理信息科学", "数学与应用数学", "信息与计算科学", "统计学", "应用统计学", "物理学", "化学", "应用化学", "材料科学与工程", "高分子材料与工程", "环境工程", "生物科学", "生物技术", "食品科学与工程", "临床医学", "口腔医学", "医学影像学", "麻醉学", "护理学", "药学", "中医学", "法学", "知识产权", "汉语言文学", "新闻学", "传播学", "英语", "日语", "会计学", "财务管理", "金融学", "经济学", "国际经济与贸易", "工商管理", "市场营销", "人力资源管理", "行政管理", "公共事业管理", "教育学", "学前教育", "小学教育", "体育教育", "心理学", "设计学", "视觉传达设计", "数字媒体艺术"
];


const cityOptionGroups: Array<{ title: string; options: string[] }> = [
  { title: "广东", options: ["广州", "深圳", "珠海", "佛山", "东莞", "中山", "惠州", "汕头"] },
  { title: "江苏", options: ["南京", "苏州", "无锡", "常州", "南通", "扬州", "徐州"] },
  { title: "浙江", options: ["杭州", "宁波", "温州", "绍兴", "嘉兴"] },
  { title: "山东", options: ["济南", "青岛", "烟台", "威海", "潍坊"] },
  { title: "河南", options: ["郑州", "洛阳", "开封", "新乡"] },
  { title: "湖北", options: ["武汉", "宜昌", "襄阳"] },
  { title: "湖南", options: ["长沙", "株洲", "湘潭", "衡阳"] },
  { title: "四川/重庆", options: ["成都", "绵阳", "德阳", "重庆"] },
  { title: "安徽/江西/福建", options: ["合肥", "芜湖", "南昌", "赣州", "厦门", "福州", "泉州"] },
  { title: "北上津/东北", options: ["北京", "上海", "天津", "沈阳", "大连", "长春", "哈尔滨"] },
  { title: "西北/西南/华南", options: ["西安", "兰州", "银川", "乌鲁木齐", "昆明", "贵阳", "南宁", "桂林", "海口"] },
  { title: "区域", options: ["珠三角", "长三角", "京津冀", "成渝", "长江中游", "东北", "西北", "华北", "华东", "华南", "西南"] },
];

const majorOptionGroups: Array<{ title: string; options: string[] }> = [
  { title: "计算机/电子信息", options: ["计算机科学与技术", "软件工程", "人工智能", "数据科学与大数据技术", "网络工程", "网络空间安全", "信息安全", "物联网工程", "数字媒体技术", "电子信息工程", "通信工程", "微电子科学与工程", "集成电路设计与集成系统", "电子科学与技术", "光电信息科学与工程"] },
  { title: "自动化/电气/机械", options: ["自动化", "机器人工程", "电气工程及其自动化", "智能电网信息工程", "能源与动力工程", "新能源科学与工程", "车辆工程", "机械工程", "机械设计制造及其自动化", "智能制造工程"] },
  { title: "交通/建筑/土木", options: ["航空航天工程", "飞行器设计与工程", "船舶与海洋工程", "土木工程", "建筑学", "城乡规划", "交通工程", "交通运输", "测绘工程", "地理信息科学"] },
  { title: "理学/材料/环境", options: ["数学与应用数学", "信息与计算科学", "统计学", "应用统计学", "物理学", "化学", "应用化学", "材料科学与工程", "高分子材料与工程", "环境工程", "生物科学", "生物技术", "食品科学与工程"] },
  { title: "医学", options: ["临床医学", "口腔医学", "医学影像学", "麻醉学", "护理学", "药学", "中医学"] },
  { title: "法学/文学/外语", options: ["法学", "知识产权", "汉语言文学", "新闻学", "传播学", "英语", "日语"] },
  { title: "经管", options: ["会计学", "财务管理", "金融学", "经济学", "国际经济与贸易", "工商管理", "市场营销", "人力资源管理", "行政管理", "公共事业管理"] },
  { title: "教育/艺术", options: ["教育学", "学前教育", "小学教育", "体育教育", "心理学", "设计学", "视觉传达设计", "数字媒体艺术"] },
];

const rejectedMajorOptions = ["医学", "护理", "土木", "化学", "材料", "生物", "农学", "环境", "矿业", "地质", "食品", "旅游管理", "市场营销", "中外合作", "高收费专业", "师范", "管理类", "外语", "法学", "财经", "艺术", "体育"];


function volunteerRuleForProvince(province: string) {
  const complete = (rule: { mode: string; slots: number; unit: string; description: string; majorCount?: number; hasAdjustment?: boolean; isParallel?: boolean }) => ({
    ...rule,
    majorCount: rule.majorCount ?? (rule.unit === "专业+院校" || rule.unit === "专业平行" ? 1 : rule.unit === "学校+专业" ? 6 : 6),
    hasAdjustment: rule.hasAdjustment ?? !(rule.unit === "专业+院校" || rule.unit === "专业平行"),
    isParallel: rule.isParallel ?? true,
  });
  const rules: Record<string, { mode: string; slots: number; unit: string; description: string; majorCount?: number; hasAdjustment?: boolean; isParallel?: boolean }> = {
    广东: { mode: "广东本科批院校专业组", slots: 45, unit: "院校专业组", description: "按专业组填报，重点核查组内专业和调剂风险。" },
    江苏: { mode: "江苏本科批院校专业组", slots: 40, unit: "院校专业组", description: "按专业组生成候选，需核查组内专业。" },
    湖南: { mode: "湖南本科批院校专业组", slots: 45, unit: "院校专业组", description: "按专业组生成志愿候选。" },
    湖北: { mode: "湖北本科批院校专业组", slots: 45, unit: "院校专业组", description: "按专业组生成志愿候选。" },
    福建: { mode: "福建本科批院校专业组", slots: 40, unit: "院校专业组", description: "按专业组生成志愿候选。" },
    浙江: { mode: "浙江普通类专业平行志愿", slots: 80, unit: "专业平行", description: "以专业/院校为主要单位，通常不涉及专业组调剂。" },
    山东: { mode: "山东普通类专业+院校平行志愿", slots: 96, unit: "专业+院校", description: "以具体专业和院校组合为单位。" },
    河北: { mode: "河北本科批专业+院校平行志愿", slots: 96, unit: "专业+院校", description: "以具体专业和院校组合为单位。" },
    辽宁: { mode: "辽宁本科批专业+院校平行志愿", slots: 112, unit: "专业+院校", description: "以具体专业和院校组合为单位。" },
    重庆: { mode: "重庆本科批专业+院校平行志愿", slots: 96, unit: "专业+院校", description: "以具体专业和院校组合为单位。" },
  };
  return complete(rules[province] || { mode: `${province || "当前省份"}志愿表候选`, slots: 45, unit: "通用候选", description: "该省份规则尚未深度适配，需按当地考试院规则复核。" });
}

function averageRank(ranks: number[]) {
  if (!ranks.length) return 0;
  return Math.round(ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length);
}

function parseList(text: string) {
  return text
    .split(/[、,，\s/]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function profileRankNumber(profile: StudentProfile): number {
  return Number(profile.rank || 0) || 1;
}

function getBand(profile: StudentProfile, option: AdmissionOption): RiskBand {
  const avg = averageRank(option.ranks);
  const ratio = avg / Math.max(profileRankNumber(profile), 1);
  if (ratio < 0.95) return "冲";
  if (ratio < 1.22) return "稳";
  if (ratio < 1.65) return "保";
  return "垫";
}

function scoreOption(profile: StudentProfile, option: AdmissionOption): Recommendation | null {
  const preferredCities = parseList(profile.preferredCities);
  const preferredMajors = parseList(profile.preferredMajors);
  const rejectedMajors = parseList(profile.rejectedMajors);
  const tuitionLimit = Number(profile.tuitionLimit || 0);

  if (profile.schoolType === "只看公办" && option.type !== "公办") return null;
  if (!profile.acceptCooperation && option.type === "中外合作") return null;
  if (tuitionLimit > 0 && option.tuition > tuitionLimit) return null;
  if (rejectedMajors.some((m) => option.major.includes(m))) return null;

  const avg = averageRank(option.ranks);
  const rankNumber = profileRankNumber(profile);
  const distance = avg - rankNumber;
  const band = getBand(profile, option);
  const cityHit = preferredCities.some((city) => option.city.includes(city) || option.province.includes(city));
  const majorHit = preferredMajors.some((major) => option.major.includes(major));
  const publicHit = option.type === "公办" ? 8 : -8;
  const planScore = option.planChange * 0.8;
  const heatPenalty = option.heat === "高" ? -4 : option.heat === "中" ? 0 : 4;

  let fitScore = 70;
  fitScore += Math.max(-22, Math.min(22, distance / Math.max(rankNumber, 1) * 42));
  fitScore += cityHit ? 10 : 0;
  fitScore += majorHit ? 16 : 0;
  fitScore += publicHit + planScore + heatPenalty;
  if (profile.strategy === "aggressive" && band === "冲") fitScore += 12;
  if (profile.strategy === "safe" && (band === "保" || band === "垫")) fitScore += 14;
  if (profile.strategy === "major" && majorHit) fitScore += 14;
  if (profile.strategy === "city" && cityHit) fitScore += 14;
  if (profile.strategy === "school" && (option.level.includes("985") || option.level.includes("211") || option.level.includes("双一流"))) fitScore += 14;
  if (option.level.includes("985")) fitScore += 8;
  else if (option.level.includes("211") || option.level.includes("双一流")) fitScore += 5;

  const riskScore = Math.max(8, Math.min(96, 58 - (distance / Math.max(rankNumber, 1)) * 45 + (option.heat === "高" ? 10 : 0) - option.planChange * 0.8));
  const reason = [
    `你当前位次约 ${rankNumber.toLocaleString()}，该方向近三年最低位次约 ${option.ranks.map((r) => r.toLocaleString()).join(" / ")}。`,
    `${option.city} 与偏好${cityHit ? "匹配" : "不完全匹配"}，${option.major} 与专业偏好${majorHit ? "匹配" : "可作为备选扩展"}。`,
    `招生计划变化 ${option.planChange >= 0 ? "+" : ""}${option.planChange}，专业热度${option.heat}，综合判断为“${band}”。`,
  ];
  if (option.type !== "公办") reason.push(`${option.type} 项目需重点核查学费、培养模式和家长接受度。`);
  if (profile.obeyAdjustment) reason.push("你选择服从调剂，仍需检查专业组内是否有明显不接受专业。");

  return { ...option, band, riskScore: Math.round(riskScore), fitScore: Math.round(fitScore), reason };
}

function buildRecommendations(profile: StudentProfile) {
  const scored = sampleOptions
    .map((option) => scoreOption(profile, option))
    .filter(Boolean) as Recommendation[];
  return scored.sort((a, b) => b.fitScore - a.fitScore);
}

function updateProfileFromCommand(profile: StudentProfile, command: string): { next: StudentProfile; reply: string } {
  const text = command.trim();
  let next = { ...profile };
  const actions: string[] = [];

  if (/不要|去掉|排除|不想/.test(text)) {
    if (/东北/.test(text)) {
      const cities = parseList(next.preferredCities).filter((c) => !["东北", "沈阳", "大连", "哈尔滨", "长春"].includes(c));
      next.preferredCities = cities.length ? cities.join("、") : "广州、深圳、杭州、南京、成都";
      actions.push("已排除东北方向，优先保留南方和新一线城市。演示库当前无东北院校，正式库会直接过滤。 ");
    }
    const rejected = ["医学", "护理", "土木", "化学", "材料", "生物", "农学"].filter((m) => text.includes(m));
    if (rejected.length) {
      const merged = Array.from(new Set([...parseList(next.rejectedMajors), ...rejected]));
      next.rejectedMajors = merged.join("、");
      actions.push(`已加入专业排除：${rejected.join("、")}。`);
    }
  }

  if (/只看公办|不要民办|排除民办|公办/.test(text)) {
    next.schoolType = "只看公办";
    next.acceptCooperation = false;
    actions.push("已切换为只看公办，并排除中外合作。 ");
  }
  if (/中外合作/.test(text) && /接受|可以|加入|看看/.test(text)) {
    next.acceptCooperation = true;
    next.schoolType = "公办优先";
    actions.push("已允许中外合作项目进入备选，但会继续提示学费风险。 ");
  }
  if (/保守|更稳|安全|保底/.test(text)) {
    next.strategy = "safe";
    actions.push("已切换为稳妥保录策略，提高保/垫比例。 ");
  }
  if (/激进|大胆|冲/.test(text)) {
    next.strategy = "aggressive";
    actions.push("已切换为冲刺优先策略，增加高层级院校权重。 ");
  }
  if (/专业优先|计算机|软件|电子|自动化|通信/.test(text)) {
    const majors = ["计算机", "软件工程", "电子信息", "自动化", "通信"].filter((m) => text.includes(m));
    if (majors.length) next.preferredMajors = Array.from(new Set([...parseList(next.preferredMajors), ...majors])).join("、");
    next.strategy = "major";
    actions.push("已切换为专业优先策略，并扩展相近工科专业池。 ");
  }
  if (/城市优先|广州|深圳|杭州|南京|上海|北京|成都|苏州/.test(text)) {
    const cities = ["广州", "深圳", "杭州", "南京", "上海", "北京", "成都", "苏州"].filter((c) => text.includes(c));
    if (cities.length) next.preferredCities = Array.from(new Set([...parseList(next.preferredCities), ...cities])).join("、");
    next.strategy = "city";
    actions.push("已切换为城市优先策略。 ");
  }

  return {
    next,
    reply: actions.length
      ? `${actions.join("")}我已按新偏好重新计算右侧方案。`
      : "我理解你的调整方向。当前演示版支持城市、专业、公办/中外合作、冲稳保策略的实时重排；如果接入正式 Agent，会进一步调用真实院校库和历年位次做替换。",
  };
}

function StatCard({ label, value, hint, icon: Icon }: { label: string; value: string; hint: string; icon: React.ElementType }) {
  return (
    <div className="rounded-3xl border border-surface-border bg-surface-card/90 p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-neutral-100 dark:bg-surface-elevated text-neutral-950 dark:text-white"><Icon className="h-5 w-5" /></div>
        <div className="min-w-0">
          <div className="text-xs font-medium text-text-tertiary">{label}</div>
          <div className="mt-1 truncate text-xl font-semibold text-text-primary">{value}</div>
        </div>
      </div>
      <div className="mt-3 text-xs leading-relaxed text-text-tertiary">{hint}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-text-tertiary">{label}</span>
      {children}
    </label>
  );
}

const inputClass = "w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-950 outline-none transition placeholder:text-neutral-400 focus:border-neutral-950 focus:ring-2 focus:ring-neutral-900/10 dark:border-surface-border dark:bg-surface-elevated dark:text-text-primary";

function toList(text: string) {
  return parseList(text);
}

function profileToApiShape(profile: StudentProfile) {
  return {
    province: profile.province,
    score: Number(profile.score || 0),
    rank: Number(profile.rank || 0),
    subjects: profile.subjects,
    preferredCities: profile.preferredCities,
    preferredMajors: profile.preferredMajors,
    rejectedMajors: profile.rejectedMajors,
    schoolType: profile.schoolType,
    tuitionLimit: profile.tuitionLimit,
    acceptCooperation: profile.acceptCooperation,
    obeyAdjustment: profile.obeyAdjustment,
    strategy: profile.strategy,
  };
}

function apiShapeToProfile(value: any, fallback: StudentProfile): StudentProfile {
  return {
    ...fallback,
    province: String(value?.province ?? fallback.province),
    score: value?.score === "" || value?.score == null ? fallback.score : Number(value.score),
    rank: value?.rank === "" || value?.rank == null ? fallback.rank : Number(value.rank),
    subjects: String(value?.subjects ?? fallback.subjects),
    preferredCities: String(value?.preferredCities ?? value?.preferred_cities ?? fallback.preferredCities),
    preferredMajors: String(value?.preferredMajors ?? value?.preferred_majors ?? fallback.preferredMajors),
    rejectedMajors: String(value?.rejectedMajors ?? value?.rejected_majors ?? fallback.rejectedMajors),
    schoolType: (value?.schoolType ?? value?.school_type ?? fallback.schoolType) as StudentProfile["schoolType"],
    tuitionLimit: String(value?.tuitionLimit ?? value?.tuition_limit ?? fallback.tuitionLimit),
    acceptCooperation: Boolean(value?.acceptCooperation ?? value?.accept_cooperation ?? fallback.acceptCooperation),
    obeyAdjustment: Boolean(value?.obeyAdjustment ?? value?.obey_adjustment ?? fallback.obeyAdjustment),
    strategy: (value?.strategy ?? fallback.strategy) as Strategy,
  };
}

function summarizeProfilePatch(patch: any): string {
  if (!patch || typeof patch !== "object") return "";
  const labels: Record<string, string> = {
    schoolType: "学校类型",
    tuitionLimit: "学费上限",
    preferredCities: "地域偏好",
    preferredMajors: "专业偏好",
    rejectedMajors: "排除专业",
    strategy: "推荐策略",
    acceptCooperation: "中外合作",
    obeyAdjustment: "服从调剂",
    allowCollegeFallback: "专科兜底",
  };
  const valueText = (key: string, value: any) => {
    if (typeof value === "boolean") return value ? "是" : "否";
    if (key === "strategy") return strategyLabels[value as Strategy] || value;
    return Array.isArray(value) ? value.join("、") : String(value ?? "");
  };
  return Object.entries(patch).map(([key, value]) => `- ${labels[key] || key}：${valueText(key, value)}`).join("\n");
}

function normalizeApiRecommendation(item: any): Recommendation {
  return {
    id: String(item.id || `${item.school}-${item.major}-${item.major_group || ""}`),
    band: item.band as RiskBand,
    riskScore: Number(item.risk_score ?? item.riskScore ?? 0),
    fitScore: Number(item.fit_score ?? item.fitScore ?? 0),
    school: item.school || "",
    city: item.city || "",
    province: item.province || "",
    level: item.level || "",
    type: item.type || "公办",
    schoolType: item.school_type || item.schoolType || "",
    dualClass: item.dual_class || item.dualClass || "",
    department: item.department || "",
    majorGroup: item.major_group || item.majorGroup || "",
    major: item.major || "",
    groupMajors: item.group_majors || item.groupMajors || [],
    recommendedMajorPool: item.recommended_major_pool || item.recommendedMajorPool || [],
    majorPoolTier: item.major_pool_tier || item.majorPoolTier || {},
    rejectedMajorsInGroup: item.rejected_majors_in_group || item.rejectedMajorsInGroup || [],
    hasRejectedMajorRisk: item.has_rejected_major_risk ?? item.hasRejectedMajorRisk ?? false,
    majorGroupRiskLevel: item.major_group_risk_level || item.majorGroupRiskLevel || "",
    subjectRequirement: item.subject_requirement || item.subjectRequirement || "",
    tuition: Number(item.tuition || 0),
    ranks: Array.isArray(item.ranks) ? item.ranks.map(Number) : [],
    planChange: Number(item.plan_change ?? item.planChange ?? 0),
    heat: item.heat || "中",
    employment: item.employment || "",
    note: item.note || "",
    source: item.source || "",
    year: Number(item.year || 0) || undefined,
    dataLevel: item.data_level || item.dataLevel || "",
    reason: Array.isArray(item.reason) ? item.reason : [],
  };
}

export default function GaokaoVolunteerPage() {
  const { t } = useI18n();
  const [profile, setProfile] = useState<StudentProfile>(defaultProfile);
  const [selectedBand, setSelectedBand] = useState<RiskBand | "全部">("全部");
  const [activeTrack, setActiveTrack] = useState<"本科" | "专科" | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [agentOpen, setAgentOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "我是高考志愿填报 AI。左侧先确认省份、分数、位次和偏好；中间会生成冲稳保方案。你可以直接说“不要东北”“只看公办”“保底再稳一点”“优先计算机”。" },
  ]);
  const [apiRecommendations, setApiRecommendations] = useState<Recommendation[] | null>(null);
  const [recommendLoading, setRecommendLoading] = useState(false);
  const [recommendRefreshKey, setRecommendRefreshKey] = useState(0);
  const [dataSourceNote, setDataSourceNote] = useState("");
  const [recommendError, setRecommendError] = useState<string | null>(null);
  const [savedPlans, setSavedPlans] = useState<SavedPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [coverageSummary, setCoverageSummary] = useState<any>(null);
  const [advisorResult, setAdvisorResult] = useState<any>(null);
  const [advisorEvents, setAdvisorEvents] = useState<Array<{ type: string; text: string }>>([]);
  const [activeDocument, setActiveDocument] = useState<"report" | "sources" | "candidates">("report");
  const [reportPreviewOpen, setReportPreviewOpen] = useState(false);
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const [openPicker, setOpenPicker] = useState<"preferredCities" | "preferredMajors" | "rejectedMajors" | null>(null);
  const [volunteerTable, setVolunteerTable] = useState<VolunteerTable | null>(null);
  const [volunteerTableLoading, setVolunteerTableLoading] = useState(false);
  const [riskText, setRiskText] = useState("");
  const [riskIssues, setRiskIssues] = useState<RiskIssue[]>([]);
  const [riskStats, setRiskStats] = useState<Record<string, number> | null>(null);
  const [riskLoading, setRiskLoading] = useState(false);
  const orbDragRef = useRef<{ dragging: boolean; moved: boolean; offsetX: number; offsetY: number; startX: number; startY: number }>({ dragging: false, moved: false, offsetX: 0, offsetY: 0, startX: 0, startY: 0 });
  const [orbPosition, setOrbPosition] = useState({ x: 0, y: 0 });

  const currentVolunteerRule = useMemo(() => volunteerRuleForProvince(profile.province), [profile.province]);
  const recommendations = apiRecommendations ?? [];
  const visibleRecommendations = selectedBand === "全部" ? recommendations : recommendations.filter((item) => item.band === selectedBand);
  const counts = useMemo(() => {
    return recommendations.reduce<Record<RiskBand, number>>((acc, item) => {
      acc[item.band] += 1;
      return acc;
    }, { 冲: 0, 稳: 0, 保: 0, 垫: 0 });
  }, [recommendations]);

  useEffect(() => {
    if (!activeTrack || recommendRefreshKey === 0) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setRecommendLoading(true);
      setRecommendError(null);
      try {
        const response = await fetch("/api/gaokao/recommend", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            province: profile.province,
            score: profile.score,
            rank: profile.rank,
            subjects: profile.subjects,
            preferred_cities: toList(profile.preferredCities),
            preferred_majors: toList(profile.preferredMajors),
            rejected_majors: toList(profile.rejectedMajors),
            school_type: profile.schoolType,
            tuition_limit: Number(profile.tuitionLimit || 0),
            accept_cooperation: profile.acceptCooperation,
            obey_adjustment: profile.obeyAdjustment,
            strategy: profile.strategy,
          }),
        });
        if (!response.ok) throw new Error("recommend api failed");
        const data = await response.json();
        setApiRecommendations(Array.isArray(data?.recommendations) ? data.recommendations.map(normalizeApiRecommendation) : []);
        const lookupNote = data?.needs_model_lookup ? ` 本地库候选不足，建议启动模型辅助补查：${data?.lookup_prompt || "需补充官方来源。"}` : "";
        setDataSourceNote(`${data?.data_source_note || "已连接后端推荐服务。生产环境请导入官方数据源。 "}${lookupNote}`);
      } catch (error: any) {
        if (error?.name === "AbortError") return;
        setApiRecommendations([]);
        setRecommendError("后端推荐接口暂不可用，未展示降级样例，避免混入非真实数据。 ");
        setDataSourceNote("后端推荐接口暂不可用；当前不显示本地样例，避免误认为真实推荐。 ");
      } finally {
        if (!controller.signal.aborted) setRecommendLoading(false);
      }
    }, 220);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [profile, recommendRefreshKey, activeTrack]);

  const updateField = <K extends keyof StudentProfile>(key: K, value: StudentProfile[K]) => {
    setProfile((prev) => ({ ...prev, [key]: value }));
  };

  const toggleListValue = (key: "preferredCities" | "preferredMajors" | "rejectedMajors", value: string) => {
    setProfile((prev) => {
      const current = parseList(prev[key]);
      const exists = current.includes(value);
      const next = exists ? current.filter((item) => item !== value) : [...current, value];
      return { ...prev, [key]: next.join("、") };
    });
  };

  const clearListValue = (key: "preferredCities" | "preferredMajors" | "rejectedMajors") => {
    setProfile((prev) => ({ ...prev, [key]: "" }));
  };

  const renderExpandablePicker = (key: "preferredCities" | "preferredMajors" | "rejectedMajors", options: string[], selectedLabel: string, placeholder: string) => {
    const selected = parseList(profile[key]);
    const expanded = openPicker === key;
    return (
      <div className="space-y-2">
        <button type="button" onClick={() => setOpenPicker(expanded ? null : key)} className={cn(inputClass, "flex items-center justify-between text-left")}>
          <span className={cn(profile[key] ? "text-text-primary" : "text-text-tertiary")}>{profile[key] || placeholder}</span>
          <span className={cn("text-xs text-text-tertiary transition", expanded && "rotate-180")}>⌄</span>
        </button>
        {expanded && (
          <div className="rounded-2xl border border-surface-border bg-surface-card p-3 shadow-sm">
            <div className="grid max-h-44 grid-cols-2 gap-2 overflow-y-auto pr-1">
              {options.map((option) => {
                const active = selected.includes(option);
                return <button key={option} type="button" onClick={() => toggleListValue(key, option)} className={cn("min-h-9 rounded-xl border px-3 py-1.5 text-left text-xs font-medium transition", active ? "border-neutral-950 bg-neutral-950 text-white shadow-sm dark:border-white dark:bg-white dark:text-neutral-950" : "border-surface-border bg-surface-elevated text-text-secondary hover:border-neutral-400 hover:text-text-primary")}>{option}</button>;
              })}
            </div>
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-surface-border pt-3 text-xs">
              <span className="min-w-0 flex-1 truncate text-text-tertiary">{selectedLabel}：{profile[key] || "未选择"}</span>
              {profile[key] && <button type="button" onClick={() => clearListValue(key)} className="shrink-0 text-neutral-950 underline dark:text-white">清空</button>}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderGroupedPicker = (key: "preferredCities" | "preferredMajors", groups: Array<{ title: string; options: string[] }>, selectedLabel: string, placeholder: string) => {
    const selected = parseList(profile[key]);
    const expanded = openPicker === key;
    return (
      <div className="space-y-2">
        <button type="button" onClick={() => setOpenPicker(expanded ? null : key)} className={cn(inputClass, "flex items-center justify-between text-left")}>
          <span className={cn(profile[key] ? "text-text-primary" : "text-text-tertiary")}>{profile[key] || placeholder}</span>
          <span className={cn("text-xs text-text-tertiary transition", expanded && "rotate-180")}>⌄</span>
        </button>
        {expanded && (
          <div className="rounded-2xl border border-surface-border bg-surface-card p-3 shadow-sm">
            <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
              {groups.map((group) => (
                <section key={group.title}>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">{group.title}</div>
                  <div className="grid grid-cols-2 gap-2">
                    {group.options.map((option) => {
                      const active = selected.includes(option);
                      return <button key={`${group.title}-${option}`} type="button" onClick={() => toggleListValue(key, option)} className={cn("min-h-9 rounded-xl border px-3 py-1.5 text-left text-xs font-medium transition", active ? "border-neutral-950 bg-neutral-950 text-white shadow-sm dark:border-white dark:bg-white dark:text-neutral-950" : "border-surface-border bg-surface-elevated text-text-secondary hover:border-neutral-400 hover:text-text-primary")}>{option}</button>;
                    })}
                  </div>
                </section>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-surface-border pt-3 text-xs">
              <span className="min-w-0 flex-1 truncate text-text-tertiary">{selectedLabel}：{profile[key] || "未选择"}</span>
              {profile[key] && <button type="button" onClick={() => clearListValue(key)} className="shrink-0 text-neutral-950 underline dark:text-white">清空</button>}
            </div>
          </div>
        )}
      </div>
    );
  };

  const loadPlans = async () => {
    if (!readAuthState().user) return;
    setPlansLoading(true);
    try {
      const data = await apiJson<any>("/gaokao/plans?limit=8");
      setSavedPlans(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setSavedPlans([]);
    } finally {
      setPlansLoading(false);
    }
  };

  useEffect(() => { loadPlans(); }, []);

  useEffect(() => {
    const getRightSnapX = () => {
      const sideOffset = window.matchMedia("(min-width: 640px)").matches ? 24 : 16;
      return Math.max(8, window.innerWidth - sideOffset - 64);
    };
    const getDefaultY = () => Math.max(88, window.innerHeight - 112);
    setOrbPosition({ x: getRightSnapX(), y: getDefaultY() });
    const handleResize = () => {
      setOrbPosition((prev) => ({
        x: getRightSnapX(),
        y: Math.min(Math.max(88, prev.y || getDefaultY()), window.innerHeight - 80),
      }));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    fetch("/api/gaokao/coverage")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => setCoverageSummary(data?.summary || null))
      .catch(() => setCoverageSummary(null));
  }, []);

  const openHistoryPanel = async () => {
    setHistoryOpen(true);
    await loadPlans();
  };

  const saveCurrentPlan = async () => {
    if (!readAuthState().user) { toast.error("请先登录后再保存志愿方案"); return; }
    setSavingPlan(true);
    try {
      const response = await apiFetch("/gaokao/plans", {
        method: "POST",
        body: JSON.stringify({
          title: `${profile.province}${profile.rank ? ` ${profile.rank}位` : ""}志愿方案`,
          profile: profileToApiShape(profile),
          recommendations,
          summary: `策略：${strategyLabels[profile.strategy]}；共 ${recommendations.length} 个推荐。`,
        }),
      });
      if (!response.ok) throw new Error("save failed");
      toast.success("志愿方案已保存");
      await loadPlans();
    } catch {
      toast.error("保存失败，请稍后重试");
    } finally {
      setSavingPlan(false);
    }
  };

  const restorePlan = async (planId: number) => {
    if (!readAuthState().user) return;
    try {
      const data = await apiJson<any>(`/gaokao/plans/${planId}`);
      setProfile(apiShapeToProfile(data?.profile, profile));
      setApiRecommendations(Array.isArray(data?.recommendations) ? data.recommendations.map(normalizeApiRecommendation) : null);
      setSelectedBand("全部");
      setHistoryOpen(false);
      toast.success("已恢复历史方案");
    } catch {
      toast.error("恢复方案失败");
    }
  };

  const runRiskCheck = async () => {
    const text = riskText.trim();
    if (!text) { toast.error("请先粘贴志愿表文本"); return; }
    setRiskLoading(true);
    try {
      const response = await fetch("/api/gaokao/risk-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: profileToApiShape(profile), text }),
      });
      if (!response.ok) throw new Error("risk check failed");
      const data = await response.json();
      setRiskIssues(Array.isArray(data?.issues) ? data.issues : []);
      setRiskStats(data?.stats || null);
    } catch {
      toast.error("风险体检失败，请稍后重试");
    } finally {
      setRiskLoading(false);
    }
  };



  const runAdvisor = async (profileOverride?: StudentProfile, messageOverride?: string, trackOverride?: "本科" | "专科" | null) => {
    const activeProfile = profileOverride ?? profile;
    const requestTrack = trackOverride ?? activeTrack;
    const activeMessage = messageOverride?.trim() || chatInput.trim() || `我想要${activeProfile.province}${activeProfile.subjects}，位次${activeProfile.rank}，偏好${activeProfile.preferredMajors || requestTrack || "本科"}，请给${requestTrack || "最合理"}方案`;
    setAdvisorLoading(true);
    setAdvisorResult(null);
    setAdvisorEvents([]);
    setActiveDocument("report");
    const pushEvent = (type: string, text: string) => setAdvisorEvents((prev) => [...prev.slice(-12), { type, text }]);
    try {
      const response = await fetch("/api/gaokao/advisor/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          profile: profileToApiShape(activeProfile),
          message: activeMessage,
          allow_web_lookup: true,
          model: "committee",
          track: requestTrack || "",
        }),
      });
      if (!response.ok || !response.body) throw new Error("advisor stream failed");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";
        for (const chunk of chunks) {
          const eventLine = chunk.split("\n").find((line) => line.startsWith("event:"));
          const dataLine = chunk.split("\n").find((line) => line.startsWith("data:"));
          const type = eventLine?.replace("event:", "").trim() || "message";
          const raw = dataLine?.replace("data:", "").trim() || "{}";
          let data: any = {};
          try { data = JSON.parse(raw); } catch {}
          if (type === "intent") pushEvent(type, `理解档案：${data.province}${data.subjects} 位次 ${data.rank}`);
          if (type === "local_recommendations") pushEvent(type, `本地候选 ${data.count || 0} 个${data.needs_web_lookup ? "，需要联网补查" : ""}`);
          if (type === "model_started") pushEvent(type, `模型分析启动：${data.provider}`);
          if (type === "model_analysis") pushEvent(type, `模型分析完成：${data.status}`);
          if (type === "model_report") pushEvent(type, `${data.provider || "model"} ${data.role || ""} 完成：${data.status}`);
          if (type === "model_committee") pushEvent(type, `多模型综合完成：${data.status}`);
          if (type === "model_error") pushEvent(type, `${data.provider || "model"} ${data.role || ""} 回退：${data.message || data.status}`);
          if (type === "search_started") pushEvent(type, `开始联网补查：${data.queries?.length || 0} 个查询`);
          if (type === "source_hits") pushEvent(type, `来源命中：${data.count || 0}`);
          if (type === "evidence_links") pushEvent(type, `可跳转来源链接：${data.count || 0}`);
          if (type === "external_candidates") pushEvent(type, `联网候选抽取：${data.count || 0}`);
          if (type === "external_candidate_plan") pushEvent(type, `待复核方案：保留 ${data.usable_count || 0}，过滤 ${data.rejected_count || 0}`);
          if (type === "advisor_plan_sections") pushEvent(type, `产品方案卡片：${data.count || 0}`);
          if (type === "professional_report") pushEvent(type, "专业志愿报告已生成");
          if (type === "plan_ready") pushEvent(type, "方案生成完成");
          if (type === "done") {
            setAdvisorResult(data);
            pushEvent(type, "Advisor 已完成");
          }
        }
      }
      toast.success("Advisor 已生成实时方案");
    } catch {
      toast.error("Advisor 分析失败，请稍后重试");
    } finally {
      setAdvisorLoading(false);
    }
  };

  const generateVolunteerTable = async () => {
    setVolunteerTableLoading(true);
    try {
      const response = await fetch("/api/gaokao/volunteer-table", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: profileToApiShape(profile),
          recommendations,
        }),
      });
      if (!response.ok) throw new Error("volunteer table failed");
      const data = await response.json();
      setVolunteerTable(data);
      toast.success(`已生成 ${data?.items?.length || currentVolunteerRule.slots} 个志愿位`);
    } catch {
      toast.error("生成志愿表失败，请稍后重试");
    } finally {
      setVolunteerTableLoading(false);
    }
  };

  const snapOrbToRight = (y: number) => {
    if (typeof window === "undefined") return;
    const sideOffset = window.matchMedia("(min-width: 640px)").matches ? 24 : 16;
    const nextX = Math.max(8, window.innerWidth - sideOffset - 64);
    const nextY = Math.min(Math.max(88, y), window.innerHeight - 80);
    setOrbPosition({ x: nextX, y: nextY });
  };

  const handleOrbPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    orbDragRef.current = {
      dragging: true,
      moved: false,
      offsetX: event.clientX - orbPosition.x,
      offsetY: event.clientY - orbPosition.y,
      startX: event.clientX,
      startY: event.clientY,
    };
  };

  const handleOrbPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = orbDragRef.current;
    if (!drag.dragging || typeof window === "undefined") return;
    const movedDistance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (movedDistance > 4) drag.moved = true;
    const nextX = Math.min(Math.max(8, event.clientX - drag.offsetX), window.innerWidth - 72);
    const nextY = Math.min(Math.max(88, event.clientY - drag.offsetY), window.innerHeight - 80);
    setOrbPosition({ x: nextX, y: nextY });
  };

  const handleOrbPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!orbDragRef.current.dragging) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    orbDragRef.current.dragging = false;
    snapOrbToRight(orbPosition.y);
  };

  const handleOrbClick = () => {
    if (orbDragRef.current.moved) {
      orbDragRef.current.moved = false;
      return;
    }
    setAgentOpen((open) => !open);
  };

  const scrollToSection = (id: string) => {
    if (typeof document === "undefined") return;
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const enterTrack = (track: "本科" | "专科") => {
    setActiveTrack(track);
    setSelectedBand("全部");
    setAdvisorResult(null);
    setAdvisorEvents([]);
    setApiRecommendations(null);
    setRecommendError(null);
    setDataSourceNote("");
    setMessages([{ role: "assistant", content: `已进入${track}专项。请先在左侧填写要求，点击右侧“生成报告”后我再开始分析。` }]);
  };

  const handlePageBack = () => {
    if (activeTrack) {
      setActiveTrack(null);
      setAdvisorResult(null);
      setAdvisorEvents([]);
      setApiRecommendations(null);
      setRecommendError(null);
      setDataSourceNote("");
      return;
    }
    window.location.href = "/chat";
  };

  const openSettings = () => {
    window.location.href = "/settings";
  };

  const sendMessage = async () => {
    const text = chatInput.trim();
    if (!text) return;
    setChatInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }, { role: "assistant", content: "正在理解你的调整..." }]);
    try {
      const response = await fetch("/api/gaokao/agent-adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: text, profile: profileToApiShape(profile) }),
      });
      if (!response.ok) throw new Error("agent failed");
      const data = await response.json();
      const next = apiShapeToProfile(data?.profile, profile);
      const patchSummary = summarizeProfilePatch(data?.profile_patch);
      setProfile(next);
      setMessages((prev) => {
        const base = prev.slice(0, -1);
        return [...base, { role: "assistant", content: `${data?.reply || "已按你的要求调整并重新推荐。"}${patchSummary ? `\n\n本次修改：\n${patchSummary}` : ""}` }];
      });
      if (data?.rerun_advisor !== false) {
        setMessages((prev) => [...prev, { role: "assistant", content: "正在按新条件重新生成方案..." }]);
        await runAdvisor(next, data?.advisor_message || text);
        setMessages((prev) => [...prev, { role: "assistant", content: "方案已更新。" }]);
      }
    } catch {
      const { next, reply } = updateProfileFromCommand(profile, text);
      setProfile(next);
      setMessages((prev) => {
        const base = prev.slice(0, -1);
        return [...base, { role: "assistant", content: `${reply}（后端 Agent 暂不可用，已使用本地降级解析。）` }];
      });
      setMessages((prev) => [...prev, { role: "assistant", content: "正在按新条件重新生成方案..." }]);
      await runAdvisor(next, text);
      setMessages((prev) => [...prev, { role: "assistant", content: "方案已更新。" }]);
    }
  };

  const resetProfile = () => {
    setProfile(defaultProfile);
    setSelectedBand("全部");
    setMessages([{ role: "assistant", content: "已恢复默认样例档案。你可以继续修改位次、城市、专业和风险策略。" }]);
  };

  const exportReport = () => {
    const lines = [
      "# AI Space 高考志愿方案",
      "",
      `- 省份：${profile.province}`,
      `- 分数：${profile.score}`,
      `- 位次：${profile.rank}`,
      `- 选科：${profile.subjects}`,
      `- 策略：${strategyLabels[profile.strategy]}`,
      `- 城市偏好：${profile.preferredCities}`,
      `- 专业偏好：${profile.preferredMajors}`,
      "",
      "> AI 推荐仅供参考，不构成录取承诺；最终以省考试院和高校招生章程为准。",
      "",
      "## 推荐清单",
      ...recommendations.map((item, index) => `\n${index + 1}. 【${item.band}】${item.school} - ${item.major}｜${item.city}｜近三年位次 ${item.ranks.join("/")}｜风险 ${item.riskScore}%\n   - ${item.reason.join(" ")}`),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gaokao-volunteer-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("志愿报告已导出");
  };

  return (
    <div className="flex h-screen min-w-0 flex-col overflow-hidden bg-surface text-text-primary">
      <header className="shrink-0 border-b border-surface-border bg-surface-elevated/85 px-4 py-3 backdrop-blur-xl">
        <div className="grid grid-cols-[44px_1fr_44px] items-center gap-3">
          <button onClick={handlePageBack} className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-surface-border bg-surface-card text-text-secondary transition hover:border-neutral-400 hover:text-neutral-950 dark:hover:text-white" aria-label="返回上一层">
            <ArrowRight className="h-4 w-4 rotate-180" />
          </button>
          <div className="min-w-0 text-center">
            <h1 className="truncate text-lg font-semibold tracking-tight text-text-primary">
              {activeTrack ? `${activeTrack}专项` : t("gaokao.navLabel")}
            </h1>
            <p className="mt-0.5 truncate text-xs text-text-tertiary">{activeTrack ? `当前在${activeTrack}专项工作台` : "选择填报入口"}</p>
          </div>
          <button onClick={openSettings} className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-surface-border bg-surface-card text-text-secondary transition hover:border-neutral-400 hover:text-neutral-950 dark:hover:text-white" aria-label="设置">
            <SlidersHorizontal className="h-4 w-4" />
          </button>
        </div>
      </header>

      {historyOpen && (
        <div className="fixed inset-0 z-40">
          <button className="absolute inset-0 bg-slate-950/20 backdrop-blur-[1px]" onClick={() => setHistoryOpen(false)} aria-label="关闭历史方案" />
          <aside className="absolute right-0 top-0 flex h-full w-[min(420px,100vw)] flex-col border-l border-surface-border bg-surface-elevated shadow-2xl">
            <div className="flex items-center justify-between border-b border-surface-border px-5 py-4">
              <div>
                <div className="flex items-center gap-2 text-base font-semibold text-text-primary"><History className="h-4 w-4 text-neutral-950 dark:text-white" /> 历史方案</div>
                <p className="mt-1 text-xs text-text-tertiary">点击任一方案恢复档案和推荐结果。</p>
              </div>
              <button onClick={() => setHistoryOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-surface-border bg-surface-card text-text-tertiary transition hover:text-text-primary" aria-label="关闭">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <button onClick={loadPlans} className="mb-4 inline-flex items-center gap-2 rounded-xl border border-surface-border bg-surface-card px-3 py-2 text-xs text-text-secondary transition hover:border-neutral-400 hover:text-neutral-950 dark:hover:text-white">
                <RefreshCw className={cn("h-3.5 w-3.5", plansLoading && "animate-spin")} /> 刷新历史
              </button>
              {plansLoading ? <div className="rounded-2xl border border-surface-border bg-surface-card p-4 text-sm text-text-tertiary">加载中...</div> : savedPlans.length === 0 ? <div className="rounded-2xl border border-dashed border-surface-border bg-surface-card/70 p-6 text-sm leading-relaxed text-text-tertiary">登录后保存的方案会显示在这里。当前没有可恢复的历史方案。</div> : (
                <div className="space-y-3">
                  {savedPlans.map((plan) => (
                    <button key={plan.id} onClick={() => restorePlan(plan.id)} className="w-full rounded-2xl border border-surface-border bg-surface-card p-4 text-left text-sm text-text-secondary shadow-sm transition hover:border-neutral-400 hover:text-text-primary hover:shadow-md">
                      <div className="truncate font-semibold text-text-primary">{plan.title}</div>
                      <div className="mt-2 text-xs leading-relaxed text-text-tertiary">{plan.province || "-"} · {plan.score ? `${plan.score}分` : "未填分数"} · {plan.rank ? `${plan.rank}位` : "未填位次"}</div>
                      <div className="mt-1 text-xs text-text-tertiary">策略：{plan.strategy ? strategyLabels[plan.strategy as Strategy] || plan.strategy : "-"}</div>
                      <div className="mt-3 text-xs text-neutral-950 dark:text-white">恢复此方案</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>
      )}

      {!activeTrack ? (
        <main className="min-h-0 flex-1 overflow-y-auto bg-surface px-6 py-8">
          <section className="mx-auto flex max-w-6xl flex-col gap-8">
            <div className="rounded-[2rem] border border-surface-border bg-surface-card/90 p-8 shadow-sm">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-neutral-950 dark:text-white"><Sparkles className="h-3.5 w-3.5" /> Gaokao Advisor</div>
              <h2 className="text-3xl font-semibold tracking-tight text-text-primary">先选择你的填报入口</h2>
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-text-secondary">本科、专科、补录和专升本规则不同，先选专项再进入查询工作台。当前先开放本科批次和专科批次；补录和专升本等时间/规则开放后再启用。</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <button onClick={() => enterTrack("本科")} className="group rounded-[1.75rem] border border-neutral-200 dark:border-surface-border bg-gradient-to-br from-brand/15 via-white to-white dark:via-surface-card dark:to-surface-card p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-neutral-400 dark:border-surface-border hover:shadow-lg hover:shadow-black/5">
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-neutral-200 bg-neutral-50 text-neutral-950 dark:border-surface-border dark:bg-surface-elevated dark:text-white"><GraduationCap className="h-5 w-5" /></div>
                <div className="text-lg font-semibold text-text-primary">本科批次</div>
                <p className="mt-2 min-h-[72px] text-sm leading-relaxed text-text-secondary">专门推荐本科批，重点看本科批、组内专业、调剂风险和官方来源。</p>
                <div className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-neutral-950 dark:text-white">进入本科专项 <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" /></div>
              </button>
              <button onClick={() => enterTrack("专科")} className="group rounded-[1.75rem] border border-emerald-500/25 bg-surface-card/90 p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-500/50 hover:shadow-lg">
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"><BookOpen className="h-5 w-5" /></div>
                <div className="text-lg font-semibold text-text-primary">专科批次</div>
                <p className="mt-2 min-h-[72px] text-sm leading-relaxed text-text-secondary">专门推荐专科批，不和本科混排，适合作为独立兜底路径。</p>
                <div className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-emerald-600 dark:text-emerald-300">进入专科专项 <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" /></div>
              </button>
              {[
                { title: "补录本科", desc: "征集/补录本科入口，等考试院公布后开启。" },
                { title: "补录专科", desc: "征集/补录专科入口，等考试院公布后开启。" },
                { title: "专升本", desc: "专升本专项暂未开放，后续接入对应规则。" },
              ].map((item) => (
                <div key={item.title} title="时间未到暂不开启" className="group cursor-not-allowed rounded-[1.75rem] border border-dashed border-surface-border bg-surface-card/55 p-5 text-left opacity-80 shadow-sm transition hover:border-amber-400/50">
                  <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-elevated text-text-tertiary"><AlertTriangle className="h-5 w-5" /></div>
                  <div className="text-lg font-semibold text-text-primary">{item.title}</div>
                  <p className="mt-2 min-h-[72px] text-sm leading-relaxed text-text-secondary">{item.desc}</p>
                  <div className="mt-5 inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 opacity-0 transition group-hover:opacity-100 dark:text-amber-200">时间未到暂不开启</div>
                </div>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-3xl border border-surface-border bg-surface-card/80 p-5 text-sm leading-relaxed text-text-secondary"><div className="mb-1 font-medium text-text-primary">双模型 Advisor</div>DeepSeek + GPT 协同分析，生成可解释方案。</div>
              <div className="rounded-3xl border border-surface-border bg-surface-card/80 p-5 text-sm leading-relaxed text-text-secondary"><div className="mb-1 font-medium text-text-primary">来源可核验</div>展示考试院、招生网、第三方链接，点击即可跳转。</div>
              <div className="rounded-3xl border border-surface-border bg-surface-card/80 p-5 text-sm leading-relaxed text-text-secondary"><div className="mb-1 font-medium text-text-primary">对话可修改</div>进入专项后可用右下角 Agent 继续调整条件。</div>
            </div>
          </section>
        </main>
      ) : (
      <main className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden bg-surface xl:grid-cols-[320px_minmax(420px,1fr)_400px]">
        <aside className="min-h-0 overflow-y-auto border-r border-surface-border bg-surface-elevated/45 px-4 py-5">
          <section className="space-y-4 rounded-3xl border border-surface-border bg-surface-card/90 p-4 shadow-sm">
            <div>
              <div className="flex items-center gap-2 text-base font-semibold text-text-primary"><GraduationCap className="h-4 w-4 text-neutral-950 dark:text-white" /> {activeTrack}专项要求</div>
              <p className="mt-1 text-xs leading-relaxed text-text-tertiary">只生成{activeTrack}通道方案；修改条件后点击右侧查询。</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="省份">
                <select className={inputClass} value={profile.province} onChange={(e) => updateField("province", e.target.value)}>
                  <option value="">请选择</option>
                  {provinceOptions.map((province) => <option key={province} value={province}>{province}</option>)}
                </select>
              </Field>
              <Field label="分数"><input className={inputClass} type="number" value={profile.score} placeholder="请输入" onChange={(e) => updateField("score", e.target.value === "" ? "" : Number(e.target.value))} /></Field>
            </div>
            <Field label="全省位次"><input className={inputClass} type="number" value={profile.rank} placeholder="请输入" onChange={(e) => updateField("rank", e.target.value === "" ? "" : Number(e.target.value))} /></Field>
            <Field label="选科 / 科类">
              <select className={inputClass} value={profile.subjects} onChange={(e) => updateField("subjects", e.target.value)}>
                <option value="">请选择</option>
                {subjectOptions.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
              </select>
            </Field>
            <Field label="城市偏好">{renderGroupedPicker("preferredCities", cityOptionGroups, "已选", "按省份/区域选择城市")}</Field>
            <Field label="专业偏好">{renderGroupedPicker("preferredMajors", majorOptionGroups, "已选", "按专业门类选择")}</Field>
            <Field label="排除专业">{renderExpandablePicker("rejectedMajors", rejectedMajorOptions, "已排除", "点击展开选择要排除的专业")}</Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="学校类型">
                <select className={inputClass} value={profile.schoolType} onChange={(e) => updateField("schoolType", e.target.value as StudentProfile["schoolType"])}>
                  <option value="">请选择</option><option>不限</option><option>公办优先</option><option>只看公办</option>
                </select>
              </Field>
              <Field label="学费上限"><input className={inputClass} value={profile.tuitionLimit} placeholder="可不填" onChange={(e) => updateField("tuitionLimit", e.target.value)} /></Field>
            </div>
            <Field label="推荐策略">
              <select className={inputClass} value={profile.strategy} onChange={(e) => updateField("strategy", e.target.value as Strategy)}>
                {Object.entries(strategyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            <div className="space-y-2 text-sm text-text-secondary">
              <label className="flex items-center gap-2"><input type="checkbox" checked={profile.acceptCooperation} onChange={(e) => updateField("acceptCooperation", e.target.checked)} /> 接受中外合作</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={profile.obeyAdjustment} onChange={(e) => updateField("obeyAdjustment", e.target.checked)} /> 倾向服从调剂</label>
            </div>
          </section>
        </aside>

        <section className="flex min-h-0 flex-col border-r border-surface-border bg-surface px-4 py-5">
          <div className="mb-4 rounded-3xl border border-surface-border bg-surface-card/90 p-4 shadow-sm">
            <div className="flex items-center gap-2 text-base font-semibold text-text-primary"><Bot className="h-4 w-4 text-neutral-950 dark:text-white" /> 志愿 Agent</div>
            <p className="mt-1 text-xs leading-relaxed text-text-tertiary">在这里和 Agent 沟通修改方案，右侧文档会按新条件重新生成。</p>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-3xl border border-surface-border bg-surface-card/70 p-4">
            {messages.map((message, index) => (
              <div key={index} className={cn("whitespace-pre-wrap rounded-2xl px-3 py-2.5 text-sm leading-relaxed", message.role === "user" ? "ml-12 bg-neutral-950 text-white dark:bg-white dark:text-neutral-950" : "mr-12 border border-surface-border bg-surface-elevated text-text-secondary")}>
                {message.content}
              </div>
            ))}
            {advisorLoading && (
              <div className="rounded-2xl border border-neutral-200 dark:border-surface-border bg-neutral-50 dark:bg-surface-elevated/50 px-3 py-2 text-sm text-text-secondary">
                正在后台查询资料并生成报告，完成后会出现在右侧文档区。
              </div>
            )}
          </div>
          <div className="mt-4 rounded-3xl border border-surface-border bg-surface-card/90 p-3">
            <div className="mb-2 flex flex-wrap gap-2">
              {["只看公办", "冲刺少一点", "专业优先：计算机", "学费不超过15000", "不要医学土木", "只看省内"].map((cmd) => (
                <button key={cmd} onClick={() => setChatInput(cmd)} className="rounded-full border border-surface-border px-2.5 py-1 text-xs text-text-secondary transition hover:border-neutral-400 hover:text-text-primary">{cmd}</button>
              ))}
            </div>
            <div className="flex items-end gap-2">
              <textarea value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} placeholder="例如：只要省内公办，保底再稳一点..." className="min-h-[52px] flex-1 resize-none rounded-2xl border border-surface-border bg-surface-elevated px-3 py-2.5 text-sm text-text-primary outline-none transition focus:border-neutral-400 dark:border-surface-border focus:ring-2 focus:ring-brand/15" />
              <button onClick={sendMessage} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-neutral-950 text-white dark:bg-white dark:text-neutral-950 transition hover:bg-neutral-800 dark:hover:bg-neutral-200"><Send className="h-4 w-4" /></button>
            </div>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col overflow-hidden bg-[#f7f7fb] px-4 py-5 dark:bg-surface-elevated/35">
          <div className="mb-4 rounded-[28px] border border-surface-border bg-surface-card shadow-sm">
            <div className="flex items-center justify-between border-b border-surface-border px-5 py-4">
              <div>
                <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-text-primary">输出</h2>
                <p className="mt-1 text-xs text-text-tertiary">像 Notebook 一样生成文件，点击预览或下载。</p>
              </div>
              <button onClick={() => runAdvisor(profile, `进入${activeTrack}专项，按当前条件生成完整志愿报告`, activeTrack)} disabled={advisorLoading} className="rounded-full bg-neutral-950 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-black/10 transition hover:bg-neutral-800 disabled:opacity-70 dark:bg-white dark:text-neutral-950">
                生成报告
              </button>
            </div>
            <div className="px-5 pb-4 pt-3">
              <div className="text-[15px] font-semibold tracking-[-0.01em] text-text-primary">文件</div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-[28px] border border-surface-border bg-surface-card p-4 shadow-sm">
            {advisorLoading && (
              <div className="mb-2 rounded-[18px] bg-surface-elevated/70 px-2.5 py-3">
                <div className="flex items-center gap-3.5 pr-2 text-left">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center">
                    <RefreshCw className="h-[25px] w-[25px] animate-spin text-neutral-950 dark:text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold leading-5 tracking-[-0.01em] text-text-primary">{activeTrack}专项志愿规划报告</div>
                    <div className="mt-1 text-[12px] leading-4 text-text-tertiary">正在后台查询、分析并生成文件...</div>
                  </div>
                </div>
              </div>
            )}

            {!advisorResult && !advisorLoading ? (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <div className="relative mb-4 text-text-tertiary">
                  <Sparkles className="absolute -right-2 -top-1 h-3.5 w-3.5 text-neutral-950 dark:text-white" />
                  <FileText className="h-9 w-9" />
                </div>
                <p className="text-sm font-medium text-text-primary">还没有生成文件</p>
                <p className="mt-2 max-w-[260px] text-xs leading-5 text-text-tertiary">点击右上角“生成报告”，完成后这里会出现报告文件。</p>
              </div>
            ) : advisorResult ? (
              <div className="space-y-1.5">
                <div className="group relative rounded-[18px] transition hover:bg-surface-elevated/70">
                  <div className="flex w-full items-center gap-3.5 px-2.5 py-3 pr-20 text-left">
                    <button type="button" onClick={() => setReportPreviewOpen(true)} className="flex h-10 w-10 shrink-0 items-center justify-center">
                      <FileText className="h-[25px] w-[25px] text-neutral-950 dark:text-white" />
                    </button>
                    <button type="button" onClick={() => setReportPreviewOpen(true)} className="min-w-0 flex-1 text-left">
                      <div className="truncate text-[14px] font-semibold leading-5 tracking-[-0.01em] text-text-primary">{activeTrack}专项志愿规划报告</div>
                      <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-text-tertiary">
                        <span className="truncate">报告 · 院校 · 来源</span><span>·</span><span>刚刚</span>
                      </div>
                    </button>
                    <button type="button" onClick={exportReport} className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-text-tertiary opacity-0 transition hover:bg-surface-hover hover:text-neutral-950 dark:text-white group-hover:opacity-100" title="下载">
                      <Download className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </aside>
      </main>
      )}
      {reportPreviewOpen && advisorResult && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-6 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="flex h-[86vh] w-[min(1120px,92vw)] flex-col overflow-hidden rounded-3xl border border-surface-border bg-surface-card shadow-2xl">
            <div className="flex items-start gap-3 border-b border-surface-border px-6 py-4">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-text-tertiary">Document Preview</div>
                <h3 className="mt-1 line-clamp-2 text-xl font-bold tracking-[-0.01em] text-text-primary">{activeTrack}专项志愿规划报告</h3>
              </div>
              <button type="button" onClick={exportReport} className="mt-1 rounded-full p-2 text-text-tertiary transition hover:bg-surface-hover hover:text-neutral-950 dark:text-white" title="下载"><Download className="h-5 w-5" /></button>
              <button type="button" onClick={() => setReportPreviewOpen(false)} className="mt-1 rounded-full p-2 text-text-tertiary transition hover:bg-surface-hover hover:text-text-primary" title="关闭"><X className="h-5 w-5" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-surface-card p-6">
              <article className="mx-auto max-w-4xl text-sm leading-7 text-text-secondary">
                  <h2 className="text-3xl font-semibold tracking-[-0.03em] text-text-primary">{activeTrack}专项志愿规划报告</h2>
                  <p className="mt-3 text-base leading-8 text-text-secondary">{advisorResult.agent_analysis?.summary || "已生成专项推荐。"}</p>

                  {(advisorResult.professional_report?.profile_summary || advisorResult.professional_report?.strategy_summary) && (
                    <section className="mt-6 rounded-2xl border border-surface-border bg-surface-elevated/55 p-5">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">Candidate Profile</div>
                      <div className="mt-2 text-base font-medium text-text-primary">{advisorResult.professional_report?.profile_summary}</div>
                      <p className="mt-2 text-text-secondary">{advisorResult.professional_report?.strategy_summary}</p>
                    </section>
                  )}

                  <section className="mt-7">
                    <div className="flex items-end justify-between gap-3">
                      <h3 className="text-xl font-semibold text-text-primary">冲稳保主表</h3>
                      <span className="text-xs text-text-tertiary">概率为经验估计，最终以考试院/高校官网为准</span>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      {["冲", "稳", "保"].map((band) => (
                        <section key={band} className="rounded-2xl border border-surface-border bg-surface-elevated/45 p-4">
                          <div className="mb-3 flex items-center justify-between"><strong className="text-text-primary">{band}</strong><span className="text-xs text-text-tertiary">{advisorResult.professional_report?.bands?.[band]?.length || 0} 所</span></div>
                          <div className="space-y-2">
                            {(advisorResult.professional_report?.bands?.[band] || []).slice(0, 5).map((item: any, i: number) => (
                              <div key={`${band}-${item.school}-${i}`} className="rounded-xl bg-surface-card px-3 py-2">
                                <div className="font-medium text-text-primary">{item.school}</div>
                                <div className="mt-0.5 text-xs text-text-tertiary">{item.recommended_majors || "专业待核验"} · {item.reference_rank || "位次待核验"} · {item.admission_chance || "概率待估"}</div>
                              </div>
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  </section>

                  <section className="mt-7">
                    <h3 className="text-xl font-semibold text-text-primary">最推荐 Top 10</h3>
                    <div className="mt-3 overflow-hidden rounded-2xl border border-surface-border">
                      {(advisorResult.professional_report?.top_recommendations || []).slice(0, 10).map((item: any, index: number) => (
                        <div key={`${item.school}-${index}`} className="grid gap-3 border-b border-surface-border bg-surface-card p-4 last:border-b-0 md:grid-cols-[44px_1fr_auto]">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 text-sm font-semibold text-neutral-950 dark:bg-surface-elevated dark:text-white">{index + 1}</div>
                          <div>
                            <div className="font-semibold text-text-primary">{item.school}</div>
                            <div className="mt-1 text-xs text-text-tertiary">{item.school_level || "层级待核验"} · {item.city || "城市待核验"} · 参考位次 {item.reference_rank || "-"}</div>
                            <div className="mt-2 text-sm text-text-secondary">推荐专业：{item.recommended_majors || "待核验"}</div>
                            {item.why_recommend && <div className="mt-1 text-sm text-text-secondary">理由：{item.why_recommend}</div>}
                            {Array.isArray(item.strength_tags) && item.strength_tags.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{item.strength_tags.map((tag: string) => <span key={tag} className="rounded-full border border-surface-border px-2 py-0.5 text-[11px] text-text-tertiary">{tag}</span>)}</div>}
                          </div>
                          <div className="text-right text-xs text-text-tertiary"><div className="font-semibold text-text-primary">{item.admission_chance || "-"}</div><div>{item.advice || ""}</div></div>
                        </div>
                      ))}
                    </div>
                  </section>

                  {(advisorResult.professional_report?.school_overviews?.length || 0) > 0 && (
                    <section className="mt-7">
                      <h3 className="text-xl font-semibold text-text-primary">院校优势概览</h3>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        {advisorResult.professional_report.school_overviews.slice(0, 8).map((item: any) => (
                          <div key={item.school} className="rounded-2xl border border-surface-border bg-surface-elevated/45 p-4">
                            <div className="flex items-center justify-between"><strong className="text-text-primary">{item.school}</strong><span className="text-xs text-text-tertiary">{item.recommend_index}</span></div>
                            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-text-secondary">{(item.advantages || []).map((adv: string) => <li key={adv}>{adv}</li>)}</ul>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {(advisorResult.professional_report?.major_ranking?.length || 0) > 0 && (
                    <section className="mt-7">
                      <h3 className="text-xl font-semibold text-text-primary">推荐专业排序</h3>
                      <div className="mt-3 space-y-2">
                        {advisorResult.professional_report.major_ranking.map((item: any) => (
                          <div key={item.major} className="rounded-2xl border border-surface-border bg-surface-elevated/45 p-4">
                            <div className="flex items-center justify-between"><strong className="text-text-primary">{item.rank}. {item.major}</strong><span className="text-xs text-text-tertiary">{item.recommend_index}</span></div>
                            <div className="mt-1 text-sm text-text-secondary">就业：{item.employment}</div>
                            <div className="mt-1 text-sm text-text-tertiary">{item.reason}</div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  <section className="mt-7 grid gap-3 md:grid-cols-3">
                    <div className="rounded-2xl border border-surface-border bg-surface-elevated/45 p-4"><strong className="text-text-primary">冲刺</strong><div className="mt-2 text-sm text-text-secondary">{(advisorResult.professional_report?.final_suggestion?.chong || []).join("、") || "少量保留"}</div></div>
                    <div className="rounded-2xl border border-surface-border bg-surface-elevated/45 p-4"><strong className="text-text-primary">主力</strong><div className="mt-2 text-sm text-text-secondary">{(advisorResult.professional_report?.final_suggestion?.core || []).join("、") || "以稳妥匹配为主"}</div></div>
                    <div className="rounded-2xl border border-surface-border bg-surface-elevated/45 p-4"><strong className="text-text-primary">保底</strong><div className="mt-2 text-sm text-text-secondary">{(advisorResult.professional_report?.final_suggestion?.safe || []).join("、") || "确保安全边际"}</div></div>
                  </section>

                  <section className="mt-7 rounded-2xl border border-surface-border bg-surface-elevated/45 p-4">
                    <h3 className="font-semibold text-text-primary">风险与复核</h3>
                    <ul className="mt-2 list-disc space-y-1 pl-5">{(advisorResult.professional_report?.risk_notes || []).map((note: string) => <li key={note}>{note}</li>)}</ul>
                    <p className="mt-3 text-xs text-text-tertiary">{advisorResult.professional_report?.disclaimer}</p>
                  </section>
                </article>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
