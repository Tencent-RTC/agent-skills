# AI スピーキングコーチ スキル

> TRTC Conversational AI を活用した AI 英会話スピーキングコーチ — ノーコード、音声ファースト。2つのパスがあり、すべて Agent が自動実行します。あなたは話すだけ。

## デモ

https://github.com/user-attachments/assets/9e586749-d810-4c5a-bb27-356a3b74d486

## Tencent RTC について

[Tencent RTC](https://trtc.io)（リアルタイムコミュニケーション）は、世界中の数千社にリアルタイム音声・ビデオ・会話型 AI 機能を提供しています。200以上の国と地域をカバーするグローバルエッジネットワークにより、300ms未満の超低遅延を実現します。

**Conversational AI** 機能により、聞いて理解し自然に応答する音声エージェントを構築できます。語学学習、スピーキング練習、インタラクティブなチュータリングに最適です。

## これは何？

「TRTC で AI 英会話コーチを作る」をプラグアンドプレイのスキルにパッケージ化しました：

```
あなた（IDEのAIチャットウィンドウで）：
  "Build me an AI English speaking coach"

AI（すべて自動実行）：
  1. 実行環境をチェック
  2. クイック体験 か システム統合 かを選択
  3. 3つのキー設定を順に案内
  4. 依存関係をインストールし、コーチ機能を組み立て
  5. サービスを起動し、ブラウザURLを表示

ターミナルもスクリプトも一切不要です。
```

## 2つの始め方

| モード | 対象 | 得られるもの | 必要なもの |
|--------|------|-------------|-----------|
| **クイック体験** | まず効果を見たい方 | 3画面SPA（シナリオ練習 + 文章添削 + 返答提案 + 4次元レポート） | 3つのキー |
| **システム統合** | 既存アプリにバックエンド機能を追加したい方 | バックエンドAPI + 統合サンプル（UIなし） | 3つのキー + コーチ機能の選択 |

## 3つのキーとは？

コーチを動かすには、3つのクラウドサービス認証情報が必要です：

| キー | 目的 | 入手先 |
|------|------|--------|
| 1: TRTCアプリ認証情報 | コーチの音声チャネル | https://console.trtc.io/?quickclaim=engine_trial |
| 2: Tencent Cloud APIキー | バックエンド権限（TRTCと同一ログイン） | https://console.tencentcloud.com/cam/capi |
| 3: LLM APIキー | コーチの「頭脳」— 理解・添削・レポート生成 | AIプロバイダー（OpenAI、DeepSeekなど） |

## コーチの機能

| 機能 | 説明 | クイック体験 | 統合 |
|------|------|:---:|:---:|
| シナリオロールプレイ | シーン × 難易度 × スタイル → 動的ロールプレイ | ✅ デフォルト | 🔘 オプション |
| クイックコレクト | 一文ごとのスピーキングスタイル添削 | ✅ デフォルト | 🔘 オプション |
| 返答サジェスト | 会話継続のヒント | ✅ デフォルト | 🔘 オプション |
| 能力レポート | 4次元分析レポート（日英バイリンガル） | ✅ デフォルト | 🔘 オプション |
| カスタム教材KB | 独自の教材を接続（Dify/Coze） | ❌ | 🔘 オプション |

> 💡 評価系機能（ロールプレイ/添削/サジェスト/レポート）は単一の `Evaluator` Port を共有 — LLMやプロンプトを変更するだけで「頭脳の交換」が可能、コアコード変更不要。

## インストール

`npx` でインストール — どのIDEでも動作、プラグインマーケットプレイス不要。プロジェクトディレクトリ内で実行：

```bash
# デフォルト — インストール済みIDEを自動検出してインストール
npx -y @tencent-rtc/trtc-agent-skills@latest add

# 全ての対応IDEに強制インストール
npx -y @tencent-rtc/trtc-agent-skills@latest add --ide all

# 特定のIDEのみにインストール
npx -y @tencent-rtc/trtc-agent-skills@latest add --ide cursor

# 以前のインストールを削除してから再インストール
npx -y @tencent-rtc/trtc-agent-skills@latest add --clean
```

## トリガーキーワード

- "oral coach" / "speaking coach" / "english tutor bot"
- "AI oral coach" / "AI speaking practice"
- "スピーキング練習" / "英会話コーチ"

## ディレクトリ構造

```
ai-oral-coach/
├── SKILL.md                 # Agent 実行SOP
├── README.md                # 英語（メイン）
├── README.zh-CN.md          # 中国語
├── README.ja.md             # 本ファイル
├── triggers.yaml            # トリガーワード登録
├── start.sh                 # 起動スクリプト（venv + 依存 + FastAPI:8000）
├── capabilities/            # アトミック機能（リポジトリ同梱、自動マウント）
│   ├── conversation-core/   # スケルトン：FastAPI + 音声パイプライン
│   ├── scenario-roleplay/   # シナリオロールプレイ
│   ├── quick-correct/       # 一文添削
│   ├── reply-suggestion/    # 返答サジェスト
│   ├── ability-report/      # 4次元レポート
│   └── custom-learning-kb/  # 外部KBアダプター（Dify/Coze）
├── auto_adapters/            # Path B：API統合コードテンプレート（UIなし）
│   ├── manifest.yaml
│   ├── web/                 # JS/TS oral-coach-client.js
│   ├── python/              # Python coach_client.py
│   └── integration_templates/  # L3フォールバック + KB仕様
├── scenarios/speaking-coach/
│   ├── recipe.yaml          # Path A デフォルト構成
│   └── ui/                  # 3画面SPA
├── scripts/
│   ├── verify-credentials.py
│   └── add-capability.py
└── references/
    ├── evaluator-port.md
    └── design-specs.md
```

## よくある質問

| 問題 | 解決策 |
|------|--------|
| キー検証失敗 | キー設定手順に戻り、各キー値を再確認 |
| ポート8000が使用中 | 別ポートを指定（`--port 8080`）またはポート8000を解放 |
| Pythonバージョンが低すぎる | python.org から Python 3.9+ をインストール |
| 起動後ブラウザが白画面 | 強制リフレッシュ: `Cmd+Shift+R`（Mac）/ `Ctrl+Shift+R`（Windows） |
| 自社教材を接続したい | 「システム統合」を選択し、custom-learning-kb を有効化 |

## お問い合わせ

テクニカルサポートやエンタープライズプランについては、[trtc.io/contact](https://trtc.io/contact) よりお問い合わせください。
