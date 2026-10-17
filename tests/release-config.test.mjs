import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const readText = (path) => readFile(new URL(path, root), "utf8");
const readJson = async (path) => JSON.parse(await readText(path));

test("Linux 包名使用合法 ASCII 标识且保留中文桌面名称", async () => {
  const config = await readJson("src-tauri/tauri.linux.conf.json");
  assert.match(config.productName, /^[a-z0-9][a-z0-9+.-]*$/);
  assert.equal(config.productName, "guotan-radar");
  assert.equal(config.bundle.linux.deb.desktopTemplate, "linux/guotan-radar.desktop.hbs");
  assert.match(await readText("src-tauri/linux/guotan-radar.desktop.hbs"), /^Name=库存查询器$/m);
});

test("发布名称、应用标识和版本保持一致", async () => {
  const packageJson = await readJson("package.json");
  const config = await readJson("src-tauri/tauri.conf.json");
  const workspace = await readText("Cargo.toml");
  assert.equal(packageJson.name, "guotan-radar");
  assert.equal(config.productName, "库存查询器");
  assert.equal(config.identifier, "com.thomasdjmax.guotan-radar");
  assert.equal(config.version, packageJson.version);
  assert.match(workspace, new RegExp(`^version = "${packageJson.version.replaceAll(".", "\\.")}"$`, "m"));
  assert.equal(config.bundle.createUpdaterArtifacts, false);
  assert.equal(config.plugins?.updater, undefined);
});

test("打包模板只手动验证并上传 artifact，不发布或配置签名更新", async () => {
  const workflow = await readText("build-templates/packages.yml");
  assert.match(workflow, /^  workflow_dispatch:$/m);
  assert.doesNotMatch(workflow, /^  (?:push|pull_request|schedule):/m);
  assert.doesNotMatch(workflow, /contents: write|tauri-apps\/tauri-action|uploadUpdaterJson|TAURI_SIGNING_PRIVATE_KEY|releaseDraft|tagName:/);
  assert.match(workflow, /run: pnpm tauri build --ci -- --locked/);
  assert.doesNotMatch(workflow, /run:.*--no-sign/);
  assert.match(workflow, /codesign --verify --deep --strict/);
  assert.match(workflow, /Identifier=com\.thomasdjmax\.guotan-radar/);
  assert.match(workflow, /Signature=adhoc/);
  assert.match(workflow, /hdiutil verify/);
  assert.match(workflow, /uses: actions\/upload-artifact@/);
  assert.match(workflow, /if-no-files-found: error/);
});

test("Linux 和 Windows 构建保留安装验证，公开包使用 ASCII 文件名", async () => {
  const workflow = await readText("build-templates/packages.yml");
  const readme = await readText("README.md");
  const packageJson = await readJson("package.json");
  const escapedVersion = packageJson.version.replaceAll(".", "\\.");
  assert.match(workflow, /test "\$deb_name" = "guotan-radar"/);
  assert.match(workflow, /test "\$rpm_name" = "guotan-radar"/);
  assert.match(workflow, /dpkg-query -W.*guotan-radar/);
  assert.match(workflow, /Start-Process.*installer\.FullName.*ArgumentList.*\/S/);
  assert.match(workflow, /Filter 'guotan-radar\.exe'/);
  assert.match(workflow, /inventory-checker_\$\{version\}_\$\{PACKAGE_ARCH\}\.dmg/);
  assert.match(workflow, /inventory-checker_\$\{version\}_\$\{PACKAGE_ARCH\}-setup\.exe/);
  assert.match(readme, new RegExp(`inventory-checker_${escapedVersion}_aarch64\\.dmg`));
  assert.match(readme, new RegExp(`inventory-checker_${escapedVersion}_amd64\\.deb`));
  assert.doesNotMatch(readme, new RegExp(`Apple\\.Store\\.Inventory\\.Monitor_${escapedVersion}`));
  assert.match(readme, /本次.*只(?:发布|提供).*Apple Silicon/);
  assert.match(readme, /内部数据目录继续使用 `apple-store-inventory-monitor`/);
  assert.match(readme, /https:\/\/github\.com\/thomasDJMax\/inventory-checker\.git/);
});

test("构建模板随源码保留且 Actions 未启用，文档明确本机发布范围", async () => {
  const ci = await readText("build-templates/ci.yml");
  const readme = await readText("README.md");
  const workflows = await readdir(new URL(".github/workflows/", root)).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  assert.deepEqual(workflows.filter(name => /\.ya?ml$/i.test(name)), []);
  assert.match(ci, /run: pnpm test/);
  assert.match(ci, /cargo test -p guotan-radar/);
  assert.match(readme, /没有 `workflow` scope/);
  assert.match(readme, /未启用 GitHub Actions/);
  assert.match(readme, /`1\.1\.0` 是本机验证后发布的版本/);
  assert.doesNotMatch(readme, /actions\/workflows\/.*badge/);
});
