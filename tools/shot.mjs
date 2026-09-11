#!/usr/bin/env node
/** 无头截图工具:node tools/shot.mjs <url参数> <输出名> [virtualMs] */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const [query = 'capture=1', name = 'shot', vms = '9000', mode] = process.argv.slice(2);
const outDir = resolve(import.meta.dirname, '..', 'qa');
if (!existsSync(outDir)) mkdirSync(outDir);
const out = resolve(outDir, `${name}.png`);
const profile = `C:/Users/edward/AppData/Local/Temp/chrome-bb-shot-${Date.now() % 100000}`;

try {
  execFileSync(chrome, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
    `--user-data-dir=${profile}`,
    '--window-size=1920,952',
    mode === 'real' ? `--timeout=${vms}` : `--virtual-time-budget=${vms}`,
    `--screenshot=${out}`,
    `http://127.0.0.1:8901/?${query}`,
  ], { stdio: 'ignore', timeout: 60000 });
  console.log('OK', out);
} catch (e) {
  console.error('FAIL', e.message);
  process.exit(1);
}
