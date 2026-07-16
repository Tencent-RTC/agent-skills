# TRTC AI リアルタイム通訳 Skill

[English](README.md) | [中文](README.zh-CN.md) | [日本語](README.ja.md)

> TRTC Conversational AI を使用した AI リアルタイム会議通訳を構築——ノーコード、音声ファースト。2 つのパス、すべてエージェント駆動：あなたは話すだけで、エージェントが残りを処理します。

## Tencent RTC について

[Tencent RTC](https://trtc.io/?utm_source=github&utm_medium=skill&utm_campaign=Twitter%20AI%20%E4%B8%93%E9%A1%B9%20-%20AI%20Oral%20Coach&_channel_track_key=HIzH2eVJ)（リアルタイムコミュニケーション）は、世界中の数千の企業にリアルタイムの音声、ビデオ、会話型 AI 体験を提供しています。200 以上の国と地域をカバーするグローバルエッジネットワークにより、TRTC は大規模で 300ms 未満の超低遅延を実現します。

**Conversational AI** 機能により、開発者は聞き取り、理解し、自然に応答できる音声エージェントを構築できます——リアルタイム通訳、多言語会議、クロスランゲージコミュニケーションに最適です。

## これは何？

「TRTC Conversational AI による AI リアルタイム会議通訳」をプラグアンドプレイの Skill としてパッケージ化しました：

```
あなた（IDE の AI チャットウィンドウで）：
  "Help me build a real-time AI interpreter with TRTC"

AI（すべて自動実行）：
  1. ランタイム環境をチェック
  2. セットアップモードを選択（クイック体験 / システムに統合）
  3. 3 つのキー設定をガイド（クラウドサービス認証情報）
  4. 依存関係をインストールし、通訳機能を組み立て
  5. サービスを起動し、ブラウザ URL を表示して動作確認

あなたは一度もターミナルを開いたり、手動でスクリプトを実行したりする必要はありません。
```

## 2 つの始め方

> この Skill のコア機能は **TRTC Conversational AI（音声ファースト）リアルタイム通訳** です。

| モード | 対象者 | 得られるもの | 必要な作業 |
|------|-------------|-------------|---------------------|
| **クイック体験** | まず動作を見たい初心者 | 完全な Vue3 会議室 + AI 通訳（誰が話しても翻訳 + バイリンガル字幕 + 文字起こしパネル） | 3 つのキーを設定 |
| **システムに統合** | 既存の会議室やアプリに通訳バックエンドを組み込みたいユーザー | バックエンド API エンドポイント + 統合サンプル（UI は生成されません） | 3 つのキーを設定 |

> **どちらを選んでも、AI がすべてのステップをガイドします** — プログラミング経験は一切不要です。

## 唯一のエントリーポイント

[`SKILL.md`](./SKILL.md) — あなたのコーディングエージェント（CodeBuddy / Cursor / Claude Code）によって読み取られ実行されます。

> **任意の場所にインストール可能**：この Skill はプロジェクトのサブディレクトリ、`.agents/skills/`、`.codebuddy/skills/`、その他どこにでも配置できます — ワークスペースのルートにある**必要はありません**。スクリプトは自己位置特定が可能で、エージェントは絶対パスを使用するだけです。

## インストール

`npx` でインストール — 任意の IDE で動作し、プラグインマーケットプレイスは不要です。プロジェクトディレクトリ内で実行してください：

```bash
# デフォルト — インストール済みの IDE を自動検出し、検出された各 IDE にインストール
npx -y @tencent-rtc/trtc-agent-skills@latest add

# すべてのサポート対象 IDE に強制インストール
npx -y @tencent-rtc/trtc-agent-skills@latest add --ide all

# 特定の IDE のみにインストール
npx -y @tencent-rtc/trtc-agent-skills@latest add --ide cursor

# 再インストール前に以前のインストールをクリーンアップ
npx -y @tencent-rtc/trtc-agent-skills@latest add --clean
```

## トリガーキーワード

- "实时翻译" / "AI 翻译" / "同声传译" / "会议翻译" / "TRTC 翻译"
- "real-time interpreter" / "real-time translation" / "AI interpreter"
- "TRTC Conversational AI" / "会議通訳" / "多言語会議"
- "帮我用 TRTC 做一个 AI 实时会议翻译"
- "Help me build a real-time AI interpreter with TRTC"
- "把 AI 实时翻译能力接入我现有的直播间"

## 3 つのキーとは？

通訳エージェントを動作させるには、3 つのクラウドサービス認証情報が必要です。ご安心ください——それぞれの Web サイトからコピー＆ペーストするだけの 3 つの文字列です。

> **TRTC と Tencent Cloud の関係は？** TRTC の会話型 AI サービスは Tencent Cloud 上で動作します。簡単に言うと：TRTC は参加者と AI エージェント間の音声通話を処理し、Tencent Cloud はバックエンド（権限、サービス設定、課金など）を処理します。両者は同じログインを共有 — 一度登録すれば両方使えます。

| キー | 目的 | 入手先 |
|-----|---------|-----------------|
| キー 1：TRTC アプリケーション認証情報 | 通訳エージェントが音声通話を実行可能にします | https://console.trtc.io/?quickclaim=engine_trial&utm_source=github&utm_medium=skill&utm_campaign=Twitter%20AI%20%E4%B8%93%E9%A1%B9%20-%20AI%20Oral%20Coach&_channel_track_key=3WFHfiqw（登録して **RTC Engine** アプリを作成 — Conversational AI 対応） |
| キー 2：Tencent Cloud API キー | Tencent Cloud 音声・通話サービスを使用する権限を証明します（TRTC アカウントとログインが同期されます） | https://console.tencentcloud.com/cam/capi?utm_source=github&utm_medium=skill&utm_campaign=Twitter%20AI%20%E4%B8%93%E9%A1%B9%20-%20AI%20Oral%20Coach&_channel_track_key=v0K1Q0DSE |
| キー 3：LLM API キー | 通訳エージェントの「頭脳」— 音声をリアルタイムで理解し翻訳します | 登録している AI サービスサイト（OpenAI、DeepSeek など） |

> AI が各キーの取得方法をステップバイステップで詳しく説明します。キー情報はこの設定セッションでのみ使用され — システムが記録したり漏洩したりすることはありません。

## 通訳の機能

| 機能 | 説明 | クイック体験 | 統合モード |
|------------|-------------|:---:|:---:|
| 会話基盤 | 音声パイプライン + UserSig 発行 + 認証情報管理（基盤、必須） | ✅ 自動組立 | ✅ デフォルトで含む |
| リアルタイム翻訳 | 言語ペア駆動のリアルタイム翻訳（STT → LLM 翻訳 → TTS 音声 + 字幕） | ✅ デフォルト | 🔘 オプション |
| 会議ファンアウト | 参加者ごとに翻訳を展開（部屋内の全員に翻訳） | ✅ デフォルト | 🔘 オプション |
| バイリンガル字幕 | リアルタイムのバイリンガル字幕表示（原文 + 翻訳を並列表示） | ✅ 内蔵 | ✅ 内蔵 |
| 文字起こしパネル | セッションのバイリンガル文字起こし履歴 | ✅ 内蔵 | ✅ 内蔵 |
| ホスト制御 | 会議室ホストのみ AI 通訳のオン/オフが可能（デモ設計） | ✅ 内蔵 | 🔘 独自認証 |

> 💡 `realtime-translation` と `meeting-ops` 機能は同じ `conversation-core` 基盤を共有 — 言語ペア設定を変更するだけで異なる翻訳方向をサポート可能です。

## 対応言語ペア

| モード ID | ソース言語 | ターゲット言語 | STT 言語 | TTS 音声 | 方向 |
|---------|----------------|-----------------|--------------|-----------|-----------|
| `zh-en` | 中国語 | 英語 | `zh` | `v-female-p9Xy7Q1L` | 双方向（中国語 ↔ 英語） |
| `zh-yue` | 中国語 | 広東語 | `zh` | `v-female-k3P8sL0Q` | 双方向（北京語 ↔ 広東語） |
| `en-yue` | 英語 | 広東語 | `en` | `v-female-k3P8sL0Q` | 双方向（英語 ↔ 広東語） |

> 言語ペアは拡張可能 — `modes.py` にエントリを追加するだけで、新しい翻訳方向をサポートできます。すべての TTS 音声は TRTC 会話型 AI 内蔵音声（`flow_01_turbo`）で、完全に TRTC エコシステム内に閉じています。
>
> **より多くの言語が必要ですか？** TRTC Conversational AI は、上記のデフォルトを超える幅広い STT 言語と TTS 音声をサポートしています：
> - [STT 対応言語](https://trtc.io/document/69592?product=conversationalai) と [TTS 音声リスト](https://trtc.io/document/68340?product=conversationalai) を確認し、対象言語をカバーする内蔵モデルに切り替え
> - 設定ドキュメントを通じて TRTC エコシステム内のサードパーティ STT/TTS モデルに切り替え
> - カスタム言語ペアの要件について [テクニカルチームにお問い合わせ](https://trtc.io/contact) ください — 最適なモデル組み合わせをご提案します

## 高度な設定：TRTC Conversational AI のカスタマイズ

AI 通訳の音声動作を微調整したり、基盤モデルを変更したい場合は、TRTC Conversational AI の公式ドキュメントを参照してください：

### 音声パラメータの調整（速度 / ピッチ / 音色）

STT（音声認識）と TTS（音声合成）はどちらも Tencent の自社エンジンで動作します。以下のドキュメントで音声パラメータを調整できます：

| 段階 | ドキュメント |
|------|--------------|
| STT（音声認識） | [STT 設定パラメータ](https://trtc.io/document/69592?product=conversationalai) |
| TTS（音声合成） | [TTS 設定パラメータ](https://trtc.io/document/68340?product=conversationalai) |

### STT / LLM / TTS モデルの切り替え

基盤となる STT、LLM、TTS モデルを変更するには、各パイプライン段階のモデル概要を確認し、統合ガイドに従ってください：

| 段階 | ドキュメント |
|-------|--------------|
| STT（音声認識） | [STT モデル概要](https://trtc.io/document/69592?product=conversationalai) |
| LLM（大規模言語モデル） | [LLM モデル概要](https://trtc.io/document/68338?product=conversationalai) |
| TTS（音声合成） | [TTS モデル概要](https://trtc.io/document/68340?product=conversationalai) |

### STT 対応言語

`engine_model_type` が `bigmodel` に設定されている場合、オーディオ言語を指定できます。対応言語：`zh`（中国語）、`en`（英語）、`yue`（広東語）、`ar`（アラビア語）、`de`（ドイツ語）、`fr`（フランス語）、`es`（スペイン語）、`pt`（ポルトガル語）、`id`（インドネシア語）、`it`（イタリア語）、`ko`（韓国語）、`ru`（ロシア語）、`th`（タイ語）、`vi`（ベトナム語）、`ja`（日本語）、`tr`（トルコ語）、`hi`（ヒンディー語）、`ms`（マレー語）、`nl`（オランダ語）、`sv`（スウェーデン語）、`da`（デンマーク語）、`fi`（フィンランド語）、`pl`（ポーランド語）、`cs`（チェコ語）、`fil`（フィリピン語）、`fa`（ペルシャ語）、`el`（ギリシャ語）、`ro`（ルーマニア語）、`hu`（ハンガリー語）、`mk`（マケドニア語）。

### 完全なドキュメント

その他の設定要件については、[Conversational AI 概要](https://trtc.io/document/71130?product=conversationalai) ページから関連ドキュメントをお探しください。

## ディレクトリ構造

```
trtc-ai-realtime-interpreter/
├── SKILL.md                    # Agent 実行 SOP（唯一のエントリーポイント）
├── README.md                   # English（メイン）
├── README.zh-CN.md             # Chinese
├── README.ja.md                # Japanese
├── start.sh                    # 起動スクリプト（venv + deps + FastAPI:8020）
├── capabilities/               # アトミック機能（リポジトリに同梱、自動マウント）
│   ├── conversation-core/      # 基盤：FastAPI + 音声パイプライン + 認証情報発行
│   ├── realtime-translation/   # 言語ペア翻訳ロジック（STT/LLM/TTS）
│   └── meeting-ops/            # マルチターゲットファンアウト編成（認証なし）
├── scenarios/
│   └── meeting-interpreter/    # Path A デフォルト：Vue3 会議室 + AI 通訳オーバーレイ
│       ├── recipe.yaml         # 組立レシピ
│       ├── backend/            # シナリオ固有バックエンド（ホスト認証、HTTP 配信）
│       └── ui/                 # Vue3 フロントエンド（会議室、ツールバー、文字起こし）
├── auto_adapters/              # Path B：ヘッドレス API 統合テンプレート
│   ├── manifest.yaml
│   ├── python/
│   │   └── fastapi_reverse_proxy.py.tpl
│   └── integration_templates/
│       ├── generic-rest-api.md
│       └── room-owner-authz-note.md
└── scripts/                    # 認証情報検証 / 機能追加 / インストール後パッチ / デプロイ
    ├── verify-credentials.py
    ├── add-capability.py
    ├── post-install-patch.py
    ├── deploy-demo.sh
    └── lib/
```

## よくある質問

| 問題 | 解決方法 |
|-------|----------|
| キー検証に失敗 | 各キー値を再確認 — サーバー側の SDKSecretKey（STSecretKey ではない）を使用しているか確認 |
| TRTC_REGION が一致しない | TRTC アプリのリージョンを確認：国際サイトのアプリは `intl` を使用 |
| ポート 8020 が使用中 | 別のポートを使用するか、ポートを解放 |
| Python バージョンが古い | [python.org](https://www.python.org/downloads/) から Python 3.9+ をインストール |
| Node.js / npm がない | [nodejs.org](https://nodejs.org/) から Node.js LTS をインストール |
| ブラウザが空白ページを表示 | ハードリフレッシュ：Mac `Cmd+Shift+R` / Windows `Ctrl+Shift+R` |
| "No such file" エラー | エージェントが相対パスを使用した可能性 — 正しい SKILL_ROOT から再実行 |
| 複数人が同時に話すと TTS 音声が重なる | v1 の既知の制限 |
| 既存の会議システムに接続したい | 再実行して Path B（システムに統合）を選択 |

## お問い合わせ

テクニカルサポートや企業向け料金プランについてのお問い合わせは、[trtc.io/contact](https://trtc.io/contact) からご連絡先をお送りください。担当者より折り返しご連絡いたします。
