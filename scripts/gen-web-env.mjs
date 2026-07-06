#!/usr/bin/env node
// 白标 Web：从 app 仓 brand profile JSON 生成 .env.<brand>（单一真源，禁手工维护 env）。
// 用法: node scripts/gen-web-env.mjs <brandId> [platformBaseUrlOverride]
//   override 用于部署形态差异（如 nginx 同源反代时传 /app，免 CORS）。
// 构建: npx vite build --mode <brand>
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [brandId, baseOverride] = process.argv.slice(2);
if (!brandId) { console.error('usage: gen-web-env.mjs <brandId> [platformBaseUrlOverride]'); process.exit(1); }

const profilePath = resolve(here, `../../privchat-app/privchat/config/profiles/${brandId}.json`);
const p = JSON.parse(readFileSync(profilePath, 'utf8'));
const theme = p.theme?.light ?? {};
const platformBaseUrl = baseOverride ?? p.platformBaseUrl ?? '';
const isPlatform = (p.accountMode ?? 'BUILTIN').toUpperCase() === 'PLATFORM';
// 浏览器只支持 ws/wss；BUILTIN 用 profile.gateways 的 ws 条目，PLATFORM 网关走 bootstrap 下发不内置。
const wsGateway = isPlatform ? '' : (p.gateways ?? []).find((g) => g.startsWith('ws')) ?? '';
if (!isPlatform && wsGateway === '') console.warn(`WARN: profile '${brandId}' 无 ws/wss 网关，BUILTIN Web 无法连接`);

const lines = [
  `# 由 scripts/gen-web-env.mjs 从 profiles/${brandId}.json 生成 —— 勿手工编辑`,
  `VITE_PRIVCHAT_BRAND_ID=${p.id}`,
  `VITE_PRIVCHAT_APP_NAME=${p.appName}`,
  `VITE_PRIVCHAT_TAGLINE=${p.tagline ?? ''}`,
  `VITE_PRIVCHAT_ACCOUNT_MODE=${isPlatform ? 'platform' : 'builtin'}`,
  `VITE_PRIVCHAT_PLATFORM_BASE_URL=${isPlatform ? platformBaseUrl : ''}`,
  `VITE_PRIVCHAT_GATEWAY_URL=${wsGateway}`,
  `VITE_PRIVCHAT_THEME_PRIMARY=${theme.primary ?? ''}`,
  `VITE_PRIVCHAT_THEME_ACCENT=${theme.accent ?? ''}`,
];
const out = resolve(here, `../.env.${brandId}`);
writeFileSync(out, lines.join('\n') + '\n');
console.log(`→ ${out}`);
console.log(lines.join('\n'));
