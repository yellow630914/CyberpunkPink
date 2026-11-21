#!/usr/bin/env node
// CyberpunkPink 子代理的寫入守門。用法：node guard.mjs <mode>
// mode：no-core | data-only | ui-only | tests-only | cpp-only
// 讀 PreToolUse 的 JSON（stdin），擋住時 stderr 寫原因並 exit 2。
// 這個檔案在 <repo>/.claude/cpp/hooks/；設定在 <repo>/.claude/cpp/project.json；工作檔（工單、報告）在 <repo>/dev/。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
const here = path.dirname(fileURLToPath(import.meta.url));
const repoDefault = path.resolve(here, '..', '..', '..');
const cfgPath = path.join(repoDefault, '.claude', 'cpp', 'project.json');
const win = process.platform === 'win32';
const norm = (p) => {
  const s = path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '');
  return win ? s.toLowerCase() : s;
};
const under = (file, dir) => {
  const f = norm(file), d = norm(dir);
  return f === d || f.startsWith(d + '/');
};

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(raw); } catch { process.exit(0); }
  const ti = input.tool_input || {};
  const target = ti.file_path || ti.notebook_path || ti.path;
  if (!target) process.exit(0);

  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); }
  catch { console.error('guard: 讀不到 .claude/cpp/project.json'); process.exit(2); }

  const cwd = input.cwd || process.cwd();
  const repo = path.resolve(repoDefault, cfg.repoRoot || '.');
  const workDir = path.join(repo, cfg.workDir || 'dev');
  const abs = path.resolve(cwd, target);

  // dev/ 的工作檔可以寫（工單、報告、紀錄）；審查只能寫 dev/reviews/
  if (mode === 'cpp-only') {
    if (under(abs, path.join(workDir, 'reviews'))) process.exit(0);
  } else if (under(abs, workDir)) process.exit(0);

  const inAny = (dirs = []) => dirs.some((d) => {
    if (d.startsWith('**/')) {
      const seg = '/' + (win ? d.slice(3).toLowerCase() : d.slice(3)) + '/';
      return norm(abs).includes(seg);
    }
    return under(abs, path.join(repo, d));
  });
  const isTestFile = (cfg.testFilePatterns || []).some((p) => abs.endsWith(p)) || inAny(cfg.testDirs);

  const block = (msg) => { console.error(`Blocked: ${msg}`); process.exit(2); };
  const rel = path.relative(repo, abs).replace(/\\/g, '/');

  switch (mode) {
    case 'no-core':
      if (inAny(cfg.coreDirs)) block(`${rel} 屬於核心層（${cfg.coreDirs.join(', ')}），只有 cpp-architect 能改。請停下來，回報需要的介面。`);
      break;
    case 'data-only':
      if (!inAny(cfg.dataDirs) && !isTestFile) block(`cpp-data 只能寫 ${cfg.dataDirs.join(', ')} 與測試。`);
      break;
    case 'ui-only':
      if (!inAny(cfg.uiDirs) && !isTestFile) block(`cpp-ui 只能寫 ${cfg.uiDirs.join(', ')} 與測試。`);
      break;
    case 'tests-only':
      if (!isTestFile) block(`測試層只能寫測試檔（${cfg.testDirs.join(', ')}、${(cfg.testFilePatterns || []).map((p) => '*' + p).join('、')}）與 dev/。要改程式請寫 bug 報告，交給實作者修。`);
      break;
    case 'cpp-only':
      block('審查只能寫 dev/reviews/，不改程式。');
      break;
    default:
      process.exit(0);
  }
  process.exit(0);
});
