# 付呗支付宝扫码会员支付接入方案

## 背景

AI Space 首期只接会员套餐支付，先做支付宝扫码链路。付呗技术指定使用 `payment_ordercreate`（统一下单），其公开文档流程是：支付宝官方授权获取 `user_id` → 调付呗统一下单获取 `prepay_id` → 调支付宝官方接口拉起支付 → 付呗异步回调。

因此 PC 端二维码不是付呗直接返回的支付二维码，而是 AI Space 自己的手机支付页二维码。

## 用户流程

```text
PC 定价页选择会员套餐
  ↓
后端创建 AI Space BillingOrder
  ↓
PC 弹窗展示二维码：/payment/alipay?order_no=...
  ↓
用户用手机支付宝扫码
  ↓
移动页跳转后端支付宝授权入口
  ↓
支付宝回跳 AI Space 后端，后端换取/接收支付宝 user_id
  ↓
后端调用付呗 payment_ordercreate：pay_type=alipay, user_id=支付宝user_id
  ↓
移动页拿到支付宝支付凭证并拉起支付宝支付
  ↓
付呗 POST 回调 /api/payments/fubei/notify
  ↓
后端验签、幂等置 paid、开通会员套餐、记录 CreditTransaction/PaymentEvent
  ↓
PC 轮询订单状态，成功后关闭弹窗并刷新会员状态
```

## API 边界

### 认证接口

- `POST /api/payments/fubei/alipay/orders`
  - 登录用户创建会员订单。
  - 入参：`plan_code`。
  - 出参：`order_no`, `amount_cents`, `currency`, `mobile_pay_url`, `expires_at`。

- `GET /api/payments/orders/:order_no`
  - 登录用户查询自己的订单状态。

### 公开移动支付/回调接口

- `GET /api/payments/fubei/alipay/auth?order_no=...`
  - 跳转支付宝授权页。

- `GET /api/payments/fubei/alipay/callback?order_no=...&auth_code=...`
  - 支付宝授权回调。后端换取 `user_id` 后调用付呗统一下单。
  - 返回一个移动端过渡页，内嵌支付凭证，供前端拉起支付宝支付。

- `POST /api/payments/fubei/notify`
  - 付呗支付回调。
  - 验签，解析业务参数，幂等处理订单。
  - 成功返回 `success`。

## 配置项

```env
PUBLIC_APP_URL=https://你的正式域名

FUBEI_GATEWAY_URL=
FUBEI_APP_ID=
FUBEI_APP_SECRET=
FUBEI_STORE_ID=
FUBEI_ALIPAY_METHOD=fbpay.order.create

ALIPAY_APP_ID=
ALIPAY_AUTH_BASE_URL=https://openauth.alipay.com/oauth2/publicAppAuthorize.htm
ALIPAY_GATEWAY_URL=https://openapi.alipay.com/gateway.do
ALIPAY_PRIVATE_KEY=
ALIPAY_PUBLIC_KEY=
```

> 说明：`payment_ordercreate` 需要支付宝 `user_id`，所以必须完成支付宝官方授权。支付宝授权 code 换 user_id 需要支付宝开放平台签名配置。

## 套餐映射（首期硬编码，后续可入库）

- `basic`: Basic 会员，100 基础 Credit + 25 高级 Credit。
- `plus`: Plus 会员，300 基础 Credit + 100 高级 Credit。
- `ultra`: Ultra 会员，基础无限 + 260 高级 Credit。

价格先用后端配置或默认占位；未配置价格时接口拒绝创建真实支付订单，避免误收款。

## 风险点

1. `payment_ordercreate` 不是直接返回 PC 支付二维码，PC 二维码应指向 AI Space 手机支付页。
2. 支付宝官方授权与拉起支付需要支付宝应用配置；付呗只负责统一下单和回调。
3. 订单状态和会员权益必须通过 BillingOrder/PaymentEvent/CreditTransaction 落库，不能只改 `User.PlanTier`。
4. 回调必须幂等：已 paid 的订单重复回调直接返回 success。
5. 内测 beta_credit_balance 与会员额度独立，支付会员只改会员体系字段，不改 beta 钱包。

## 验证清单

- 后端 `go test ./...`。
- 前端 `npx tsc --noEmit` 和 `npm run build`。
- 创建订单接口未登录返回 401。
- 未配置付呗/支付宝密钥时返回清晰错误，不创建可支付订单。
- 回调验签失败返回 400。
- 重复回调不重复发放额度。
- PC 定价页能展示二维码弹窗并轮询订单。
- 移动支付页在支付宝外打开时提示“请使用支付宝扫码打开”。
