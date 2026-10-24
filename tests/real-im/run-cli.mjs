// Run the existing Playwright CLI with private fixture input; never log passwords/tokens.
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = process.env.PRIVCHAT_REAL_IM_FIXTURE;
if (!/^\/tmp\/privchat-features-im\.[A-Za-z0-9]+$/.test(root ?? '')) throw Error('Explicit disposable fixture required');
const accounts = JSON.parse(await readFile(`${root}/accounts.json`, 'utf8'));
const gateway = JSON.parse(await readFile(`${root}/public.json`, 'utf8'));
if (gateway.host !== '127.0.0.1' || gateway.wsPort !== 58410) throw Error('Only the approved isolated IM is allowed');
const group = JSON.parse(await readFile(`${root}/browser-group.json`, 'utf8'));
if (String(group.groupId) === '14' || String(group.channelId) === '14') throw Error('Mobile group is reserved');
const stage = (await import(pathToFileURL(resolve(process.argv[2])).href)).default;
const directory = await mkdtemp(join(tmpdir(), 'privchat-browser-code-'));
const code = join(directory, 'scenario.js');
const secrets = Object.values(accounts).flatMap(account => [account.password, account.token]).filter(Boolean);
const redact = value => secrets.reduce((text, secret) => text.replaceAll(secret, '[REDACTED]').replaceAll(JSON.stringify(secret).slice(1, -1), '[REDACTED]'), String(value));
try {
  await writeFile(code, `async page => { const run = ${stage.toString()}; return run(page, ${JSON.stringify({ accounts, group })}); }`, { mode: 0o600 });
  const result = execFileSync('npx', ['--offline', '--yes', '--package', '@playwright/cli', 'playwright-cli', '-s=four-feature-web', 'run-code', `--filename=${code}`], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  console.log(redact(result));
  if (result.includes('### Error')) process.exitCode = 1;
} catch (error) {
  console.error(redact(error.stdout ?? error.message)); process.exitCode = 1;
} finally { await rm(directory, { recursive: true, force: true }); }
