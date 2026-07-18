"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
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
  MoreHorizontal,
  RefreshCw,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Trash2,
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

type ReportHistoryItem = {
  id: string;
  title: string;
  subtitle: string;
  createdAtLabel?: string;
  createdAt?: string;
  track?: "本科" | "专科" | string;
  result: any;
};

const formatHistoryTime = (createdAt?: string, fallback?: string) => {
  if (!createdAt) return fallback || "刚刚";
  const time = new Date(createdAt).getTime();
  if (!Number.isFinite(time)) return fallback || "刚刚";
  const diff = Math.max(0, Date.now() - time);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)}分钟前`;
  if (diff < 2 * hour) return "1小时前";
  if (diff < day) return `${Math.floor(diff / hour)}小时前`;
  if (diff < 2 * day) return "1天前";
  if (diff < 7 * day) return `${Math.floor(diff / day)}天前`;
  if (diff < 14 * day) return "一周前";
  if (diff < 30 * day) return `${Math.floor(diff / (7 * day))}周前`;
  if (diff < 60 * day) return "一个月前";
  return `${Math.floor(diff / (30 * day))}个月前`;
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

function Field({ label, children, required = false }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1 text-xs font-medium text-text-tertiary">
        <span>{label}</span>
        <span className={cn("rounded-full px-1.5 py-0.5 text-[10px]", required ? "bg-neutral-950 text-white dark:bg-white dark:text-neutral-950" : "bg-neutral-100 text-text-tertiary dark:bg-surface-elevated")}>{required ? "必填" : "可选"}</span>
      </span>
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

const wordTableBorders = {
  top: { style: BorderStyle.SINGLE, size: 1, color: "D0D7DE" },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: "D0D7DE" },
  left: { style: BorderStyle.SINGLE, size: 1, color: "D0D7DE" },
  right: { style: BorderStyle.SINGLE, size: 1, color: "D0D7DE" },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "D0D7DE" },
  insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "D0D7DE" },
};

const markdownInlineRuns = (text: string, opts?: { bold?: boolean }) => {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part) => {
    const strong = part.startsWith("**") && part.endsWith("**");
    return new TextRun({ text: strong ? part.slice(2, -2) : part, bold: opts?.bold || strong, size: 22, font: "Microsoft YaHei" });
  });
};

const markdownToWordChildren = (markdown: string) => {
  const children: Array<Paragraph | Table> = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line || line === "---") {
      children.push(new Paragraph({ spacing: { after: 80 } }));
      continue;
    }
    if (line.startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const current = lines[i].trim();
        if (!/^\|\s*:?-{3,}:?/.test(current)) tableLines.push(current);
        i += 1;
      }
      i -= 1;
      const rows = tableLines.map((tableLine, rowIndex) => {
        const cells = tableLine.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
        return new TableRow({
          children: cells.map((cell) => new TableCell({
            shading: rowIndex === 0 ? { fill: "EEF4FF" } : undefined,
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
            children: [new Paragraph({ children: markdownInlineRuns(cell, { bold: rowIndex === 0 }) })],
          })),
        });
      });
      if (rows.length) children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: wordTableBorders, rows }));
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      children.push(new Paragraph({
        heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
        spacing: { before: level === 1 ? 120 : 180, after: 100 },
        children: markdownInlineRuns(heading[2], { bold: true }),
      }));
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      children.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 80 }, children: markdownInlineRuns(line.replace(/^[-*]\s+/, "")) }));
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      children.push(new Paragraph({ numbering: { reference: "report-numbering", level: 0 }, spacing: { after: 80 }, children: markdownInlineRuns(line.replace(/^\d+\.\s+/, "")) }));
      continue;
    }
    children.push(new Paragraph({ spacing: { after: 100 }, children: markdownInlineRuns(line.replace(/^>\s*/, "")) }));
  }
  return children;
};

const buildAdvisorReportDocxBlob = async (markdown: string) => {
  const doc = new Document({
    styles: { default: { document: { run: { font: "Microsoft YaHei" }, paragraph: { spacing: { line: 320 } } } } },
    numbering: { config: [{ reference: "report-numbering", levels: [{ level: 0, format: "decimal", text: "%1.", alignment: AlignmentType.LEFT }] }] },
    sections: [{ properties: {}, children: markdownToWordChildren(markdown) }],
  });
  return Packer.toBlob(doc);
};

export default function GaokaoVolunteerPage() {
  const { t } = useI18n();
  const [profile, setProfile] = useState<StudentProfile>(defaultProfile);
  const [selectedBand, setSelectedBand] = useState<RiskBand | "全部">("全部");
  const [activeTrack, setActiveTrack] = useState<"本科" | "专科" | null>(null);
  const [guideMode, setGuideMode] = useState<"city" | "major" | "comprehensive" | null>(null);
  const [guideAnswers, setGuideAnswers] = useState<Record<string, string[]>>({});
  const [guideSubmitted, setGuideSubmitted] = useState(false);
  const [guideLoading, setGuideLoading] = useState(false);
  const [guideProgress, setGuideProgress] = useState(0);
  const [guideResult, setGuideResult] = useState("");
  const [guideData, setGuideData] = useState<any>(null);
  const [guideHistoryOpen, setGuideHistoryOpen] = useState(false);
  const [guideHistory, setGuideHistory] = useState<any[]>([]);
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
  const [reportHistory, setReportHistory] = useState<ReportHistoryItem[]>([]);
  const [reportHistoryReady, setReportHistoryReady] = useState(false);
  const [, setHistoryClock] = useState(0);
  const [openReportMenuId, setOpenReportMenuId] = useState<string | null>(null);
  const [advisorEvents, setAdvisorEvents] = useState<Array<{ type: string; text: string }>>([]);
  const [activeDocument, setActiveDocument] = useState<"report" | "sources" | "candidates">("report");
  const [reportPreviewOpen, setReportPreviewOpen] = useState(false);
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const [reportProgress, setReportProgress] = useState(0);
  const [reportStage, setReportStage] = useState("等待生成");
  const [openPicker, setOpenPicker] = useState<"preferredCities" | "preferredMajors" | "rejectedMajors" | null>(null);
  const [volunteerTable, setVolunteerTable] = useState<VolunteerTable | null>(null);
  const [volunteerTableLoading, setVolunteerTableLoading] = useState(false);
  const [riskText, setRiskText] = useState("");
  const [riskIssues, setRiskIssues] = useState<RiskIssue[]>([]);
  const [riskStats, setRiskStats] = useState<Record<string, number> | null>(null);
  const [riskLoading, setRiskLoading] = useState(false);
  const orbDragRef = useRef<{ dragging: boolean; moved: boolean; offsetX: number; offsetY: number; startX: number; startY: number }>({ dragging: false, moved: false, offsetX: 0, offsetY: 0, startX: 0, startY: 0 });
  const reportArticleRef = useRef<HTMLDivElement | null>(null);
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
    try {
      const raw = localStorage.getItem("gaokao-guide-history");
      if (raw) setGuideHistory(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("gaokao-report-history");
      if (raw) {
        const parsed = JSON.parse(raw);
        setReportHistory(Array.isArray(parsed) ? parsed.map((item) => {
          if (item?.createdAt) return item;
          const timestamp = Number(String(item?.id || "").split("-")[0]);
          return Number.isFinite(timestamp) && timestamp > 0 ? { ...item, createdAt: new Date(timestamp).toISOString() } : item;
        }) : []);
      }
    } catch {}
    setReportHistoryReady(true);
  }, []);

  useEffect(() => {
    if (!reportHistoryReady) return;
    try { localStorage.setItem("gaokao-report-history", JSON.stringify(reportHistory.slice(0, 50))); } catch {}
  }, [reportHistory, reportHistoryReady]);

  useEffect(() => {
    const timer = window.setInterval(() => setHistoryClock((value) => value + 1), 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!guideLoading) return;
    setGuideProgress(8);
    const timer = window.setInterval(() => {
      setGuideProgress((prev) => Math.min(92, prev + (prev < 35 ? 7 : prev < 70 ? 5 : 2)));
    }, 900);
    return () => window.clearInterval(timer);
  }, [guideLoading]);

  const saveGuideHistory = (record: any) => {
    const next = [record, ...guideHistory].slice(0, 30);
    setGuideHistory(next);
    try { localStorage.setItem("gaokao-guide-history", JSON.stringify(next)); } catch {}
  };

  const cleanGuideText = (value: unknown) => String(value ?? "")
    .replace(/\(\[[^\]]+\]\([^\)]+\)\)/g, "")
    .replace(/\[[^\]]+\]\([^\)]+\)/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/utm_source=openai/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  const cleanAdvisorMarkdown = (value: unknown) => String(value ?? "")
    .replace(/\((?:https?:\/\/)?[A-Za-z0-9.-]+\.[A-Za-z]{2,}[^)]*\)/g, "")
    .replace(/\[[^\]]+\]\(https?:\/\/[^)]+\)/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/utm_source=openai/gi, "")
    .replace(/（专业最低位次待核验）|\(专业最低位次待核验\)|专业最低位次待核验|\[专业最低位次:待核验\]/g, "")
    .trim();

  const guideRecordToMarkdown = (record: any) => {
    if (typeof record.data === "string") return cleanGuideText(record.data);
    const d = record.data || {};
    const rows = (d.table_rows || []).map((row: any) => `| ${cleanGuideText(row.name)} | ${row.score ?? ""} | ${(row.cells || []).map((cell: string) => cleanGuideText(cell)).join(" | ")} |`).join("\n");
    const header = `| 项目 | 分数 | ${(d.table_columns || []).join(" | ")} |`;
    const sep = `|---|---|${(d.table_columns || []).map(() => "---").join("|")}|`;
    return `# ${cleanGuideText(d.title || record.title)}\n\n${cleanGuideText(d.summary || "")}\n\n## 推荐表格\n\n${header}\n${sep}\n${rows}\n\n## 匹配度\n${(d.bar_chart?.items || []).map((i: any) => `- ${i.label}: ${i.value}`).join("\n")}\n\n## 因素权重\n${(d.pie_chart?.items || []).map((i: any) => `- ${i.label}: ${i.value}%`).join("\n")}\n\n## 趋势\n${(d.trend_chart?.items || []).map((i: any) => `- ${i.label}: ${i.value}`).join("\n")}\n\n## 下一步\n${(d.next_steps || []).map((s: string) => `- ${s}`).join("\n")}`;
  };

  const downloadGuideRecord = async (record: any) => {
    const content = guideRecordToMarkdown(record);
    const blob = await buildAdvisorReportDocxBlob(content);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const filename = cleanGuideText(record.mode || record.title || "高考推荐文档").replace(/[\\/:*?"<>|]/g, "-");
    a.download = `${filename || "高考推荐文档"}.docx`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Word 文档已下载");
  };

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



  const profileDraftKey = (track: string) => `gaokao-${track}-profile-draft`;

  const loadProfileDraft = (track: string): StudentProfile | null => {
    try {
      const raw = localStorage.getItem(profileDraftKey(track));
      if (!raw) return null;
      return { ...defaultProfile, ...JSON.parse(raw) };
    } catch {
      return null;
    }
  };

  const saveProfileDraft = (track: string, value: StudentProfile) => {
    try { localStorage.setItem(profileDraftKey(track), JSON.stringify(value)); } catch {}
  };

  const saveActiveAdvisorTask = (track: string, taskId: string | null) => {
    try {
      const raw = localStorage.getItem("gaokao-active-advisor-tasks");
      const tasks = raw ? JSON.parse(raw) : {};
      if (taskId) tasks[track] = taskId; else delete tasks[track];
      localStorage.setItem("gaokao-active-advisor-tasks", JSON.stringify(tasks));
    } catch {}
  };

  const pollAdvisorTask = async (taskId: string, requestTrack: "本科" | "专科" | string) => {
    setAdvisorLoading(true);
    setActiveDocument("report");
    for (let i = 0; i < 240; i += 1) {
      const response = await fetch(`/api/gaokao/advisor/tasks/${taskId}`);
      if (!response.ok) throw new Error("task poll failed");
      const task = await response.json();
      setReportStage(task.stage || "生成中");
      setReportProgress(Number(task.progress) || 8);
      if (Array.isArray(task.events)) setAdvisorEvents(task.events.map((event: any) => ({ type: "task", text: String(event.text || "生成中") })));
      if (task.status === "done") {
        const data = task.result;
        setAdvisorResult(data);
        const item: ReportHistoryItem = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title: `${requestTrack || "本科"}专项志愿规划报告`, subtitle: "报告 · 院校 · 来源", createdAt: new Date().toISOString(), track: requestTrack, result: data };
        setReportHistory((prev) => [item, ...prev].slice(0, 50));
        saveActiveAdvisorTask(String(requestTrack), null);
        setReportProgress(100);
        setReportStage("生成完成");
        setAdvisorLoading(false);
        return;
      }
      if (task.status === "error") throw new Error(task.error || "task failed");
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    throw new Error("task timeout");
  };

  useEffect(() => {
    if (!activeTrack) return;
    saveProfileDraft(activeTrack, profile);
  }, [activeTrack, profile]);

  useEffect(() => {
    if (!activeTrack) return;
    try {
      const raw = localStorage.getItem("gaokao-active-advisor-tasks");
      const tasks = raw ? JSON.parse(raw) : {};
      const taskId = tasks[activeTrack];
      if (taskId && !advisorLoading) {
        pollAdvisorTask(taskId, activeTrack).catch(() => saveActiveAdvisorTask(activeTrack, null));
      }
    } catch {}
  }, [activeTrack]);

  const runAdvisor = async (profileOverride?: StudentProfile, messageOverride?: string, trackOverride?: "本科" | "专科" | null, modelOverride = "committee") => {
    const activeProfile = profileOverride ?? profile;
    const requestTrack = trackOverride ?? activeTrack;
    const missingRequired = [
      !activeProfile.province && "省份",
      !activeProfile.score && "分数",
      !activeProfile.rank && "全省位次",
      !activeProfile.subjects && "选科 / 科类",
    ].filter(Boolean) as string[];
    if (missingRequired.length > 0) {
      toast.error(`请先填写必填项：${missingRequired.join("、")}`);
      return;
    }
    const activeMessage = messageOverride?.trim() || chatInput.trim() || `我想要${activeProfile.province}${activeProfile.subjects}，位次${activeProfile.rank}，偏好${activeProfile.preferredMajors || requestTrack || "本科"}，请给${requestTrack || "最合理"}方案`;
    setAdvisorLoading(true);
    setAdvisorResult(null);
    setAdvisorEvents([]);
    setReportProgress(8);
    setReportStage("整理需求");
    setActiveDocument("report");
    const updateReportProgress = (stage: string, progress: number) => {
      setReportStage(stage);
      setReportProgress((prev) => Math.max(prev, progress));
    };
    const pushEvent = (type: string, text: string) => setAdvisorEvents((prev) => [...prev.slice(-12), { type, text }]);
    try {
      const response = await fetch("/api/gaokao/advisor/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          profile: profileToApiShape(activeProfile),
          message: activeMessage,
          allow_web_lookup: true,
          model: modelOverride,
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
          if (type === "intent") {
            updateReportProgress("整理需求", 16);
            pushEvent(type, `理解档案：${data.province}${data.subjects} 位次 ${data.rank}`);
          }
          if (type === "local_recommendations") {
            updateReportProgress("整理需求", 28);
            pushEvent(type, `本地候选 ${data.count || 0} 个${data.needs_web_lookup ? "，需要联网补查" : ""}`);
          }
          if (type === "search_started") {
            updateReportProgress("整理需求", 36);
            pushEvent(type, `开始联网补查：${data.queries?.length || 0} 个查询`);
          }
          if (type === "source_hits") {
            updateReportProgress("整理需求", 42);
            pushEvent(type, `来源命中：${data.count || 0}`);
          }
          if (type === "evidence_links") {
            updateReportProgress("整理需求", 48);
            pushEvent(type, `可跳转来源链接：${data.count || 0}`);
          }
          if (type === "external_candidates") {
            updateReportProgress("生成初稿", 56);
            pushEvent(type, `联网候选抽取：${data.count || 0}`);
          }
          if (type === "external_candidate_plan") {
            updateReportProgress("生成初稿", 64);
            pushEvent(type, `待复核方案：保留 ${data.usable_count || 0}，过滤 ${data.rejected_count || 0}`);
          }
          if (type === "model_started") {
            updateReportProgress(data.role === "ranking_risk" ? "复核报告" : "生成初稿", data.role === "ranking_risk" ? 72 : 68);
            pushEvent(type, `模型分析启动：${data.provider}`);
          }
          if (type === "model_analysis") {
            updateReportProgress("复核报告", 78);
            pushEvent(type, `模型分析完成：${data.status}`);
          }
          if (type === "model_report") {
            updateReportProgress(data.role === "ranking_risk" ? "复核报告" : "生成终稿", data.role === "ranking_risk" ? 82 : 88);
            pushEvent(type, `${data.provider || "model"} ${data.role || ""} 完成：${data.status}`);
          }
          if (type === "model_committee") {
            updateReportProgress("生成终稿", 92);
            pushEvent(type, `多模型综合完成：${data.status}`);
          }
          if (type === "model_error") {
            updateReportProgress("复核报告", 82);
            pushEvent(type, `${data.provider || "model"} ${data.role || ""} 回退：${data.message || data.status}`);
          }
          if (type === "advisor_plan_sections") pushEvent(type, `产品方案卡片：${data.count || 0}`);
          if (type === "professional_report") {
            updateReportProgress("生成终稿", 96);
            pushEvent(type, "专业志愿报告已生成");
          }
          if (type === "plan_ready") {
            updateReportProgress("生成终稿", 98);
            pushEvent(type, "方案生成完成");
          }
          if (type === "done") {
            setAdvisorResult(data);
            const item: ReportHistoryItem = {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              title: `${requestTrack || activeTrack || "本科"}专项志愿规划报告`,
              subtitle: "报告 · 院校 · 来源",
              createdAt: new Date().toISOString(),
              track: requestTrack || activeTrack || "本科",
              result: data,
            };
            setReportHistory((prev) => [item, ...prev].slice(0, 20));
            updateReportProgress("生成完成", 100);
            pushEvent(type, "专属志愿报告已完成");
          }
        }
      }
      toast.success("已生成专属志愿报告");
    } catch {
      toast.error("专属志愿报告生成失败，请稍后重试");
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
    const draft = loadProfileDraft(track);
    setProfile(draft || defaultProfile);
    setSelectedBand("全部");
    setAdvisorResult(null);
    setAdvisorEvents([]);
    setApiRecommendations(null);
    setRecommendError(null);
    setDataSourceNote("");
    setMessages([{ role: "assistant", content: `已进入${track}专项。你可以先和我聊目标、偏好、顾虑，我会先记录和追问；等你确认“按这个生成报告”时，再生成右侧文档。` }]);
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
        body: JSON.stringify({ command: text, profile: profileToApiShape(profile), track: activeTrack || "", history: messages.slice(-12).map((m) => ({ role: m.role, content: m.content })) }),
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
      const shouldGenerate = /生成报告|生成方案|出方案|出报告|重写报告|重新生成|按这个生成|按这个出|开始生成|确认生成|就这样生成|可以生成了/.test(text);
      if (shouldGenerate) {
        setMessages((prev) => [...prev, { role: "assistant", content: "正在按新条件重新生成方案..." }]);
        await runAdvisor(next, text);
        setMessages((prev) => [...prev, { role: "assistant", content: "方案已更新。" }]);
      }
    }
  };

  const resetProfile = () => {
    if (activeTrack) {
      try { localStorage.removeItem(profileDraftKey(activeTrack)); } catch {}
    }
    setProfile(defaultProfile);
    setSelectedBand("全部");
    setMessages([{ role: "assistant", content: "已恢复默认样例档案。你可以继续修改位次、城市、专业和风险策略。" }]);
  };

  const downloadAdvisorReport = async (result: any) => {
    const markdown = cleanAdvisorMarkdown(result?.final_report_markdown || "");
    const content = markdown || `# ${activeTrack || "高考"}专项志愿规划报告\n\n暂无可下载的报告正文。`;
    const blob = await buildAdvisorReportDocxBlob(content);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "专科专项志愿规划报告.docx";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Word 报告已下载");
  };

  const deleteReportHistoryItem = (id: string) => {
    setReportHistory((prev) => prev.filter((item) => item.id !== id));
    setOpenReportMenuId(null);
    toast.success("已删除历史记录");
  };

  const exportReport = async () => {
    if (advisorResult?.final_report_markdown) {
      await downloadAdvisorReport(advisorResult);
      return;
    }
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

  useEffect(() => {
    const root = reportArticleRef.current;
    if (!root || !advisorResult?.final_report_markdown) return;
    const timer = window.setTimeout(() => {
      root.querySelectorAll("table").forEach((table) => {
        const headerCells = Array.from(table.querySelectorAll("thead th"));
        const headers = headerCells.map((cell) => (cell.textContent || "").trim());
        const schoolIndex = headers.findIndex((h) => h.includes("学校"));
        const cityIndex = headers.findIndex((h) => h.includes("城市"));
        const levelIndex = headers.findIndex((h) => h.includes("层次"));
        const majorIndex = headers.findIndex((h) => h.includes("推荐专业"));
        [cityIndex, levelIndex].filter((idx) => idx >= 0).forEach((idx) => {
          (headerCells[idx] as HTMLElement).style.display = "none";
        });
        table.querySelectorAll("tbody tr").forEach((row) => {
          const cells = Array.from(row.querySelectorAll("td")) as HTMLElement[];
          const city = cells[cityIndex]?.textContent?.trim() || "";
          const level = cells[levelIndex]?.textContent?.trim() || "";
          [cityIndex, levelIndex].filter((idx) => idx >= 0).forEach((idx) => {
            if (cells[idx]) cells[idx].style.display = "none";
          });
        if (schoolIndex >= 0 && cells[schoolIndex] && !cells[schoolIndex].dataset.tooltipReady) {
          cells[schoolIndex].dataset.tooltipReady = "true";
          const school = cells[schoolIndex].textContent?.trim() || "";
          cells[schoolIndex].textContent = "";
          const schoolChip = document.createElement("span");
          schoolChip.className = "group relative inline-flex cursor-default font-medium text-text-primary";
          schoolChip.textContent = school;
          const schoolTip = document.createElement("span");
          schoolTip.className = "pointer-events-none absolute left-0 top-full z-[80] mt-1 hidden min-w-44 max-w-72 rounded-xl border border-surface-border bg-surface-card px-3 py-2 text-left text-xs leading-5 text-text-secondary shadow-xl group-hover:block";
          schoolTip.textContent = [city && `城市：${city}`, level && `层次：${level}`].filter(Boolean).join("；") || "暂无补充信息";
          schoolChip.appendChild(schoolTip);
          cells[schoolIndex].appendChild(schoolChip);
        }
          const majorCell = cells[majorIndex];
          if (majorCell && !majorCell.dataset.tooltipReady) {
            majorCell.dataset.tooltipReady = "true";
            const majors = (majorCell.textContent || "").split(/[、，,；;]/).map((item) => item.trim()).filter(Boolean);
            if (majors.length > 0) {
              majorCell.textContent = "";
              majors.forEach((rawMajor) => {
                const match = rawMajor.match(/^(.*?)[（(\[]?专业最低位次[:：]\s*(\d{4,6})[）)\]]?$/);
                const major = (match?.[1] || rawMajor).trim();
                const majorRank = match?.[2] || "";
                const chip = document.createElement("span");
                chip.textContent = major;
                if (majorRank) chip.dataset.majorRank = majorRank;
                chip.className = "group relative mr-1.5 mb-1 inline-flex rounded-full border border-surface-border bg-surface-elevated/70 px-2 py-0.5 text-[11px] text-text-secondary hover:border-neutral-400 hover:text-text-primary";
                const tip = document.createElement("span");
                tip.className = "pointer-events-none absolute left-0 top-full z-50 mt-1 hidden min-w-44 max-w-64 rounded-xl border border-surface-border bg-surface-card px-3 py-2 text-left text-xs leading-5 text-text-secondary shadow-xl group-hover:block";
                tip.textContent = majorRank ? `该专业最低位次：${majorRank}` : `该专业最低位次：暂无明确数据`;
                chip.appendChild(tip);
                majorCell.appendChild(chip);
              });
            }
          }
        });
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [advisorResult?.final_report_markdown, reportPreviewOpen]);

  const guideConfig = {
    city: {
      title: "城市推荐",
      desc: "从专业方向、就业行业、生活偏好推导适合城市。",
      resultTitle: "城市建议",
      questions: ["你更想去一线/新一线/省会/离家近？", "偏好的就业行业是什么？", "是否看重金融/互联网/制造业/新能源？", "能否接受北方/南方气候？", "是否希望实习机会多？", "是否看重落户和长期发展？", "家庭能接受的生活成本？", "是否更喜欢大城市资源？", "是否想留在本省？", "是否重视考研资源？", "是否考虑国企/央企机会？", "是否看重城市安全感和通勤？", "是否看重医疗、教育、公共服务便利度？", "是否接受远离家乡但产业更强的城市？", "毕业后更想留在学校所在城市还是回本省？", "是否偏好沿海/内陆/省会/产业园区城市？", "是否担心城市竞争压力和生活节奏？", "是否希望城市有明确的专业产业集群？", "补充说明：还有哪些城市、家庭或就业偏好需要说明？"],
      defaults: ["上海：金融、航运、外企、长三角资源强", "深圳/广州：电子信息、互联网、先进制造、外贸强", "杭州：互联网、数字经济、智能制造强", "南京/苏州：电子、制造、软件、长三角就业稳", "成都/重庆：电子信息、汽车、软件和生活成本平衡"],
    },
    major: {
      title: "专业推荐",
      desc: "从兴趣、能力、就业目标推导适合专业方向。",
      resultTitle: "专业建议",
      questions: ["最喜欢的高中学科是什么？", "数学/物理基础强不强？", "是否能接受编程？", "是否喜欢硬件、电路、机械、自动化？", "是否希望就业面宽？", "是否接受读研提升？", "是否排斥医学/土木/化工/师范？", "更看重收入还是稳定？", "是否喜欢和人打交道？", "是否接受工厂/实验室/外勤场景？", "是否考虑考公/国企？", "是否看重专业转码空间？", "是否喜欢写作、表达、材料整理？", "是否喜欢计算、建模、数据分析？", "是否喜欢设计、创意、内容传播？", "是否能接受长期考证或资格考试？", "是否希望本科毕业就有较强就业确定性？", "是否愿意为了专业前景接受较高学习难度？", "补充说明：还有哪些兴趣、能力或职业目标需要说明？"],
      defaults: ["电子信息工程：就业面宽，适合硬件/通信/嵌入式", "自动化：控制、智能制造、机器人方向稳", "计算机/软件：收入弹性高，但竞争强", "电气工程：电网/新能源/装备制造方向稳定", "集成电路/微电子：适合读研和半导体产业链"],
    },
    comprehensive: {
      title: "综合推荐",
      desc: "把城市、专业、学校层次、家庭预算和风险偏好合并判断。",
      resultTitle: "综合建议",
      questions: ["当前最重要的是城市、专业还是学校层次？", "目标是冲好学校还是保好专业？", "能否接受调剂？", "是否接受民办/中外合作/高收费？", "学费上限是多少？", "是否必须公办？", "是否优先省内？", "是否考虑专科兜底？", "是否未来考研？", "是否偏好稳定就业？", "是否可接受冷门专业换学校层次？", "是否可接受低一档城市换专业质量？", "家庭对风险的接受度？", "最不能接受的专业/城市/学校类型？", "是否愿意用城市层级换更好的专业？", "是否愿意用专业热度换更高学校层次？", "是否必须保证不滑档？", "是否需要兼顾父母意见和家庭资源？", "是否接受跨省就业和长期外地发展？", "是否希望方案偏冲刺、均衡还是保守？", "补充说明：还有哪些综合取舍或家庭意见需要说明？"],
      defaults: ["专业优先：选专业强、位次匹配、就业方向清晰的学校", "城市优先：优先长三角/珠三角/成渝等产业城市", "学校优先：适当冲高层次，但保留稳妥专业", "稳妥优先：主力放在接近位次学校，少量冲刺，充分保底", "预算优先：优先公办和低收费专业，谨慎中外合作/民办"],
    },
  } as const;
  const activeGuide = guideMode ? guideConfig[guideMode] : null;
  const guideRecommendation = activeGuide ? activeGuide.defaults.filter((item) => {
    const all = Object.values(guideAnswers).flat().join(" ");
    if (!all.trim()) return true;
    return item.split(/[：、/]/).some((kw) => kw.length > 1 && all.includes(kw));
  }).slice(0, 5) : [];
  const guideQuestionOptions = (question: string) => {
    if (question.includes("补充说明")) return [];
    if (question.includes("当前最重要的是城市、专业还是学校层次")) return ["城市", "专业", "学校层次", "学校性质", "学校所在地周边环境", "就业资源", "家庭预算", "均衡考虑"];
    if (question.includes("目标是冲好学校还是保好专业")) return ["冲好学校", "保好专业", "学校专业均衡", "稳妥录取优先", "先冲后稳", "不确定"];
    if (question.includes("是否愿意用城市层级换更好的专业")) return ["愿意", "可以小幅接受", "不愿意", "看专业强度", "看城市差距", "待考虑"];
    if (question.includes("是否愿意用专业热度换更高学校层次")) return ["愿意", "可以接受冷门但不排斥", "不愿意", "只接受相近专业", "看学校层次差距", "待考虑"];
    if (question.includes("最不能接受的专业/城市/学校类型")) return ["不能接受冷门专业", "不能接受偏远城市", "不能接受民办", "不能接受高收费", "不能接受专科", "不能接受调剂", "暂无"];
    if (question.includes("学费上限是多少")) return ["1万以内", "1-2万", "2-4万", "4-8万", "可接受高收费", "必须低学费"];
    if (question.includes("是否必须公办")) return ["必须公办", "公办优先", "民办可保底", "中外合作可考虑", "不限"];
    if (question.includes("是否接受民办/中外合作/高收费")) return ["接受民办", "接受中外合作", "接受高收费", "只接受公办", "只接受低收费", "视学校而定"];
    if (question.includes("能否接受调剂")) return ["接受调剂", "只接受同类专业调剂", "不接受调剂", "看学校层次", "待考虑"];
    if (question.includes("是否优先省内")) return ["必须省内", "省内优先", "周边省份可接受", "全国都可", "看学校专业决定"];
    if (question.includes("是否考虑专科兜底")) return ["接受专科兜底", "只接受优质专科", "不接受专科", "作为最后保底", "待考虑"];
    if (question.includes("是否未来考研")) return ["明确考研", "可能考研", "优先就业", "不考虑考研", "待考虑"];
    if (question.includes("是否偏好稳定就业")) return ["稳定优先", "收入优先", "成长空间优先", "考公/国企优先", "不确定"];
    if (question.includes("冷门专业换学校层次")) return ["可以接受", "只接受相近冷门", "不接受", "看学校层次提升", "待考虑"];
    if (question.includes("低一档城市换专业质量")) return ["可以接受", "只接受省会/新一线", "不接受", "看专业强度", "待考虑"];
    if (question.includes("家庭对风险的接受度")) return ["高风险可冲", "中等风险", "低风险稳妥", "必须保底", "家庭风险厌恶"];
    if (question.includes("行业") || question.includes("金融") || question.includes("互联网") || question.includes("制造")) return ["金融", "互联网", "电子信息", "先进制造", "新能源", "汽车", "医疗", "教育", "国企央企"];
    if (question.includes("气候")) return ["南方", "北方", "沿海", "干燥", "四季分明", "都可以"];
    if (question.includes("落户") || question.includes("长期发展")) return ["落户很重要", "长期发展优先", "就业机会优先", "暂不考虑落户", "看城市政策", "无所谓"];
    if (question.includes("大城市资源")) return ["高校资源", "实习资源", "医疗资源", "文化生活", "交通便利", "不追求大城市"];
    if (question.includes("考研资源")) return ["很需要", "有较好高校即可", "考研氛围重要", "不准备考研", "无所谓"];
    if (question.includes("国企") || question.includes("央企")) return ["国企优先", "央企优先", "事业单位也可", "外企/民企也可", "不看重单位性质", "待考虑"];
    if (question.includes("城市安全感") || question.includes("通勤")) return ["安全感优先", "通勤短优先", "公共交通便利", "生活便利优先", "可接受长通勤", "无所谓"];
    if (question.includes("成本") || question.includes("学费") || question.includes("预算")) return ["低成本", "中等", "可接受高成本", "公办优先", "可接受民办", "可接受中外合作"];
    if (question.includes("最喜欢的高中学科")) return ["数学", "物理", "英语", "语文", "化学", "生物", "历史/政治/地理", "没有特别偏好"];
    if (question.includes("数学/物理基础")) return ["数学强物理强", "数学强物理一般", "物理强数学一般", "两科中等", "两科偏弱", "不确定"];
    if (question.includes("和人打交道")) return ["很喜欢", "比较喜欢", "一般", "能接受", "不太喜欢", "尽量避免"];
    if (question.includes("实习机会")) return ["非常需要", "比较需要", "一般", "不太需要", "无所谓"];
    if (question.includes("读研")) return ["愿意读研", "优先就业", "看录取情况", "不想读研", "待考虑"];
    if (question.includes("就业面")) return ["越宽越好", "稳定优先", "收入优先", "专业对口优先", "无所谓"];
    if (question.includes("转码")) return ["看重转码空间", "可接受少量编程", "不走转码路线", "完全排斥编程", "待考虑"];
    if (question.includes("工厂") || question.includes("实验室") || question.includes("外勤")) return ["能接受工厂", "能接受实验室", "能接受外勤", "只接受办公室", "尽量避免一线现场"];
    if (question.includes("写作") || question.includes("表达") || question.includes("材料")) return ["很喜欢", "比较喜欢", "一般", "不太喜欢", "尽量避免"];
    if (question.includes("计算") || question.includes("建模") || question.includes("数据分析")) return ["很喜欢", "比较喜欢", "一般", "不太喜欢", "尽量避免"];
    if (question.includes("设计") || question.includes("创意") || question.includes("内容传播")) return ["很喜欢", "比较喜欢", "一般", "不太喜欢", "尽量避免"];
    if (question.includes("考证") || question.includes("资格考试")) return ["能接受长期考证", "只接受必要证书", "不想考证", "看专业需要", "待考虑"];
    if (question.includes("学习难度")) return ["愿意挑战高难度", "中等难度最好", "尽量轻松", "看就业回报", "待考虑"];
    if (question.includes("是否能接受编程")) return ["很能接受", "能接受基础编程", "只接受少量编程", "不太接受", "完全不接受", "没接触过"];
    if (question.includes("硬件") || question.includes("电路") || question.includes("机械") || question.includes("自动化")) return ["很喜欢硬件", "喜欢电路", "喜欢机械结构", "喜欢自动化控制", "一般", "不太喜欢"];
    if (question.includes("编程")) return ["编程", "不想编程", "可接受少量编程", "都能接受"];
    if (question.includes("排斥") || question.includes("不能接受")) return ["医学", "土木", "化工", "师范", "农学", "管理", "销售", "无"];
    if (question.includes("收入") || question.includes("稳定") || question.includes("考公") || question.includes("国企")) return ["高收入", "稳定", "考公", "国企", "央企", "外企", "创业", "灵活就业"];
    if (question.includes("调剂") || question.includes("风险") || question.includes("冲")) return ["愿意冲", "稳妥优先", "接受调剂", "不接受调剂", "少量冲刺", "保专业", "保学校"];
    if (question.includes("省内") || question.includes("离家") || question.includes("回本省")) return ["省内", "省外", "周边省份", "离家近", "毕业回本省", "全国都可"];
    if (question.includes("公共服务") || question.includes("医疗") || question.includes("教育")) return ["很看重", "一般", "不看重", "医疗优先", "教育资源优先", "无所谓"];
    if (question.includes("远离家乡") || question.includes("跨省")) return ["可以接受", "只接受周边", "不接受", "看城市机会", "待考虑"];
    if (question.includes("竞争压力") || question.includes("生活节奏")) return ["能接受高压", "中等节奏", "偏慢生活", "尽量低压力", "待考虑"];
    if (question.includes("产业集群")) return ["非常需要", "比较需要", "一般", "不看重", "看专业决定"];
    if (question.includes("城市") || question.includes("一线") || question.includes("省会")) return ["一线", "新一线", "省会", "长三角", "珠三角", "成渝", "离家近", "不限"];
    if (question.includes("不滑档")) return ["必须保底", "稳妥优先", "可接受少量风险", "愿意冲刺", "待考虑"];
    if (question.includes("父母") || question.includes("家庭资源")) return ["必须兼顾", "作为参考", "自己决定", "家庭资源很重要", "待沟通"];
    if (question.includes("偏冲刺") || question.includes("均衡") || question.includes("保守")) return ["偏冲刺", "均衡", "偏保守", "先稳后冲", "待考虑"];
    return ["很看重", "一般", "不看重", "可以接受", "不能接受", "待考虑"];
  };
  const isGuideSingleChoice = (question: string) => {
    const opts = Array.from(new Set(guideQuestionOptions(question)));
    const degreeWords = ["很喜欢", "比较喜欢", "不太喜欢", "尽量避免", "很能接受", "不太接受", "完全不接受", "能接受基础编程", "只接受少量编程", "愿意读研", "不想读研", "明确考研", "不考虑考研"];
    if (opts.some((item) => degreeWords.includes(item))) return true;
    return opts.length > 0 && opts.every((item) => ["很看重", "一般", "不看重", "可以接受", "不能接受", "待考虑"].includes(item));
  };
  const toggleGuideAnswer = (question: string, option: string) => {
    setGuideAnswers((prev) => {
      const current = prev[question] || [];
      if (isGuideSingleChoice(question)) return { ...prev, [question]: current.includes(option) ? [] : [option] };
      return { ...prev, [question]: current.includes(option) ? current.filter((item) => item !== option) : [...current, option] };
    });
  };

  const submitGuide = async () => {
    if (!guideMode) return;
    setGuideSubmitted(true);
    setGuideLoading(true);
    setGuideProgress(8);
    setGuideResult("");
    setGuideData(null);
    try {
      const response = await fetch("/api/gaokao/guide", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: guideConfig[guideMode].title, answers: guideAnswers }) });
      if (!response.ok) throw new Error("guide failed");
      const data = await response.json();
      const guide = data?.guide || null;
      const markdown = String(data?.markdown || "");
      setGuideData(guide);
      setGuideResult(markdown);
      saveGuideHistory({ id: `${Date.now()}`, title: `${guideConfig[guideMode].title}-${new Date().toLocaleString()}`, mode: guideConfig[guideMode].title, createdAt: new Date().toISOString(), data: guide || markdown, answers: guideAnswers });
    } catch {
      setGuideResult(`### 暂时无法完成深度联网评估\n\n${(guideRecommendation.length ? guideRecommendation : activeGuide?.defaults || []).map((item) => `- ${item}`).join("\n")}`);
    } finally {
      setGuideProgress(100);
      setGuideLoading(false);
    }
  };

  const reportSteps = [
    { label: "整理需求", start: 0, doneAt: 24 },
    { label: "生成初稿", start: 25, doneAt: 59 },
    { label: "复核报告", start: 60, doneAt: 84 },
    { label: "生成终稿", start: 85, doneAt: 100 },
  ];
  const activeReportStep = reportSteps.find((step) => reportProgress >= step.start && reportProgress <= step.doneAt) || reportSteps[reportSteps.length - 1];
  const visibleReportHistory = activeTrack ? reportHistory.filter((item) => !item.track || item.track === activeTrack) : reportHistory;

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-surface text-text-primary md:h-screen">
      <header className="shrink-0 border-b border-surface-border bg-surface-elevated/85 px-3 py-2.5 backdrop-blur-xl md:px-4 md:py-3">
        <div className="grid grid-cols-[44px_1fr_44px] items-center gap-3">
          <button onClick={handlePageBack} className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-surface-border bg-surface-card text-text-secondary transition hover:border-neutral-400 hover:text-neutral-950 dark:hover:text-white" aria-label="返回上一层">
            <ArrowRight className="h-4 w-4 rotate-180" />
          </button>
          <div className="min-w-0 text-center">
            <h1 className="truncate text-base font-semibold tracking-tight text-text-primary md:text-lg">
              {activeTrack ? `${activeTrack}专项` : t("gaokao.navLabel")}
            </h1>
            <p className="mt-0.5 truncate text-[11px] text-text-tertiary md:text-xs">{activeTrack ? "本报告由 AI 基于公开资料和模型分析生成，仅供志愿规划参考，最终以考试院和高校官方信息为准" : "选择填报入口"}</p>
          </div>
          <button onClick={() => activeTrack ? openSettings() : setGuideHistoryOpen(true)} className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-surface-border bg-surface-card text-text-secondary transition hover:border-neutral-400 hover:text-neutral-950 dark:hover:text-white" aria-label={activeTrack ? "设置" : "历史记录"}>
            {activeTrack ? <SlidersHorizontal className="h-4 w-4" /> : <History className="h-4 w-4" />}
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

      {guideHistoryOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 px-4 py-6 backdrop-blur-sm">
          <div className="max-h-[86vh] w-full max-w-3xl overflow-hidden rounded-[2rem] border border-surface-border bg-surface-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-surface-border px-6 py-5">
              <div><div className="text-xl font-semibold text-text-primary">推荐文档历史记录</div><p className="mt-1 text-sm text-text-tertiary">城市/专业/综合推荐生成后会保存为可下载文档。</p></div>
              <button onClick={() => setGuideHistoryOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-surface-border text-text-tertiary hover:text-text-primary"><X className="h-4 w-4" /></button>
            </div>
            <div className="max-h-[68vh] overflow-y-auto p-5">
              {guideHistory.length === 0 ? <div className="rounded-2xl border border-dashed border-surface-border p-6 text-sm text-text-tertiary">暂无历史记录。提交问卷生成建议后会显示在这里。</div> : <div className="space-y-3">{guideHistory.map((record) => <div key={record.id} className="rounded-2xl border border-surface-border bg-surface-elevated/45 p-4"><div className="flex items-start justify-between gap-3"><div><div className="font-semibold text-text-primary">{record.title}</div><div className="mt-1 text-xs text-text-tertiary">{record.mode} · {new Date(record.createdAt).toLocaleString()}</div></div><button onClick={() => downloadGuideRecord(record)} className="rounded-xl bg-neutral-950 px-3 py-2 text-xs text-white dark:bg-white dark:text-neutral-950">下载文档</button></div><pre className="mt-3 max-h-32 overflow-hidden whitespace-pre-wrap rounded-xl bg-surface-card p-3 text-xs leading-5 text-text-secondary">{guideRecordToMarkdown(record)}</pre></div>)}</div>}
            </div>
          </div>
        </div>
      )}

      {activeGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 py-6 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-[2rem] border border-surface-border bg-surface-card shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-surface-border px-6 py-5">
              <div>
                <div className="text-xl font-semibold text-text-primary">{activeGuide.title}</div>
                <p className="mt-1 text-sm text-text-tertiary">{activeGuide.desc}</p>
              </div>
              <button type="button" onClick={() => setGuideMode(null)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-surface-border text-text-tertiary transition hover:text-text-primary"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-y-auto p-6">
              {!guideSubmitted && <div className="max-h-[64vh] overflow-y-auto rounded-2xl border border-surface-border">
                <table className="w-full text-left text-base">
                  <thead className="sticky top-0 bg-surface-elevated text-sm text-text-tertiary"><tr><th className="w-16 px-4 py-3">序号</th><th className="px-4 py-3">问题</th><th className="px-4 py-3">回答</th></tr></thead>
                  <tbody>
                    {activeGuide.questions.map((question, index) => (
                      <tr key={question} className="border-t border-surface-border">
                        <td className="px-4 py-3 text-text-tertiary">{index + 1}</td>
                        <td className="px-4 py-3 font-medium leading-6 text-text-primary">{question}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {Array.from(new Set(guideQuestionOptions(question))).map((option) => {
                              const selected = (guideAnswers[question] || []).includes(option);
                              return <button key={option} type="button" onClick={() => toggleGuideAnswer(question, option)} className={cn("rounded-full border px-3 py-1.5 text-sm transition", selected ? "border-neutral-950 bg-neutral-950 text-white dark:border-white dark:bg-white dark:text-neutral-950" : "border-surface-border bg-surface text-text-secondary hover:border-neutral-400 hover:text-text-primary")}>{option}</button>;
                            })}
                          </div>
                          {question.includes("补充说明") && (
                            <textarea value={(guideAnswers[question] || [""])[0]} onChange={(e) => setGuideAnswers((prev) => ({ ...prev, [question]: [e.target.value] }))} placeholder="可自主填写补充说明" className="mt-2 min-h-[88px] w-full rounded-xl border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-neutral-400" />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>}
              {guideSubmitted && (
                <div className="rounded-2xl border border-surface-border bg-surface-elevated/45 p-5">
                  <div className="text-lg font-semibold text-text-primary">{activeGuide.resultTitle}</div>
                  <p className="mt-1 text-sm leading-6 text-text-tertiary">提交后生成可下载的 Word 推荐文档。</p>
                  {guideLoading ? (
                    <div className="mt-4 rounded-2xl bg-surface-card px-5 py-5 text-sm leading-6 text-text-secondary">
                      <div className="flex items-center justify-between gap-3"><div className="font-semibold text-text-primary">多智能体协同评估中</div><div className="text-xs text-text-tertiary">{guideProgress}%</div></div>
                      <div className="mt-3 h-2 rounded-full bg-surface-elevated"><div className="h-2 rounded-full bg-neutral-950 transition-all duration-700 dark:bg-white" style={{ width: `${guideProgress}%` }} /></div>
                      <div className="mt-4 grid gap-2 text-xs text-text-tertiary md:grid-cols-4">
                        {[{label:"整理问卷",done:guideProgress>=18},{label:"分析偏好",done:guideProgress>=42},{label:"生成建议",done:guideProgress>=68},{label:"排版文档",done:guideProgress>=88}].map((step) => <div key={step.label} className={cn("rounded-xl border px-3 py-2", step.done ? "border-neutral-300 bg-surface-elevated text-text-primary" : "border-surface-border bg-surface")}>{step.done ? "✓ " : "· "}{step.label}</div>)}
                      </div>
                      <div className="mt-4 space-y-2">
                        <div className="h-3 w-4/5 animate-pulse rounded-full bg-surface-elevated" />
                        <div className="h-3 w-2/3 animate-pulse rounded-full bg-surface-elevated" />
                        <div className="h-3 w-3/4 animate-pulse rounded-full bg-surface-elevated" />
                      </div>
                    </div>
                  ) : guideData ? (
                    <div className="mt-4 max-h-[64vh] overflow-y-auto rounded-3xl bg-white p-6 text-base leading-7 text-neutral-700 shadow-sm dark:bg-surface dark:text-text-secondary">
                      <div className="border-b border-surface-border pb-5">
                        <div className="text-2xl font-bold tracking-tight text-neutral-950 dark:text-white">{cleanGuideText(guideData.title)}</div>
                        <p className="mt-3 text-base leading-7 text-neutral-600 dark:text-text-secondary">{cleanGuideText(guideData.summary)}</p>
                        <button type="button" onClick={() => downloadGuideRecord({ id: `${Date.now()}`, title: guideData.title || activeGuide.title, mode: activeGuide.title, createdAt: new Date().toISOString(), data: guideData })} className="mt-4 inline-flex items-center gap-2 rounded-full bg-neutral-950 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-950"><Download className="h-4 w-4" />下载 Word</button>
                      </div>
                      <div className="mt-6 overflow-x-auto rounded-2xl border border-surface-border">
                        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                          <thead className="bg-blue-50 text-neutral-950 dark:bg-blue-950/30 dark:text-white"><tr><th className="px-4 py-3">项目</th><th className="px-4 py-3">分数</th>{(guideData.table_columns || []).map((col: string) => <th key={col} className="px-4 py-3">{col}</th>)}</tr></thead>
                          <tbody>{(guideData.table_rows || []).map((row: any) => <tr key={row.name} className="border-t border-surface-border align-top"><td className="px-4 py-3 font-semibold text-neutral-950 dark:text-white">{cleanGuideText(row.name)}</td><td className="px-4 py-3"><span className="rounded-full bg-neutral-950 px-2.5 py-1 text-xs text-white dark:bg-white dark:text-neutral-950">{row.score} 分</span></td>{(row.cells || []).map((cell: string, idx: number) => <td key={idx} className="max-w-[260px] px-4 py-3 leading-6 text-neutral-600 dark:text-text-secondary">{cleanGuideText(cell)}</td>)}</tr>)}</tbody>
                        </table>
                      </div>
                      <div className="mt-6 grid gap-4 md:grid-cols-3">
                        <div className="rounded-2xl border border-surface-border bg-surface-card p-4"><div className="font-semibold text-text-primary">{guideData.bar_chart?.title || "匹配度"}</div><div className="mt-3 space-y-2">{(guideData.bar_chart?.items || []).map((item: any) => <div key={item.label}><div className="mb-1 flex justify-between gap-3 text-sm"><span className="break-words">{item.label}</span><span>{item.value}</span></div><div className="h-2 rounded-full bg-surface-elevated"><div className="h-2 rounded-full bg-blue-600" style={{ width: `${Math.min(100, Math.max(0, Number(item.value) || 0))}%` }} /></div></div>)}</div></div>
                        <div className="rounded-2xl border border-surface-border bg-surface-card p-4"><div className="font-semibold text-text-primary">{guideData.pie_chart?.title || "因素权重"}</div><div className="mt-2 space-y-1">{(guideData.pie_chart?.items || []).map((item: any) => <div key={item.label} className="flex justify-between gap-3 text-sm"><span className="break-words">{item.label}</span><span>{item.value}%</span></div>)}</div></div>
                        <div className="rounded-2xl border border-surface-border bg-surface-card p-4"><div className="font-semibold text-text-primary">{guideData.trend_chart?.title || "趋势"}</div><div className="mt-2 space-y-1">{(guideData.trend_chart?.items || []).map((item: any) => <div key={item.label} className="flex justify-between gap-3 text-sm"><span className="break-words">{item.label}</span><span>{item.value}</span></div>)}</div></div>
                      </div>
                      <div className="mt-6 rounded-2xl border border-surface-border bg-surface-card p-5"><div className="font-semibold text-text-primary">下一步</div><ul className="mt-3 list-disc space-y-2 pl-5">{(guideData.next_steps || []).map((step: string) => <li key={step}>{step}</li>)}</ul></div>
                    </div>
                  ) : (
                    <div className="mt-4 max-h-[56vh] overflow-y-auto whitespace-pre-wrap rounded-xl bg-surface-card px-4 py-3 text-sm leading-6 text-text-secondary">{guideResult || "暂无建议"}</div>
                  )}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-surface-border px-6 py-4">
              <button type="button" onClick={() => setGuideMode(null)} className="rounded-xl border border-surface-border px-4 py-2 text-sm text-text-secondary hover:text-text-primary">关闭</button>
              {guideSubmitted && !guideLoading && <button type="button" onClick={() => { setGuideSubmitted(false); setGuideData(null); setGuideResult(""); }} className="rounded-xl border border-surface-border px-5 py-2.5 text-base font-medium text-text-secondary hover:text-text-primary">返回表格</button>}
              <button type="button" onClick={submitGuide} disabled={guideLoading} className="rounded-xl bg-neutral-950 px-5 py-2.5 text-base font-medium text-white disabled:opacity-60 dark:bg-white dark:text-neutral-950">{guideLoading ? "生成中..." : guideSubmitted ? "重新生成评估" : "提交问卷，启动协同评估"}</button>
            </div>
          </div>
        </div>
      )}

      {!activeTrack ? (
        <main className="min-h-0 flex-1 overflow-y-auto bg-surface px-3 py-4 md:px-6 md:py-8">
          <section className="mx-auto flex max-w-6xl flex-col gap-8">
            <div className="rounded-[1.5rem] border border-surface-border bg-surface-card/90 p-5 shadow-sm md:rounded-[2rem] md:p-8">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-neutral-950 dark:text-white"><Sparkles className="h-3.5 w-3.5" /> 专属志愿报告</div>
              <h2 className="text-2xl font-semibold tracking-tight text-text-primary md:text-3xl">先选择你的填报入口</h2>
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
              {(["city", "major", "comprehensive"] as const).map((mode) => (
                <button key={mode} type="button" onClick={() => { setGuideMode(mode); setGuideAnswers({}); setGuideSubmitted(false); setGuideResult(""); setGuideData(null); }} className="group rounded-[1.75rem] border border-surface-border bg-surface-card/90 p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-neutral-400 hover:shadow-lg hover:shadow-black/5">
                  <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-elevated text-neutral-950 dark:text-white"><Sparkles className="h-5 w-5" /></div>
                  <div className="text-lg font-semibold text-text-primary">{guideConfig[mode].title}</div>
                  <p className="mt-2 min-h-[72px] text-sm leading-relaxed text-text-secondary">{guideConfig[mode].desc}</p>
                  <div className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-neutral-950 dark:text-white">打开问卷 <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" /></div>
                </button>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-3xl border border-surface-border bg-surface-card/80 p-5 text-sm leading-relaxed text-text-secondary"><div className="mb-1 font-medium text-text-primary">专属志愿报告</div>多智能体协同分析，生成可解释方案。</div>
              <div className="rounded-3xl border border-surface-border bg-surface-card/80 p-5 text-sm leading-relaxed text-text-secondary"><div className="mb-1 font-medium text-text-primary">来源可核验</div>展示考试院、招生网、第三方链接，点击即可跳转。</div>
              <div className="rounded-3xl border border-surface-border bg-surface-card/80 p-5 text-sm leading-relaxed text-text-secondary"><div className="mb-1 font-medium text-text-primary">对话可修改</div>进入专项后可用右下角 Agent 继续调整条件。</div>
            </div>
          </section>
        </main>
      ) : (
      <main className="min-h-0 flex-1 overflow-y-auto bg-surface xl:grid xl:grid-cols-[320px_minmax(420px,1fr)_400px] xl:overflow-hidden">
        <aside className="min-h-0 border-b border-surface-border bg-surface-elevated/45 px-3 py-4 md:px-4 md:py-5 xl:overflow-y-auto xl:border-b-0 xl:border-r">
          <section className="space-y-4 rounded-3xl border border-surface-border bg-surface-card/90 p-4 shadow-sm">
            <div>
              <div className="flex items-center gap-2 text-base font-semibold text-text-primary"><GraduationCap className="h-4 w-4 text-neutral-950 dark:text-white" /> {activeTrack}专项要求</div>
              <p className="mt-1 text-xs leading-relaxed text-text-tertiary">先填必填项，再点击下方生成报告；偏好项可留空。</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="省份" required>
                <select className={inputClass} value={profile.province} onChange={(e) => updateField("province", e.target.value)}>
                  <option value="">请选择</option>
                  {provinceOptions.map((province) => <option key={province} value={province}>{province}</option>)}
                </select>
              </Field>
              <Field label="分数" required><input className={inputClass} type="number" value={profile.score} placeholder="请输入" onChange={(e) => updateField("score", e.target.value === "" ? "" : Number(e.target.value))} /></Field>
            </div>
            <Field label="全省位次" required><input className={inputClass} type="number" value={profile.rank} placeholder="请输入" onChange={(e) => updateField("rank", e.target.value === "" ? "" : Number(e.target.value))} /></Field>
            <Field label="选科 / 科类" required>
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
            <div className="mt-2 grid gap-2">
              <button type="button" disabled title="官方 API 暂停使用" className="flex w-full cursor-not-allowed items-center justify-center rounded-2xl border border-surface-border bg-surface-elevated px-4 py-3 text-sm font-medium text-text-tertiary opacity-60 shadow-sm">
                生成报告
              </button>
              {activeTrack === "专科" && (
                <button onClick={() => runAdvisor(profile, `进入${activeTrack}专项，按当前条件生成完整志愿报告`, activeTrack, "committee_clip")} disabled={advisorLoading} className="flex w-full items-center justify-center rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-100 disabled:opacity-70 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200">
                  {advisorLoading ? "正在生成报告..." : "生成报告（4）"}
                </button>
              )}
            </div>
          </section>
        </aside>

        <section className="flex min-h-[460px] flex-col border-b border-surface-border bg-surface px-3 py-4 md:px-4 md:py-5 xl:min-h-0 xl:border-b-0 xl:border-r">
          <div className="mb-4 rounded-3xl border border-surface-border bg-surface-card/90 p-4 shadow-sm">
            <div className="flex items-center gap-2 text-base font-semibold text-text-primary"><Bot className="h-4 w-4 text-neutral-950 dark:text-white" /> 志愿 Agent</div>
            <p className="mt-1 text-xs leading-relaxed text-text-tertiary">先和 Agent 聊目标、偏好和顾虑；确认后再生成或重写右侧文档。</p>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-3xl border border-surface-border bg-surface-card/70 p-4">
            {messages.map((message, index) => (
              <div key={index} className={cn("whitespace-pre-wrap rounded-2xl px-3 py-2.5 text-sm leading-relaxed", message.role === "user" ? "ml-12 bg-neutral-950 text-white dark:bg-white dark:text-neutral-950" : "mr-12 border border-surface-border bg-surface-elevated text-text-secondary")}>
                {message.role === "assistant" ? (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      p: ({ children }) => <p className="my-1 leading-relaxed">{children}</p>,
                      strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
                      ul: ({ children }) => <ul className="my-1 list-disc space-y-1 pl-4">{children}</ul>,
                      ol: ({ children }) => <ol className="my-1 list-decimal space-y-1 pl-4">{children}</ol>,
                    }}
                  >{cleanAdvisorMarkdown(message.content)}</ReactMarkdown>
                ) : message.content}
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
              <textarea value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} placeholder="先聊偏好；确认后输入：按这个生成报告" className="min-h-[52px] flex-1 resize-none rounded-2xl border border-surface-border bg-surface-elevated px-3 py-2.5 text-sm text-text-primary outline-none transition focus:border-neutral-400 dark:border-surface-border focus:ring-2 focus:ring-brand/15" />
              <button onClick={sendMessage} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-neutral-950 text-white dark:bg-white dark:text-neutral-950 transition hover:bg-neutral-800 dark:hover:bg-neutral-200"><Send className="h-4 w-4" /></button>
            </div>
          </div>
        </section>

        <aside className="flex min-h-[520px] flex-col bg-[#f7f7fb] px-3 py-4 dark:bg-surface-elevated/35 md:px-4 md:py-5 xl:min-h-0 xl:overflow-hidden">
          <div className="mb-4 rounded-[28px] border border-surface-border bg-surface-card shadow-sm">
            <div className="border-b border-surface-border px-5 py-4">
              <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-text-primary">历史记录</h2>
              <p className="mt-1 text-xs text-text-tertiary">生成过的报告会一直保留在这里，悬浮记录可打开更多操作。</p>
            </div>
            <div className="px-5 pb-4 pt-3">
              <div className="text-[15px] font-semibold tracking-[-0.01em] text-text-primary">文件</div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-[28px] border border-surface-border bg-surface-card p-4 shadow-sm">
            {advisorLoading && (
              <div className="mb-2 rounded-[18px] bg-surface-elevated/70 px-3 py-3.5">
                <div className="flex items-center gap-3.5 pr-2 text-left">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center">
                    <RefreshCw className="h-[25px] w-[25px] animate-spin text-neutral-950 dark:text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold leading-5 tracking-[-0.01em] text-text-primary">{activeTrack}专项志愿规划报告</div>
                    <div className="mt-1 flex items-center justify-between gap-3 text-[12px] leading-4 text-text-tertiary">
                      <span>{activeReportStep.label}</span>
                      <span>{reportProgress}%</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-200/80 dark:bg-surface-border">
                      <div className="h-full rounded-full bg-neutral-950 transition-all duration-500 ease-out dark:bg-white" style={{ width: `${reportProgress}%` }} />
                    </div>
                    <div className="mt-2 grid grid-cols-4 gap-1 text-[10px] text-text-tertiary">
                      {reportSteps.map((step) => {
                        const active = step.label === activeReportStep.label;
                        const completed = reportProgress > step.doneAt;
                        return (
                          <div key={step.label} className={cn(
                            "truncate rounded-full px-1.5 py-0.5 text-center transition-colors",
                            active ? "bg-neutral-950 text-white dark:bg-white dark:text-neutral-950" : completed ? "bg-neutral-200 text-neutral-700 dark:bg-surface-border dark:text-text-secondary" : "bg-surface-card"
                          )}>{step.label}</div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {visibleReportHistory.length === 0 && !advisorLoading ? (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <div className="relative mb-4 text-text-tertiary">
                  <Sparkles className="absolute -right-2 -top-1 h-3.5 w-3.5 text-neutral-950 dark:text-white" />
                  <FileText className="h-9 w-9" />
                </div>
                <p className="text-sm font-medium text-text-primary">还没有历史记录</p>
                <p className="mt-2 max-w-[260px] text-xs leading-5 text-text-tertiary">点击右上角“生成报告”，完成后历史记录会一直保留在这里。</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {visibleReportHistory.map((item) => (
                  <div key={item.id} className="group relative rounded-[18px] transition hover:bg-surface-elevated/70">
                    <button type="button" onClick={() => { setAdvisorResult(item.result); setReportPreviewOpen(true); setOpenReportMenuId(null); }} className="flex w-full items-center gap-3.5 px-2.5 py-3 pr-12 text-left">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center"><FileText className="h-[25px] w-[25px] text-neutral-950 dark:text-white" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold leading-5 tracking-[-0.01em] text-text-primary">{item.title}</span>
                        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-text-tertiary">
                          <span className="truncate">{item.subtitle}</span><span>·</span><span>{formatHistoryTime(item.createdAt, item.createdAtLabel)}</span>
                        </span>
                      </span>
                    </button>
                    <button type="button" onClick={(event) => { event.stopPropagation(); setOpenReportMenuId((id) => id === item.id ? null : item.id); }} className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-text-tertiary opacity-0 transition hover:bg-surface-hover hover:text-neutral-950 dark:text-white group-hover:opacity-100" title="更多操作">
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                    {openReportMenuId === item.id && (
                      <div className="absolute right-2 top-10 z-20 w-28 overflow-hidden rounded-2xl border border-surface-border bg-surface-card py-1 text-sm shadow-xl">
                        <button type="button" onClick={(event) => { event.stopPropagation(); downloadAdvisorReport(item.result); setOpenReportMenuId(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-text-secondary hover:bg-surface-hover hover:text-text-primary"><Download className="h-3.5 w-3.5" />下载</button>
                        <button type="button" onClick={(event) => { event.stopPropagation(); deleteReportHistoryItem(item.id); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5" />删除</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
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
              <article className="mx-auto max-w-5xl text-[15px] leading-8 text-text-secondary md:text-base">
                {advisorResult.final_report_markdown ? (
                  <div ref={reportArticleRef} className="max-w-none text-text-secondary">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        h1: ({ children }) => <h1 className="mb-5 border-b border-surface-border pb-4 text-3xl font-semibold tracking-[-0.03em] text-text-primary md:text-4xl">{children}</h1>,
                        h2: ({ children }) => <h2 className="mb-3 mt-8 text-2xl font-semibold tracking-[-0.02em] text-text-primary">{children}</h2>,
                        h3: ({ children }) => <h3 className="mb-2 mt-5 text-lg font-semibold text-text-primary">{children}</h3>,
                        p: ({ children }) => <p className="my-3 text-[15px] leading-8 text-text-secondary md:text-base">{children}</p>,
                        ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-5 text-[15px] leading-8 text-text-secondary md:text-base">{children}</ul>,
                        ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-5 text-[15px] leading-8 text-text-secondary md:text-base">{children}</ol>,
                        blockquote: ({ children }) => <blockquote className="my-4 border-l-4 border-neutral-300 bg-neutral-50 px-4 py-2 text-[15px] leading-8 text-text-secondary dark:border-surface-border dark:bg-surface-elevated/50 md:text-base">{children}</blockquote>,
                        table: ({ children }) => <div className="my-5 overflow-x-auto rounded-2xl border border-surface-border"><table className="min-w-full border-collapse text-left text-sm">{children}</table></div>,
                        thead: ({ children }) => <thead className="bg-neutral-100 text-text-primary dark:bg-surface-elevated">{children}</thead>,
                        th: ({ children }) => <th className="whitespace-nowrap border-b border-surface-border px-3.5 py-3 font-semibold text-text-primary">{children}</th>,
                        td: ({ children }) => <td className="align-top border-b border-surface-border px-3.5 py-3 text-text-secondary last:border-b-0">{children}</td>,
                        strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
                      }}
                    >
                      {cleanAdvisorMarkdown(advisorResult.final_report_markdown)}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <div>
                  <h2 className="text-3xl font-semibold tracking-[-0.03em] text-text-primary">{activeTrack}专项志愿规划报告</h2>
                  <p className="mt-3 text-base leading-8 text-text-secondary">这份报告根据你填写的省份、分数、位次、选科和偏好，综合院校层次、专业匹配度、位次风险和可核验来源生成。模型调用和复核过程已在后台完成，以下只保留面向填报决策的结论。</p>

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
                            <div className="mt-1 text-xs text-text-tertiary">{item.school_level && item.school_level !== "联网待复核" ? item.school_level : "参考候选"} · {item.city || "城市待核验"} · 参考位次 {item.reference_rank || "-"}</div>
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
                  </div>
                )}
                </article>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
