# TRTC AI カスタマーサービス Skill

[English](README.md) | [中文](README.zh-CN.md) | [日本語](README.ja.md)

> ノーコードの AI カスタマーサービス構築ツール。チャットウィンドウで一言話しかけるだけで、AI がステップバイステップであなたのカスタマーサービスシステムを立ち上げます — ターミナルもスクリプトもプログラミングも不要です。

## デモ

https://github.com/user-attachments/assets/a2e076ce-38c9-4bd8-a40a-e4e09d4ce360

## Tencent RTC について

[Tencent RTC](https://trtc.io)（リアルタイムコミュニケーション）は、世界中の数千の企業にリアルタイムの音声、ビデオ、会話型 AI 体験を提供しています。200以上の国と地域をカバーするグローバルエッジネットワークにより、TRTCは大規模で300ms未満の超低遅延を実現します。

**Conversational AI** 機能により、開発者は聞き取り、理解し、自然に応答できる音声エージェントを構築できます——カスタマーサービス、販売支援、インテリジェントなセルフサービスシナリオに最適です。

## これは何？

「TRTC Conversational AI による AI カスタマーサービスエージェント」をプラグアンドプレイの Skill としてパッケージ化しました：

```
あなた（IDE の AI チャットウィンドウで）：
  "Build me an AI customer service agent with TRTC"

AI（すべて自動実行）：
  1. ランタイム環境をチェック
  2. セットアップモードを選択（クイック体験 / システムに統合）
  3. 3 つのキー設定をガイド（クラウドサービス認証情報）
  4. 依存関係をインストールし、カスタマーサービス機能を組み立て
  5. サービスを起動し、ブラウザ URL を表示して動作確認

あなたは一度もターミナルを開いたり、手動でスクリプトを実行したりする必要はありません。
```

## 2 つの始め方

> この Skill のコア機能は **TRTC Conversational AI（音声エージェント）** です。

| モード | 対象者 | 得られるもの | 必要な作業 |
|------|-------------|-------------|---------------------|
| **クイック体験** | まず見た目を確認したい初心者 | 完全な音声エージェント Web UI + チケット管理ダッシュボード | 3 つのキーを設定 |
| **システムに統合** | 既存の Web サイトやアプリに AI エージェントの「頭脳」を組み込みたいユーザー | バックエンド API エンドポイント + インターフェース仕様 + サンプルコード（UI は生成されません） | 3 つのキーを設定 + 機能と対話モードを選択 |

**どちらを選んでも、AI がすべてのステップをガイドします** — プログラミング経験は一切不要です。

## 唯一のエントリーポイント

[`SKILL.md`](./SKILL.md) — あなたのコーディングエージェント（CodeBuddy / Cursor / Claude Code）によって読み取られ実行されます。

> **任意の場所にインストール可能**：この Skill はプロジェクトのサブディレクトリ、`.agents/skills/`、`.codebuddy/skills/`、その他どこにでも配置できます —
> ワークスペースのルートにある**必要はありません**。スクリプトは自己位置特定が可能で、エージェントは絶対パスを使用するだけです。

### インストール

#### Codex CLI

**ユーザーレベル**（推奨 — すべてのプロジェクトで利用可能）：
```bash
/skills install https://github.com/Tencent-RTC/agent-skills
```

**プロジェクトレベル**（現在のプロジェクトのみ利用可能）：
```bash
# Skill は ./.codex/skills/ にインストールされます（Finder で隠しフォルダを表示するには Cmd+Shift+.）
/skills install --project https://github.com/Tencent-RTC/agent-skills
```

#### Claude Code CLI

**ユーザーレベル**（推奨 — すべてのプロジェクトで利用可能）：
```bash
mkdir -p ~/.claude/skills
git clone https://github.com/Tencent-RTC/agent-skills.git ~/.claude/skills/agent-skills
```

**プロジェクトレベル**（現在のプロジェクトのみ利用可能）：
```bash
mkdir -p ./.claude/skills
git clone https://github.com/Tencent-RTC/agent-skills.git ./.claude/skills/agent-skills
```

#### その他のエージェント（CodeBuddy / Cursor など）

任意の場所にクローンし、エージェントに `SKILL.md` を指定します：
```bash
git clone https://github.com/Tencent-RTC/agent-skills.git
# そしてエージェントにこう伝えます：
# "Load the Skill from /path/to/agent-skills/skills/trtc-ai-service/SKILL.md"
```

> **インストール後、CLI セッションを再起動**して、Skill が正しく登録・ロードされることを確認してください。

### トリガーキーワード

- "AI customer service" / "build customer service" / "customer service bot"
- "TRTC + customer service" / "voice agent + customer service"
- "Build me an AI customer service agent with TRTC"

## 3 つのキーとは？

カスタマーサービスエージェントを動作させるには、3 つのクラウドサービス認証情報が必要です。ご安心ください — それぞれの Web サイトからコピー＆ペーストするだけの 3 つの文字列です。

> **TRTC と Tencent Cloud の関係は？** TRTC Conversational AI サービスは Tencent Cloud 上で動作します。簡単に言うと：TRTC は顧客と AI エージェント間の音声通話を処理し、Tencent Cloud はバックエンド（権限、サービス設定、課金など）を処理します。両者は同じログインを共有 — 一度登録すれば両方使えます。

| キー | 目的 | 入手先 |
|-----|---------|-----------------|
| キー 1：TRTC アプリケーション認証情報 | エージェントが通話や音声チャットを実行可能にします | https://console.trtc.io/?quickclaim=engine_trial（登録して **RTC Engine** アプリを作成 — Conversational AI 対応） |
| キー 2：Tencent Cloud API キー | Tencent Cloud 音声・通話サービスを使用する権限を証明します（TRTC アカウントとログインが同期されます） | https://console.tencentcloud.com/cam/capi |
| キー 3：LLM API キー | エージェントが「考え」— 問い合わせを理解して応答できるようにします | 登録している AI サービス Web サイト（OpenAI、DeepSeek など） |

> AI が各キーの取得方法をステップバイステップで詳しく説明します。キー情報はこの設定セッションでのみ使用され — システムが記録したり漏洩したりすることはありません。

## エージェントの機能

| 機能 | 説明 | クイック体験 | 統合モード |
|------------|-------------|:---:|:---:|
| 会話 | 音声 + テキスト双方向コミュニケーション | ✅ 自動組立 | ✅ デフォルトで含む |
| ナレッジベース | ドキュメントをアップロード、エージェントが自動検索して FAQ に回答 | ✅ シミュレーションデモ | 🔘 オプション |
| 有人転送 | 複雑な問題を自動的に人間のオペレーターにエスカレーション | ✅ シミュレーションデモ | 🔘 オプション |
| ツール呼び出し | エージェントが自律的にシステムのデータをクエリ可能 | ❌ 非対応 | 🔘 オプション |
| セッションサマリー | 各会話後に自動でサマリーを生成 | ✅ シミュレーションデモ | 🔘 オプション |

> 「シミュレーションデモ」とは：UI とワークフローは完全ですが、実際のビジネスシステムに接続せずデモデータを使用しています。本番連携するには「システムに統合」を選択してください。

## 通信モード（統合モードでオプション）

| モード | 説明 | 最適な用途 |
|------|-------------|---------|
| テキストのみ IM | エージェントがテキストチャットで返信 | Web チャットウィジェット、アプリ内メッセージング |
| テキスト + TTS | エージェントがタイピング返信 + 音声読み上げ | スマートスピーカー、音声アシスタント |
| オムニモーダル | テキスト、音声、動画すべて対応 | 高度なカスタマーサービスシナリオ |
| 音声のみ通話 | エージェントが電話のみでコミュニケーション | コールセンター、ホットライン |

## 応用：TRTC Conversational AI のカスタマイズ

AI エージェントの音声動作を微調整したり、基盤モデルを変更したい場合は、TRTC Conversational AI 公式ドキュメントを参照してください：

### 音声パラメータの調整（速度 / ピッチ / 音色）

STT（音声認識）と TTS（音声合成）はどちらも Tencent 自社エンジンで動作します。以下のドキュメントで音声パラメータを調整できます：

| 段階 | ドキュメント |
|-------|--------------|
| STT（音声認識） | [STT 設定パラメータ](https://trtc.io/document/69592?product=conversationalai) |
| TTS（音声合成） | [TTS 設定パラメータ](https://trtc.io/document/68340?product=conversationalai) |

### STT / LLM / TTS モデルの切り替え

基盤となる STT、LLM、TTS モデルを変更するには、各パイプライン段階のモデル概要を確認し、統合ガイドに従ってください：

| 段階 | ドキュメント |
|-------|--------------|
| STT（音声認識） | [STT モデル概要](https://trtc.io/document/69592?product=conversationalai) |
| LLM（大規模言語モデル） | [LLM モデル概要](https://trtc.io/document/68338?product=conversationalai) |
| TTS（音声合成） | [TTS モデル概要](https://trtc.io/document/68340?product=conversationalai) |

### 完全なドキュメント

その他の設定が必要な場合は、Conversational AI 概要ページから該当する情報を探してください：

- [TRTC Conversational AI 概要](https://trtc.io/document/conversational-ai-overview?product=conversationalai)

## ディレクトリ構成

```
ai-service-skill/
├── SKILL.md                       # ★ 唯一のエントリーポイント（コーディングエージェントがトリガー）
├── start.sh                       # 起動スクリプト（依存関係の自動インストール + サービス起動）
│
├── scripts/                       # AI が呼び出すツールスクリプト
│   ├── verify-credentials.py      # 3 キー検証
│   ├── setup-credentials.py       # 対話型開発者セットアップ
│   ├── add-capability.py          # 機能組み立て
│   ├── contract-adapt.py          # インターフェースコントラクト適応
│   └── lib/                       # 共有モジュール
│
├── capabilities/
│   ├── conversation-core/         # 汎用音声エージェントスケルトン
│   ├── knowledge-base/            # FAQ ナレッジベース検索
│   ├── tool-calling/              # ツール呼び出し
│   ├── human-handoff/             # 有人転送 + チケット管理
│   ├── session-summary/           # セッションサマリー
│   └── digital-human/             # デジタルヒューマン（プレースホルダー）
│
├── scenarios/
│   ├── customer-service/          # パス A：デモ UI
│   └── custom-builder/            # パス B：機能選択ウィザード
│
├── auto_adapters/                 # 技術スタックアダプター
└── tests/                         # テストスイート
```

## FAQ

| 問題 | 解決策 |
|-------|----------|
| キー検証に失敗する | キー設定ステップに戻り、各キーの値を再確認してください |
| ポート 3000 が使用中 | 別のポートを使用する（例：`--port 8080`）か、そのポートを占有しているプログラムを停止してください |
| Python バージョンが低すぎる | python.org から Python 3.9 以上をダウンロードしてインストール |
| 起動後ブラウザが空白ページを表示 | ハードリフレッシュ：`Cmd+Shift+R`（Mac）または `Ctrl+Shift+R`（Windows） |
| 実際のビジネスシステムに接続したい | ワークフローを再実行し「システムに統合」を選択 |

---

> **最後に**：この Skill は、プログラミング経験がまったくない人でも AI カスタマーサービスエージェントを立ち上げられるように設計されています。途中で問題が発生した場合は、チャットウィンドウで AI に伝えるだけで解決をお手伝いします。

## お問い合わせ

テクニカルサポートやエンタープライズ価格についてのお問い合わせは、[trtc.io/contact](https://trtc.io/contact) からご連絡先をご送信ください。担当チームより折り返しご連絡いたします。
