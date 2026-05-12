#!/bin/bash
export DATABASE_URL="file:./dev.db"
export PORT=9091
export JWT_SECRET="aipool-secret-key-change-in-production"
export NODE_ENV=production

node dist/index.js
