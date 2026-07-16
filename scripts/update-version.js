#!/usr/bin/env node

"use strict";

/**
 * 批量更新版本号脚本。
 *
 * 用法：
 *   node scripts/update-version.js <newVersion>
 *   例：node scripts/update-version.js 1.2.0
 *
 * 会统一把下列文件的版本号更新为 <newVersion>：
 *   - package.json                       (JSON 的 "version" 字段)
 *   - skills/trtc/SKILL.md               (YAML frontmatter 的 version:)
 *   - skills/trtc-chat/SKILL.md          (同上)
 *   - skills/trtc-chat/docs/SKILL.md     (同上)
 *
 * 需要新增待更新文件时，只需往下方 TARGETS 数组里加一项：
 *   { path: "相对仓库根的路径", type: "json" | "frontmatter" }
 * 无需改动其余逻辑。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

// 仓库根目录（脚本位于 <root>/scripts/ 下）。
const REPO_ROOT = path.resolve(__dirname, "..");

/**
 * 待更新的文件清单。新增路径在此追加一行即可。
 *   type: "json"        —— 更新 JSON 的顶层 version 字段
 *   type: "frontmatter" —— 更新 Markdown/YAML frontmatter 中的 version: 行
 */
const TARGETS = [
  { path: "package.json", type: "json" },
  { path: "skills/trtc/SKILL.md", type: "frontmatter" },
  { path: "skills/trtc-chat/SKILL.md", type: "frontmatter" },
  { path: "skills/trtc-chat/docs/SKILL.md", type: "frontmatter" },
  { path: "skills/trtc-push/SKILL.md", type: "frontmatter" },
];

// 宽松 semver 校验：x.y.z，允许 -prerelease / +build 后缀。
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.\-]+)*$/;

// 匹配 frontmatter 里的 version 行，保留原有引号风格（可能无引号）。
// 捕获：1=前缀(含 "version:")，2=开引号(可空)，3=旧值，4=闭引号(与开引号一致)
const FRONTMATTER_VERSION_RE = /^(version:[ \t]*)(["']?)([^"'\r\n]*)(\2)[ \t]*$/m;

function updateJson(absPath, relPath, newVersion) {
  const content = fs.readFileSync(absPath, "utf8");
  const json = JSON.parse(content);
  const currentVersion = json.version;
  json.version = newVersion;
  fs.writeFileSync(absPath, JSON.stringify(json, null, 2) + os.EOL);
  console.log(`${relPath} 版本号已从 ${currentVersion} 更新为 ${newVersion}`);
}

function updateFrontmatter(absPath, relPath, newVersion) {
  const content = fs.readFileSync(absPath, "utf8");
  const match = content.match(FRONTMATTER_VERSION_RE);
  if (!match) {
    console.error(`在文件 ${relPath} 中未找到 version 字段（frontmatter）`);
    return;
  }
  const currentVersion = match[3];
  const updated = content.replace(
    FRONTMATTER_VERSION_RE,
    `$1$2${newVersion}$4`
  );
  fs.writeFileSync(absPath, updated, "utf8");
  console.log(`${relPath} 版本号已从 ${currentVersion} 更新为 ${newVersion}`);
}

const HANDLERS = {
  json: updateJson,
  frontmatter: updateFrontmatter,
};

function start() {
  const newVersion = process.argv[2];

  if (!newVersion) {
    console.error(
      "请传入新版本号，版本号遵循 semver 规范，e.g.: 1.0.0, 1.0.1, 1.1.0"
    );
    process.exit(1);
  }

  if (!SEMVER_RE.test(newVersion)) {
    console.error(`版本号 "${newVersion}" 不符合 semver 规范（应形如 1.2.3）`);
    process.exit(1);
  }

  let failed = false;
  TARGETS.forEach(({ path: relPath, type }) => {
    const absPath = path.resolve(REPO_ROOT, relPath);
    const handler = HANDLERS[type];
    if (!handler) {
      console.error(`未知的 type "${type}"（${relPath}），已跳过`);
      failed = true;
      return;
    }
    if (!fs.existsSync(absPath)) {
      console.error(`文件不存在：${relPath}，已跳过`);
      failed = true;
      return;
    }
    try {
      handler(absPath, relPath, newVersion);
    } catch (error) {
      console.error(`更新文件 ${relPath} 失败:`, error.message);
      failed = true;
    }
  });

  if (failed) {
    process.exit(1);
  }
}

start();
