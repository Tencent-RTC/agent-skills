# UI 设计标准 (Design Specs)

本文件固化于 `recipe.yaml → design` block 和 SKILL.md §*，Path A 产物必须遵守。

## 全局硬约束

| 规则 | 要求 |
|------|------|
| **禁用 Emoji** | 渲染层完全禁止 emoji，用 SVG 图标 + 文字替代 |
| **颜色系统** | 全部走 CSS 变量，**禁止硬编码 hex**；变量文件：`tokens.css` |
| **字体** | `SF Pro / Inter / Helvetica Neue`，中文 fallback 系统默认；正文 ≥ 14px，标题 ≥ 20px |
| **间距** | 统一 4px 基础网格（`--space-xs:4px` / `--space-sm:8px` / `--space-md:16px` / `--space-lg:24px` / `--space-xl:32px`）；模块间距用 `--space-lg` 起步 |
| **圆角** | 卡片 `--radius-md:12px`；按钮 `--radius-sm:8px`；气泡 `--radius-md` |
| **玻璃拟态** | `backdrop-filter: blur(20px)` + `@supports` 降级 |
| **图标** | Lucide / Phosphor 风格单线 SVG，尺寸 16/20/24/32 |

## 字体级联

```
body { font-family: 'Inter', 'SF Pro Display', 'Helvetica Neue', -apple-system, BlinkMacSystemFont, sans-serif; }
.zh body { font-family: 'Inter', 'SF Pro Display', 'PingFang SC', 'Microsoft YaHei', sans-serif; }
```

## 三屏状态机

| 屏 | URL | 颜色梯度暗示 |
|----|-----|-------------|
| Setup | `/` | 暖色/中性（选择态） |
| Practice | `/practice` | 活泼（对话态） |
| Report | `/report` | 沉静/成就（总结态） |

## 无障碍

- 按钮最小触控区域 44×44px（移动端）
- 对比度 ≥ 4.5:1（正文）
- `:focus-visible` 轮廓可见
