import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '0.9.9';
const apiBaseUrl = process.argv[2]?.replace(/\/$/, '');
if (!apiBaseUrl || !/^https:\/\/[^/]+$/.test(apiBaseUrl)) {
  console.error('用法: node scripts/build-paid-release.mjs https://你的激活服务域名');
  process.exit(2);
}
const releaseDir = path.join(root, 'dist', `X涨粉工作台-${version}`);
const extensionDir = path.join(releaseDir, 'extension');
const zipPath = path.join(root, 'dist', `X涨粉工作台-${version}.zip`);
fs.rmSync(releaseDir, { recursive: true, force: true });
fs.mkdirSync(releaseDir, { recursive: true });
fs.cpSync(path.join(root, 'extension'), extensionDir, { recursive: true });

const manifestPath = path.join(extensionDir, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.version = version;
manifest.version_name = `${version} 3天免费试用`;
const workerOrigin = new URL(apiBaseUrl).origin;
manifest.host_permissions = [...new Set([...manifest.host_permissions, `${workerOrigin}/*`])];
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(path.join(extensionDir, 'license-config.js'),
  `globalThis.XPCLicenseConfig = Object.freeze({ apiBaseUrl: ${JSON.stringify(apiBaseUrl)}, required: true, trialDays: 3, serverTrial: true, reportingRequired: true });\n`);

fs.rmSync(zipPath, { force: true });
const zipped = spawnSync('zip', ['-qr', zipPath, 'extension'], { cwd: releaseDir, encoding: 'utf8' });
if (zipped.status !== 0) {
  console.error(zipped.stderr || '打包失败');
  process.exit(1);
}
console.log(`已生成 ${zipPath}`);
