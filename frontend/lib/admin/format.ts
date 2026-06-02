export function formatRMB(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(Number.isFinite(value) ? value : 0);
}

export function formatDateTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { hour12: false });
}

type SourcePrice = {
  source_currency?: string;
  source_unit?: string;
  source_input_price?: number;
  source_input_cache_hit_price?: number;
  source_input_cache_miss_price?: number;
  source_output_price?: number;
  source_image_price?: number;
  source_request_price?: number;
  exchange_rate_to_rmb?: number;
};

function formatCurrencyAmount(value: number, currency: string) {
  const normalized = currency.toUpperCase();
  const prefix = normalized === "USD" ? "$" : normalized === "CNY" || normalized === "RMB" ? "¥" : `${normalized} `;
  return `${prefix}${formatCompactDecimal(value)}`;
}

function formatCompactDecimal(value: number) {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1) return value.toFixed(4).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  return value.toPrecision(4).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function sourceUnitLabel(unit?: string) {
  switch (unit) {
    case "per_1m_tokens":
      return "1M tokens";
    case "per_1k_tokens":
      return "1K tokens";
    case "per_image":
      return "张";
    case "per_request":
      return "次";
    case "per_video_second":
      return "秒";
    default:
      return unit || "单位";
  }
}

function convertToUnifiedRMBWithSourceUnit(sourcePrice: number, sourceUnit: string | undefined, rate: number) {
  // 默认展示统一定价时保持官方原始单位，例如官方是 /1M tokens，则展示 ¥x / 1M tokens。
  // 内部账本的 RMB/1K tokens 快照仅用于计算，默认不展示。
  return sourcePrice * rate;
}

export function formatOriginalPrice(price: SourcePrice, kind: "input" | "cache_hit" | "cache_miss" | "output" | "image" | "request") {
  const currency = price.source_currency || "CNY";
  const unit = sourceUnitLabel(price.source_unit);
  const value =
    kind === "cache_hit"
      ? price.source_input_cache_hit_price
      : kind === "cache_miss"
        ? price.source_input_cache_miss_price
        : kind === "output"
          ? price.source_output_price
          : kind === "image"
            ? price.source_image_price
            : kind === "request"
              ? price.source_request_price
              : price.source_input_price;
  if (!value || value <= 0) return "-";
  return `${formatCurrencyAmount(value, currency)} / ${unit}`;
}

export function formatUnifiedPrice(price: SourcePrice, kind: "input" | "cache_hit" | "cache_miss" | "output" | "image" | "request") {
  const rate = price.exchange_rate_to_rmb || (price.source_currency === "CNY" || price.source_currency === "RMB" || !price.source_currency ? 1 : 0);
  const sourceValue =
    kind === "cache_hit"
      ? price.source_input_cache_hit_price
      : kind === "cache_miss"
        ? price.source_input_cache_miss_price
        : kind === "output"
          ? price.source_output_price
          : kind === "image"
            ? price.source_image_price
            : kind === "request"
              ? price.source_request_price
              : price.source_input_price;
  if (!sourceValue || sourceValue <= 0 || rate <= 0) return "-";
  return `¥${formatCompactDecimal(convertToUnifiedRMBWithSourceUnit(sourceValue, price.source_unit, rate))} / ${sourceUnitLabel(price.source_unit)}`;
}
