// postbuild:写 dist/version.json,前端轮询比对 buildId 提示「新版本可用」。
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
writeFileSync(resolve(dist, 'version.json'), JSON.stringify({ buildId: String(Date.now()) }));
console.log('version.json written');
