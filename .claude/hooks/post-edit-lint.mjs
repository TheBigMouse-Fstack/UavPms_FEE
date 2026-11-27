#!/usr/bin/env node
/**
 * PostToolUse auto-format & targeted lint for Angular FE source edits.
 * Runs Prettier + ESLint only on files under src/ (.ts, .html, .scss).
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOOK_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HOOK_DIR, '..', '..');

let rawInput = '';
try {
  rawInput = fs.readFileSync(0, 'utf8');
} catch {
  process.exit(0);
}

let payload = {};
try {
  payload = JSON.parse(rawInput.replace(/^\uFEFF/, '') || '{}');
} catch {
  process.exit(0);
}

const rawPath = String(payload?.tool_input?.file_path ?? payload?.tool_input?.path ?? '').replace(/\\/g, '/').trim();
if (!rawPath) process.exit(0);

const absPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(REPO_ROOT, rawPath);
const relPath = path.relative(REPO_ROOT, absPath).replace(/\\/g, '/');

if (!relPath.startsWith('src/') || !/\.(ts|html|scss)$/i.test(relPath) || !fs.existsSync(absPath)) {
  process.exit(0);
}

const prettierCli = path.join(REPO_ROOT, 'node_modules', 'prettier', 'bin', 'prettier.cjs');
if (fs.existsSync(prettierCli)) {
  spawnSync(process.execPath, [prettierCli, '--write', '--ignore-unknown', absPath], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
  });
}

if (/\.(ts|html)$/i.test(relPath)) {
  const eslintCli = path.join(REPO_ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js');
  if (fs.existsSync(eslintCli)) {
    const res = spawnSync(process.execPath, [eslintCli, '--quiet', absPath], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    if (res.status !== 0) {
      if (res.stdout) process.stderr.write(res.stdout);
      if (res.stderr) process.stderr.write(res.stderr);
      process.exit(res.status || 1);
    }
  }
}

process.exit(0);
