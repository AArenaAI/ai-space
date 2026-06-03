package main

import (
	"context"
	"database/sql"
	"flag"
	"fmt"
	"os"
	"strings"

	_ "github.com/jackc/pgx/v5/stdlib"
)

type backfillRule struct {
	Name          string
	Where         string
	Module        string
	Feature       string
	Operation     string
	OperationOnly bool
}

var rules = []backfillRule{
	{
		Name:      "legacy chat messages",
		Where:     "service = 'chat' AND resource_type = 'message'",
		Module:    "chat",
		Feature:   "chat",
		Operation: "chat_completion",
	},
	{
		Name:      "legacy image generation records",
		Where:     "service = 'image_generation' AND resource_type = 'image_generation'",
		Module:    "creative",
		Feature:   "image",
		Operation: "image_generation_legacy",
	},
	{
		Name:      "legacy video generation records",
		Where:     "service = 'video_generation' AND resource_type = 'video_generation'",
		Module:    "creative",
		Feature:   "video",
		Operation: "video_generation",
	},
}

func main() {
	apply := flag.Bool("apply", false, "apply updates; default is dry-run")
	flag.Parse()

	dsn := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dsn == "" {
		fmt.Fprintln(os.Stderr, "DATABASE_URL is required")
		os.Exit(2)
	}

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		panic(err)
	}
	defer db.Close()

	ctx := context.Background()
	if err := db.PingContext(ctx); err != nil {
		panic(err)
	}

	fmt.Printf("Usage v3 product-dimension backfill (%s)\n", modeLabel(*apply))
	printMissingSummary(ctx, db, "before")

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		panic(err)
	}
	defer tx.Rollback()

	totalTouched := int64(0)
	for _, rule := range rules {
		matched := countRule(ctx, tx, rule)
		fmt.Printf("rule=%q matched_missing=%d\n", rule.Name, matched)
		if matched == 0 {
			continue
		}
		if *apply {
			touched := applyRule(ctx, tx, rule)
			fmt.Printf("rule=%q updated=%d\n", rule.Name, touched)
			totalTouched += touched
		}
	}

	if *apply {
		if err := tx.Commit(); err != nil {
			panic(err)
		}
		fmt.Printf("committed updated_rows=%d\n", totalTouched)
		printMissingSummary(ctx, db, "after")
		return
	}

	fmt.Println("dry-run only; rerun with --apply to update rows")
}

func modeLabel(apply bool) string {
	if apply {
		return "apply"
	}
	return "dry-run"
}

func missingPredicate() string {
	return "(coalesce(module,'') = '' OR coalesce(feature,'') = '' OR coalesce(operation,'') = '')"
}

func countRule(ctx context.Context, tx *sql.Tx, rule backfillRule) int64 {
	query := fmt.Sprintf("SELECT count(*) FROM api_usage_logs WHERE %s AND %s", rule.Where, missingPredicate())
	var n int64
	if err := tx.QueryRowContext(ctx, query).Scan(&n); err != nil {
		panic(err)
	}
	return n
}

func applyRule(ctx context.Context, tx *sql.Tx, rule backfillRule) int64 {
	query := fmt.Sprintf(`
UPDATE api_usage_logs
SET
  module = CASE WHEN coalesce(module,'') = '' THEN $1 ELSE module END,
  feature = CASE WHEN coalesce(feature,'') = '' THEN $2 ELSE feature END,
  operation = CASE WHEN coalesce(operation,'') = '' THEN $3 ELSE operation END,
  updated_at = NOW()
WHERE %s AND %s`, rule.Where, missingPredicate())
	res, err := tx.ExecContext(ctx, query, rule.Module, rule.Feature, rule.Operation)
	if err != nil {
		panic(err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		panic(err)
	}
	return n
}

func printMissingSummary(ctx context.Context, db *sql.DB, label string) {
	var total, missing int64
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM api_usage_logs`).Scan(&total); err != nil {
		panic(err)
	}
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM api_usage_logs WHERE coalesce(module,'') = '' OR coalesce(feature,'') = '' OR coalesce(operation,'') = ''`).Scan(&missing); err != nil {
		panic(err)
	}
	fmt.Printf("%s total=%d missing_product_dimensions=%d\n", label, total, missing)
}
