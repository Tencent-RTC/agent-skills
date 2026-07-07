# Port 定义（共享）

本文件**一次性**定义口语陪练所有能力用到的抽象接口（Port）。
各能力的 `manifest.yaml` 只通过 `business_contract.port_class` 引用本文件，不重复描述。

---

## 1. `Evaluator` Port —— 评估类能力共用

> 用于 `scenario-roleplay` / `quick-correct` / `reply-suggestion` / `ability-report`。
> 本质：**喂文本 → LLM → 解析 JSON**。自包含，不连外部业务系统。
> 「适配」= 换评估器（LLM provider）/ 换 Prompt（评估标准）—— 俗称「换大脑」。

```python
# src/ports/evaluator.py
from abc import ABC, abstractmethod
from typing import Any

class Evaluator(ABC):
    """统一评估接口：输入结构化上下文，输出结构化 JSON。"""

    @abstractmethod
    def evaluate(self, task: str, payload: dict, *, language: str = "en") -> dict:
        """
        task    : 评估任务类型 ("correct" | "suggest" | "report" | "scene")
        payload : 任务输入（已由调用方做长度截断 + json 安全序列化）
        return  : 任务对应的 JSON（schema 见各能力 manifest.endpoints）
        """
        ...
```

### 内置实现（default adapter）

```python
# src/adapters/default.py
class LLMEvaluator(Evaluator):
    """默认：调用 ReportLLM（OpenAI 兼容 /chat/completions，response_format=json_object）。
    prompt 模板在 src/prompts/<task>.txt，可被用户覆盖。
    内置 1 次重试 + 兜底骨架；中文输出做语言纯度校验。"""
```

### 用户替换（Path B：换大脑）

| 想换什么 | 怎么换 |
|----------|--------|
| 换 LLM provider | 改 `.env`：`REPORT_LLM_API_URL` / `MODEL` / `API_KEY` |
| 换评估标准 / schema | 覆盖 `src/prompts/<task>.txt`，或实现 `src/adapters/user_custom.py` 并置 `*_ADAPTER=user_custom` |
| 完全自研评估服务 | 实现 `user_custom.py` 的 `evaluate()`，转调自家服务 |

**关键**：换大脑**不需要改 conversation-core 一行代码**，能力对核心始终透明。

---

## 2. `KBClient` Port —— 仅 `custom-learning-kb` 用

> 唯一走经典「连外部系统」的 Port。outbound 去拉用户自有教研知识库。

```python
# src/ports/kb_client.py
class KBClient(ABC):
    @abstractmethod
    def retrieve(self, query: str, *, top_k: int = 3) -> list[dict]:
        """检索教研片段，返回 [{text, source, score}, ...]"""
        ...
```

### 内置实现

| adapter | 说明 | env |
|---------|------|-----|
| `dify` (默认) | 调 Dify 数据集检索 API | `KB_DIFY_API_URL` / `KB_DIFY_API_KEY` |
| `coze` | 调 Coze 知识库 API | `KB_COZE_API_URL` / `KB_COZE_API_KEY` |
| `user_custom` | 用户自研 REST | `KB_REST_BASE_URL` / `KB_REST_TOKEN` |

> 安全：outbound adapter 对非 localhost 强制 HTTPS；禁止访问内网地址（见 SKILL.md 安全红线）。
