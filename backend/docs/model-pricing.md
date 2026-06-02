# Model-level pricing configuration

AI Space usage cost accounting records a price snapshot into `api_usage_logs` when each external model/API call is written. Model-level pricing has priority over provider-level fallback prices.

All prices are in RMB.

## Option 1: JSON table

Set `MODEL_PRICES_JSON` to either an array:

```json
[
  {
    "provider": "openai",
    "model": "gpt-5.5",
    "pricing_unit": "token_1k",
    "input_price_rmb": 0.0,
    "output_price_rmb": 0.0
  },
  {
    "provider": "openai",
    "model": "gpt-image-2",
    "pricing_unit": "image",
    "image_unit_price_rmb": 0.0
  }
]
```

or a keyed object:

```json
{
  "openai:gpt-5.5": {
    "input_price_rmb": 0.0,
    "output_price_rmb": 0.0
  },
  "openai:gpt-image-2": {
    "pricing_unit": "image",
    "image_unit_price_rmb": 0.0
  }
}
```

## Option 2: per-model environment variables

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

MODEL_PRICE_DEEPSEEK_DEEPSEEK_V4_PRO_INPUT=0.0
MODEL_PRICE_DEEPSEEK_DEEPSEEK_V4_PRO_OUTPUT=0.0
```

Supported suffixes:

- `_INPUT` — input token price, RMB per 1K tokens
- `_OUTPUT` — output token price, RMB per 1K tokens
- `_IMAGE` — image price, RMB per image
- `_VIDEO` — video price, RMB per second
- `_REQUEST` — request price, RMB per request
- `_PRICING_UNIT` — `token_1k`, `image`, `video_second`, or `request`

## Fallback behavior

If a model-level price is not configured, the backend falls back to the existing provider/service-level settings:

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

Changing prices affects only new usage records. Existing rows keep their price snapshots (`input_unit_price_rmb`, `output_unit_price_rmb`, `image_unit_price_rmb`, `total_cost_rmb`) unless a separate backfill is run.
