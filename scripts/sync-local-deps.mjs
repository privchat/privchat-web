#!/usr/bin/env node
/**
 * 构建本地 `file:` 依赖（按依赖顺序，递归），并刷新它们在 pnpm store 里的快照。
 *
 * 为什么需要这个：三个 TS 仓是平级 + `file:` 互链（不做 monorepo）。pnpm 对本地目录
 * 依赖的处理是**把它按 `files` 字段快照拷贝**进 `node_modules/.pnpm/`，而且**不跑
 * `prepare`**。于是有两个后果：
 *
 *   1. 新克隆一份仓库、依赖包的 dist 还没构建过 → 快照里没有 dist，`main` 指向一个
 *      不存在的文件。装完不报错，import 时才炸。
 *   2. 改完依赖包的源码、只在这边 rebuild → 快照还是旧的，你在跟一份历史代码联调，
 *      而且完全没有提示。
 *
 * 顺序必须是「先把依赖构建出来 → 再刷新快照」，所以挂在 predev/prebuild 上。
 * 而且要**递归**：privchat-react 自己也 file: 依赖 privchat-sdk-typescript，
 * 先建 react 会因为拿不到 sdk 的类型而整片报 TS2307。
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readPkg = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));

const localDeps = (dir) => {
  const pkg = readPkg(dir);
  return Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })
    .filter(([, spec]) => typeof spec === 'string' && spec.startsWith('file:'))
    .map(([name, spec]) => ({ name, dir: resolve(dir, spec.slice('file:'.length)) }));
};

const newestSourceMtime = (dir) => {
  let newest = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else newest = Math.max(newest, statSync(p).mtimeMs);
    }
  };
  if (existsSync(dir)) walk(dir);
  return newest;
};

const built = new Set();
const rebuilt = [];

/** 先建依赖的依赖，再建自己。 */
const ensureBuilt = (name, dir) => {
  if (built.has(dir)) return;
  built.add(dir);
  if (!existsSync(dir)) {
    console.error(`[local-deps] ${name}: 找不到 ${dir}——几个仓要放在同级目录下`);
    process.exit(1);
  }
  for (const child of localDeps(dir)) ensureBuilt(child.name, child.dir);

  const pkg = readPkg(dir);
  const entry = join(dir, pkg.main ?? 'dist/index.js');
  const stale = !existsSync(entry) || statSync(entry).mtimeMs < newestSourceMtime(join(dir, 'src'));
  if (!stale) return;
  console.log(`[local-deps] ${name}: 构建（入口缺失或落后于源码）`);
  execSync('npm run build', { cwd: dir, stdio: 'inherit' });
  rebuilt.push(name);
};

for (const { name, dir } of localDeps(root)) ensureBuilt(name, dir);

// 快照是安装那一刻拷的，源码重建不会更新它。必须让 pnpm 重新拷一次。
if (rebuilt.length > 0) {
  console.log(`[local-deps] 已重建 ${rebuilt.join(', ')}，刷新 pnpm 快照`);
  for (const { name } of localDeps(root)) {
    execSync(`rm -rf node_modules/.pnpm/${name.replace('@', '').replace('/', '+')}*`, { cwd: root });
  }
  execSync('pnpm install', { cwd: root, stdio: 'inherit' });
}
