#!/usr/bin/env bash
# Deploy AI Space static frontend (Next.js export) to S3 and optionally invalidate CloudFront.
#
# Required env:
#   S3_BUCKET=your-frontend-bucket-name
# Optional env:
#   AWS_PROFILE=your-profile
#   AWS_REGION=ap-northeast-1
#   CLOUDFRONT_DISTRIBUTION_ID=E1234567890ABC
#   BUILD=1                 # set BUILD=0 to skip npm run build
#   INVALIDATE_PATHS='/*'   # default: /*
#
# Usage:
#   S3_BUCKET=ai-space-frontend-prod \
#   CLOUDFRONT_DISTRIBUTION_ID=E1234567890ABC \
#   AWS_REGION=ap-northeast-1 \
#   ./deploy-frontend-s3.sh

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$PROJECT_DIR/frontend"
OUT_DIR="$FRONTEND_DIR/out"
S3_BUCKET="${S3_BUCKET:-}"
AWS_REGION="${AWS_REGION:-ap-northeast-1}"
BUILD="${BUILD:-1}"
INVALIDATE_PATHS="${INVALIDATE_PATHS:-/*}"
CLOUDFRONT_DISTRIBUTION_ID="${CLOUDFRONT_DISTRIBUTION_ID:-}"

if [ -z "$S3_BUCKET" ]; then
  echo "❌ missing S3_BUCKET, example: S3_BUCKET=ai-space-frontend-prod $0" >&2
  exit 2
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "❌ aws CLI not found. Install first, then run aws configure / set AWS_PROFILE." >&2
  exit 2
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "❌ npm not found." >&2
  exit 2
fi

echo "=== AI Space frontend S3 deploy ==="
echo "Project:       $PROJECT_DIR"
echo "Frontend:      $FRONTEND_DIR"
echo "Output:        $OUT_DIR"
echo "S3 bucket:     s3://$S3_BUCKET"
echo "AWS region:    $AWS_REGION"
echo "CloudFront:    ${CLOUDFRONT_DISTRIBUTION_ID:-<skip invalidation>}"
echo ""

cd "$FRONTEND_DIR"

if [ "$BUILD" != "0" ]; then
  echo "[1/4] Installing frontend dependencies when needed..."
  if [ -f package-lock.json ]; then
    npm ci
  else
    npm install
  fi

  echo "[2/4] Building static frontend..."
  npm run build
else
  echo "[1/4] BUILD=0, skip npm install/build"
fi

if [ ! -f "$OUT_DIR/index.html" ]; then
  echo "❌ $OUT_DIR/index.html not found. Did the static export build succeed?" >&2
  exit 1
fi

echo "[3/4] Sync long-cache hashed Next assets..."
if [ -d "$OUT_DIR/_next/static" ]; then
  aws s3 sync "$OUT_DIR/_next/static/" "s3://$S3_BUCKET/_next/static/" \
    --region "$AWS_REGION" \
    --delete \
    --cache-control "public,max-age=31536000,immutable"
fi

echo "[3/4] Sync app static files with short cache..."
aws s3 sync "$OUT_DIR/" "s3://$S3_BUCKET/" \
  --region "$AWS_REGION" \
  --delete \
  --exclude "_next/static/*" \
  --cache-control "public,max-age=300"

echo "[3/4] Mark HTML and Next route text payloads as no-cache..."
aws s3 cp "$OUT_DIR/" "s3://$S3_BUCKET/" \
  --region "$AWS_REGION" \
  --recursive \
  --exclude "*" \
  --include "*.html" \
  --include "*.txt" \
  --cache-control "no-cache" \
  --metadata-directive REPLACE

if [ -n "$CLOUDFRONT_DISTRIBUTION_ID" ]; then
  echo "[4/4] Creating CloudFront invalidation: $INVALIDATE_PATHS"
  aws cloudfront create-invalidation \
    --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
    --paths "$INVALIDATE_PATHS"
else
  echo "[4/4] CLOUDFRONT_DISTRIBUTION_ID empty, skip invalidation"
fi

echo "✅ frontend deployed to s3://$S3_BUCKET"
