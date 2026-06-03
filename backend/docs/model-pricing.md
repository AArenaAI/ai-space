# Model-level pricing configuration

AI Space usage cost accounting records a price snapshot into `api_usage_logs` when each external model/API call is written. Model-level pricing has priority over provider-level fallback prices.

Model prices are not secrets, so the preferred configuration is a versioned JSON file.

## Two price views

AI Space keeps two related but different price views:

1. **Original pricing** — the provider's official price and currency, e.g. OpenAI/Gemini/Moonshot in USD and DeepSeek in CNY.
2. **Unified pricing** — the RMB price used for cost aggregation. This is calculated at usage-write time from the original price and the current exchange rate, then stored as a historical snapshot.

Do not hard-code exchange rates in `model-prices.json`. USD prices are converted at runtime through a live USD→CNY lookup. The resulting `input_unit_price_rmb`, `output_unit_price_rmb`, `image_unit_price_rmb`, `total_cost_rmb`, and `exchange_rate_to_rmb` are saved into the usage ledger for traceability.

## Preferred: JSON file

Default file path:

```txt
backend/config/model-prices.json
```

The backend reads this file automatically when started from `backend/` or from the repository root. To use another path, set:

```bash
MODEL_PRICES_FILE=/absolute/path/to/model-prices.json
```

Format:

```json
[
  {
    "provider": "openai",
    "model": "gpt-5.5",
    "pricing_unit": "token_1k",
    "source_currency": "USD",
    "source_unit": "per_1m_tokens",
    "source_input_price": 5.0,
    "source_output_price": 30.0,
    "pricing_basis": "standard_short_context_non_batch",
    "source_url": "https://developers.openai.com/api/docs/pricing?latest-pricing=standard"
  },
  {
    "provider": "deepseek",
    "model": "deepseek-v4-pro",
    "pricing_unit": "token_1k",
    "source_currency": "CNY",
    "source_unit": "per_1m_tokens",
    "source_input_cache_hit_price": 0.025,
    "source_input_cache_miss_price": 3.0,
    "source_output_price": 6.0,
    "pricing_basis": "cache_miss_input_and_output",
    "source_url": "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/"
  }
]
```

A keyed object is also supported:

```json
{
  "openai:gpt-5.5": {
    "source_currency": "USD",
    "source_unit": "per_1m_tokens",
    "source_input_price": 5.0,
    "source_output_price": 30.0
  }
}
```

## Source-unit conversion

Runtime conversion to RMB price snapshots:

```txt
per_1m_tokens -> source_price * exchange_rate / 1000 = RMB / 1K tokens
per_1k_tokens -> source_price * exchange_rate        = RMB / 1K tokens
per_image     -> source_price * exchange_rate        = RMB / image
per_request   -> source_price * exchange_rate        = RMB / request
```

For providers with cache-hit/cache-miss input prices, current cost accounting uses `source_input_cache_miss_price` by default because the usage ledger does not yet distinguish cached input tokens. `source_input_cache_hit_price` is preserved for display/audit and future cached-token support.

## Video generation pricing

Volcengine Doubao Seedance 2.0 / 2.0 Fast video generation is priced by official `usage.completion_tokens`, not by request count or a fixed seconds multiplier:

```txt
video cost = completion_tokens / 1,000,000 * official token unit price
```

The exact token count comes from the Volcengine task query response. The official formula for estimating token usage is kept only as background reference; ledger rows should use returned `completion_tokens` when available. Successful generations are recorded as `service = video_generation`, `pricing_unit = token_1k`, `source_currency = CNY`, `source_unit = per_1m_tokens`, and preserve the matched official source price snapshot.

Seedance video prices vary by model, output resolution, and whether the input contains a reference video. Configure those cases with `video_pricing_rules`, for example:

```json
{
  "provider": "volcengine",
  "model": "doubao-seedance-2-0-fast-260128",
  "pricing_unit": "token_1k",
  "source_currency": "CNY",
  "source_unit": "per_1m_tokens",
  "video_pricing_rules": [
    { "resolution": "720p", "input_contains_video": false, "source_output_price": 37.0 },
    { "resolution": "720p", "input_contains_video": true, "source_output_price": 22.0 }
  ]
}
```

## Exchange-rate lookup

USD prices are converted at usage-write time. Lookup order:

1. `USD_CNY_RATE` env override, if set — useful for tests or intentionally fixed accounting periods.
2. `https://api.frankfurter.app/latest?from=USD&to=CNY`
3. `https://open.er-api.com/v6/latest/USD`
4. `USD_CNY_FALLBACK` env, if set

If no exchange rate can be resolved for a non-CNY source currency, the unified RMB price remains `0` rather than using a stale guessed rate.

## Optional override 1: `MODEL_PRICES_JSON`

Set `MODEL_PRICES_JSON` to the same JSON array/object format. Entries in this environment variable override the file.

## Optional override 2: per-model environment variables

Names are normalized as:

```txt
MODEL_PRICE_<PROVIDER>_<MODEL>_<FIELD>
```

Non-alphanumeric characters in provider/model become `_`.

Examples:

```bash
MODEL_PRICE_OPENAI_GPT_5_5_INPUT=0.0
MODEL_PRICE_OPENAI_GPT_5_5_OUTPUT=0.0
MODEL_PRICE_OPENAI_GPT_5_5_PRICING_UNIT=token_1k

MODEL_PRICE_OPENAI_GPT_IMAGE_2_IMAGE=0.0
MODEL_PRICE_OPENAI_GPT_IMAGE_2_PRICING_UNIT=image
```

Per-model environment variables are RMB-denominated compatibility overrides and override both the file and `MODEL_PRICES_JSON`. They are mainly for temporary emergency overrides.

Supported suffixes:

- `_INPUT` — input token price, RMB per 1K tokens
- `_OUTPUT` — output token price, RMB per 1K tokens
- `_IMAGE` — image price, RMB per image
- `_VIDEO` — video price, RMB per second
- `_REQUEST` — request price, RMB per request
- `_PRICING_UNIT` — `token_1k`, `image`, `video_second`, or `request`

## Loading priority

```txt
backend/config/model-prices.json
  < MODEL_PRICES_FILE if set
  < MODEL_PRICES_JSON
  < MODEL_PRICE_<PROVIDER>_<MODEL>_* env overrides
```

## Fallback behavior

If a model-level price is not configured, the backend falls back to the existing provider/service-level RMB settings:

- `OPENAI_INPUT_PRICE`, `OPENAI_OUTPUT_PRICE`
- `GEMINI_INPUT_PRICE`, `GEMINI_OUTPUT_PRICE`
- `DEEPSEEK_INPUT_PRICE`, `DEEPSEEK_OUTPUT_PRICE`
- `MOONSHOT_INPUT_PRICE`, `MOONSHOT_OUTPUT_PRICE`
- `IMAGE_GEN_UNIT_PRICE`, `IMAGE_GEN_INPUT_PRICE`, `IMAGE_GEN_OUTPUT_PRICE`
- `VISION_INPUT_PRICE`, `VISION_OUTPUT_PRICE`
- `DOC_GEN_INPUT_PRICE`, `DOC_GEN_OUTPUT_PRICE`
- `EMBEDDING_INPUT_PRICE`

If both model-level and fallback prices are unset, usage cost remains `0`.

## Historical records

Changing source prices or exchange rates affects only new usage records. Existing rows keep their snapshots (`source_currency`, source prices, `exchange_rate_to_rmb`, RMB unit prices, and `total_cost_rmb`) unless a separate backfill is run.
