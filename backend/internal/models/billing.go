package models

import "time"

// BillingPlan defines sellable plans/packages. It is intentionally provider-aware
// so Stripe/Paddle/Creem/LemonSqueezy identifiers can be attached later.
type BillingPlan struct {
	ID              uint      `gorm:"primaryKey" json:"id"`
	Code            string    `gorm:"size:64;uniqueIndex" json:"code"`
	Name            string    `gorm:"size:128" json:"name"`
	Description     string    `gorm:"type:text" json:"description"`
	PriceCents      int64     `json:"price_cents"`
	Currency        string    `gorm:"size:12;default:'USD'" json:"currency"`
	Interval        string    `gorm:"size:24;index" json:"interval"` // monthly / yearly / one_time
	BasicCredits    int       `json:"basic_credits"`
	AdvancedCredits int       `json:"advanced_credits"`
	EliteCredits    int       `json:"elite_credits"`
	Enabled         bool      `gorm:"default:true;index" json:"enabled"`
	PublicVisible   bool      `gorm:"default:true;index" json:"public_visible"`
	SortOrder       int       `gorm:"index" json:"sort_order"`
	Provider        string    `gorm:"size:32;index" json:"provider"`
	ProviderPriceID string    `gorm:"size:128;index" json:"provider_price_id"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// BillingOrder stores payment/order state independently from current user entitlements.
type BillingOrder struct {
	ID                 uint       `gorm:"primaryKey" json:"id"`
	OrderNo            string     `gorm:"size:64;uniqueIndex" json:"order_no"`
	UserID             uint       `gorm:"index" json:"user_id"`
	PlanID             uint       `gorm:"index" json:"plan_id"`
	AmountCents        int64      `json:"amount_cents"`
	Currency           string     `gorm:"size:12" json:"currency"`
	Status             string     `gorm:"size:32;index" json:"status"` // pending / paid / failed / cancelled / refunded
	Provider           string     `gorm:"size:32;index" json:"provider"`
	ProviderOrderID    string     `gorm:"size:128;index" json:"provider_order_id"`
	ProviderCustomerID string     `gorm:"size:128;index" json:"provider_customer_id"`
	FailedReason       string     `gorm:"type:text" json:"failed_reason"`
	PaidAt             *time.Time `json:"paid_at,omitempty"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

// BillingSubscription stores recurring entitlement relationships.
type BillingSubscription struct {
	ID                     uint       `gorm:"primaryKey" json:"id"`
	UserID                 uint       `gorm:"index" json:"user_id"`
	PlanID                 uint       `gorm:"index" json:"plan_id"`
	Status                 string     `gorm:"size:32;index" json:"status"` // trialing / active / past_due / cancelled / expired
	Interval               string     `gorm:"size:24" json:"interval"`
	Provider               string     `gorm:"size:32;index" json:"provider"`
	ProviderSubscriptionID string     `gorm:"size:128;uniqueIndex" json:"provider_subscription_id"`
	CurrentPeriodStart     *time.Time `json:"current_period_start,omitempty"`
	CurrentPeriodEnd       *time.Time `json:"current_period_end,omitempty"`
	CancelAt               *time.Time `json:"cancel_at,omitempty"`
	CreatedAt              time.Time  `json:"created_at"`
	UpdatedAt              time.Time  `json:"updated_at"`
}

// PaymentEvent persists raw webhook delivery/processing state for replay and debugging.
type PaymentEvent struct {
	ID           uint       `gorm:"primaryKey" json:"id"`
	Provider     string     `gorm:"size:32;index" json:"provider"`
	EventID      string     `gorm:"size:160;uniqueIndex" json:"event_id"`
	EventType    string     `gorm:"size:128;index" json:"event_type"`
	Status       string     `gorm:"size:32;index" json:"status"` // received / processed / failed / ignored
	PayloadJSON  string     `gorm:"type:text" json:"payload_json,omitempty"`
	ErrorMessage string     `gorm:"type:text" json:"error_message,omitempty"`
	ProcessedAt  *time.Time `json:"processed_at,omitempty"`
	CreatedAt    time.Time  `gorm:"index" json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

// CreditTransaction records every entitlement balance mutation.
type CreditTransaction struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	UserID       uint      `gorm:"index" json:"user_id"`
	Type         string    `gorm:"size:32;index" json:"type"` // grant / deduct / refund / adjust / reset
	Tier         string    `gorm:"size:24;index" json:"tier"` // basic / advanced / elite
	Amount       int       `json:"amount"`
	BalanceAfter int       `json:"balance_after"`
	Reason       string    `gorm:"type:text" json:"reason"`
	SourceType   string    `gorm:"size:64;index" json:"source_type"` // admin / order / subscription / system
	SourceID     string    `gorm:"size:128;index" json:"source_id"`
	OperatorID   uint      `gorm:"index" json:"operator_id"`
	CreatedAt    time.Time `gorm:"index" json:"created_at"`
}
