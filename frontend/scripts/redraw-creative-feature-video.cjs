#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');

const script = path.join(__dirname, 'redraw-creative-feature-video.py');
const result = spawnSync('python3', [script], { stdio: 'inherit' });
process.exit(result.status || 0);
