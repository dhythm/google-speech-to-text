# Google Speech-to-Text TypeScript Application

動画や音声データを文字起こしするTypeScriptアプリケーション。Google Cloud Speech-to-Text APIとVertex AI Speechをサポートしています。

## 特徴

- 🎥 動画ファイルからの音声抽出と文字起こし
- 🎵 各種音声フォーマットのサポート (MP3, WAV, FLAC, M4A など)
- 📝 長時間音声の自動分割処理
- 🌏 多言語対応
- 📄 複数の出力フォーマット (JSON, TXT, SRT, VTT, CSV)
- 🔧 柔軟な設定オプション
- 🚀 CLIとプログラマティックAPIの両方をサポート

## 必要な環境

- Node.js 16以上
- Google Cloud プロジェクト
- Google Cloud Speech-to-Text API または Vertex AI の有効化
- サービスアカウントキー（認証用）

## インストール

```bash
# リポジトリのクローン
git clone <repository-url>
cd google-speech-to-text

# 依存関係のインストール
npm install

# TypeScriptのビルド
npm run build
```

## セットアップ

### 1. Google Cloud の設定

```bash
# Google Cloud への認証
gcloud auth login --update-adc

# Google Cloud プロジェクトの作成
gcloud projects create YOUR_PROJECT_ID
# or
# Google Cloud プロジェクトの設定
gcloud config set project YOUR_PROJECT_ID

# Speech-to-Text API の有効化
gcloud services enable speech.googleapis.com

# Vertex AI API の有効化（Vertex AI使用時）
gcloud services enable aiplatform.googleapis.com

# サービスアカウントの作成
gcloud iam service-accounts create speech-to-text-sa \
  --display-name="Speech-to-Text Service Account"

# キーファイルの生成
gcloud iam service-accounts keys create ./credentials.json \
  --iam-account=speech-to-text-sa@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

### 2. 環境変数の設定

```bash
# .env.example を .env にコピー
cp .env.example .env

# .env ファイルを編集
# GOOGLE_CLOUD_PROJECT_ID=your-project-id

# 認証情報の設定（以下のいずれか）:
# 方法1: ファイルパス
# GOOGLE_APPLICATION_CREDENTIALS=./credentials.json

# 方法2: Base64エンコードされた認証情報（推奨）
# GOOGLE_APPLICATION_CREDENTIALS=$(base64 -i credentials.json)
```

#### Base64エンコードされた認証情報の使用方法

本アプリケーションは、より安全な方法として、Base64エンコードされた認証情報をサポートしています：

```bash
# 認証情報をBase64エンコード
export GOOGLE_APPLICATION_CREDENTIALS=$(base64 -i service-account-key.json)

# または.envファイルに保存
echo "GOOGLE_APPLICATION_CREDENTIALS=$(base64 -i service-account-key.json)" >> .env

# CLIで直接指定
node dist/index.js audio.mp3 --key-file "$(base64 -i key.json)"
```

## 使い方

### CLI での使用

```bash
# 基本的な使用方法
node dist/index.js audio.mp3

# 動画ファイルから文字起こし
node dist/index.js video.mp4 -o transcript.txt

# 日本語での文字起こし（SRT字幕生成）
node dist/index.js video.mp4 -l ja-JP -o subtitles.srt -f srt

# Vertex AI を使用
node dist/index.js audio.wav -p vertex-ai -l ja-JP

# 設定ファイルを使用
node dist/index.js audio.mp3 -c config.json

# ヘルプの表示
node dist/index.js --help

# 使用例の表示
node dist/index.js examples
```

### プログラマティックな使用

```typescript
import { Transcriber } from './dist/transcriber';
import { TranscriptionConfig } from './dist/types';

// トランスクライバーの初期化
const transcriber = new Transcriber('google-speech');

// 設定
const config: TranscriptionConfig = {
  provider: 'google-speech',
  languageCode: 'ja-JP',
  enableAutomaticPunctuation: true,
  enableWordTimeOffsets: true,
};

// 文字起こしの実行
const result = await transcriber.transcribeFile('audio.mp3', config);
console.log(result.transcript);
```

## 設定オプション

### 音声認識設定

- `languageCode`: 言語コード（例: ja-JP, en-US）
- `encoding`: 音声エンコーディング形式
- `sampleRateHertz`: サンプリングレート
- `enableAutomaticPunctuation`: 自動句読点挿入
- `enableWordTimeOffsets`: 単語のタイムスタンプ
- `enableWordConfidence`: 単語の信頼度スコア
- `model`: 使用するモデル（例: latest_long）
- `useEnhanced`: 拡張モデルの使用
- `speechContexts`: 認識精度向上のためのヒント

### 話者分離設定

```json
{
  "diarizationConfig": {
    "enableSpeakerDiarization": true,
    "minSpeakerCount": 2,
    "maxSpeakerCount": 6
  }
}
```

### 処理オプション

- `chunkDuration`: 音声チャンクの長さ（秒）
- `overlap`: チャンク間のオーバーラップ（秒）
- `outputFormat`: 出力フォーマット
- `verbose`: 詳細ログの出力

## 出力フォーマット

### TXT
プレーンテキストでの出力

### JSON
詳細な情報を含むJSON形式
```json
{
  "transcript": "認識されたテキスト",
  "words": [
    {
      "word": "単語",
      "startTime": 0.0,
      "endTime": 0.5,
      "confidence": 0.98
    }
  ],
  "confidence": 0.95
}
```

### SRT / VTT
字幕ファイル形式

### CSV
スプレッドシート向けのCSV形式

## トラブルシューティング

### 認証エラー
```bash
# 認証情報の確認
echo $GOOGLE_APPLICATION_CREDENTIALS

# 権限の確認
gcloud auth application-default print-access-token
```

### APIエラー
- APIが有効化されているか確認
- クォータ制限に達していないか確認
- リージョンの設定が正しいか確認

## 開発

```bash
# 開発モードで実行
npm run dev

# TypeScriptの型チェック
npm run typecheck

# リンターの実行
npm run lint

# コードフォーマット
npm run format
```

## ライセンス

ISC License