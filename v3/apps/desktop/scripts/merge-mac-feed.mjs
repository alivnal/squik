// Each Mac architecture is built on its own (it bundles its own FFmpeg), and each
// build writes release/latest-mac.yml for that architecture only. The updater
// picks the file for its own machine from one feed, so this joins the two:
// run it after `dist:mac:arm64` saved its feed as latest-mac-arm64.yml and
// `dist:mac:x64` wrote latest-mac.yml.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const release = fileURLToPath(new URL('../release/', import.meta.url));
const arm64 = yaml.load(readFileSync(`${release}latest-mac-arm64.yml`, 'utf8'));
const x64 = yaml.load(readFileSync(`${release}latest-mac.yml`, 'utf8'));

if (arm64.version !== x64.version) {
  throw new Error(`Feeds disagree: arm64 ${arm64.version}, x64 ${x64.version}. Build both from the same version.`);
}
const byUrl = new Map([...x64.files, ...arm64.files].map((file) => [file.url, file]));
const merged = { ...x64, files: [...byUrl.values()] };
writeFileSync(`${release}latest-mac.yml`, yaml.dump(merged, { lineWidth: -1 }));
console.log(`latest-mac.yml ${merged.version}: ${merged.files.map((file) => file.url).join(', ')}`);
