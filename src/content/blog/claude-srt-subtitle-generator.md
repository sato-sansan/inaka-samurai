---
title: "Claude APIでYouTube動画の字幕（SRT）を自動生成した話【Whisper連携で30本に一括対応】"
description: "前回のYouTubeメタデータ自動化の続き。Whisper APIで音声認識→Claude APIで文章整形・分割→SRTファイル出力まで自動化。30本の過去動画に字幕を付けたら、視聴維持率が1.4倍になった話。"
pubDate: 2026-09-03
author: sam
category: "Claude活用"
tags: ["Claude", "YouTube", "字幕", "SRT", "Whisper", "音声認識", "自動化", "水産業", "アクセシビリティ"]
readingTime: 8
---

## 「字幕があると全然違う」

[YouTubeのメタデータ自動化](/blog/claude-youtube-description-generator)を終えた翌週、業者さんから追加の相談が来た。

「チャンネル登録者が増えてきたんですが、コメント欄に『字幕が欲しい』って書いてある人がいて…」

確かに、動画で「さんまの内臓処理のコツはここです」と言っても、通勤中に音声オフで見ている人には伝わらない。

調べると、字幕（クローズドキャプション）があると：
- **視聴維持率が上がる**（音なし視聴でも最後まで見られる）
- **YouTube検索の精度が上がる**（字幕テキストもインデックスされる）
- **聴覚障害を持つ視聴者へのリーチ**が広がる

前回の記事で「次は字幕を試したい」と書いたのでそのままやった。

## 全体の仕組み

```
動画ファイル
    ↓
Whisper API（音声→テキスト）
    ↓
Claude API（テキスト整形・字幕分割）
    ↓
SRTファイル（YouTubeにアップロード）
```

OpenAIのWhisperで音声認識、ClaudeでSRT形式への整形と読みやすさの調整をやっている。

## 実装コード

### 1. Whisperで音声認識

```typescript
import OpenAI from 'openai';
import * as fs from 'fs';

const openai = new OpenAI();

interface WhisperSegment {
  start: number;
  end: number;
  text: string;
}

async function transcribeVideo(audioPath: string): Promise<WhisperSegment[]> {
  const audioFile = fs.createReadStream(audioPath);

  const transcription = await openai.audio.transcriptions.create({
    file: audioFile,
    model: 'whisper-1',
    language: 'ja',
    response_format: 'verbose_json',
    timestamp_granularities: ['segment'],
  });

  return transcription.segments?.map((seg) => ({
    start: seg.start,
    end: seg.end,
    text: seg.text.trim(),
  })) ?? [];
}
```

### 2. Claudeで字幕を読みやすく整形

Whisperの出力はそのままだと句読点が少なかったり、1セグメントが長すぎたりする。Claudeに整形を任せる。

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface Subtitle {
  index: number;
  startTime: string;
  endTime: string;
  text: string;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

async function refineSubtitles(segments: WhisperSegment[]): Promise<Subtitle[]> {
  const rawText = segments
    .map((seg, i) => `[${i}|${seg.start.toFixed(2)}|${seg.end.toFixed(2)}] ${seg.text}`)
    .join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `以下はYouTube動画（魚の調理・水産業者の紹介）の音声認識テキストです。
字幕として読みやすいように整形してください。

【入力フォーマット】
[セグメント番号|開始秒|終了秒] テキスト

【整形ルール】
- 1字幕は最大30文字（スマホ画面で折り返さない長さ）
- 長いセグメントは自然な区切り（助詞・読点）で分割する
- 時間は分割した分だけ均等に割り当てる
- 句読点を適切に追加（Whisperが省くことが多い）
- 方言・漁業用語はそのまま（「〜だべ」「水揚げ」など）
- 出力はJSONのみ

【出力フォーマット】
[
  {"start": 0.00, "end": 3.50, "text": "整形後テキスト"},
  ...
]

【入力テキスト】
${rawText}`,
      },
    ],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '[]';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('JSON解析失敗');

  const refined = JSON.parse(jsonMatch[0]) as { start: number; end: number; text: string }[];

  return refined.map((item, i) => ({
    index: i + 1,
    startTime: formatTime(item.start),
    endTime: formatTime(item.end),
    text: item.text,
  }));
}
```

### 3. SRTファイルとして書き出す

```typescript
function exportSRT(subtitles: Subtitle[]): string {
  return subtitles
    .map(
      (sub) =>
        `${sub.index}\n${sub.startTime} --> ${sub.endTime}\n${sub.text}\n`
    )
    .join('\n');
}

async function generateSubtitles(audioPath: string, outputPath: string): Promise<void> {
  console.log('音声認識中...');
  const segments = await transcribeVideo(audioPath);

  console.log(`${segments.length}セグメント取得。Claudeで整形中...`);
  const subtitles = await refineSubtitles(segments);

  const srt = exportSRT(subtitles);
  fs.writeFileSync(outputPath, srt, 'utf-8');

  console.log(`完了: ${outputPath}（${subtitles.length}字幕）`);
}

// 実行
await generateSubtitles('./videos/akisake-recipe.mp3', './subtitles/akisake-recipe.srt');
```

### 4. 実際の出力例（秋鮭動画）

```
1
00:00:00,000 --> 00:00:03,200
今日は気仙沼から届いた秋鮭を使って

2
00:00:03,200 --> 00:00:06,800
ちゃんちゃん焼きを作っていきます。

3
00:00:07,100 --> 00:00:11,500
まず最初に、鮭の切り身を用意してください。

4
00:00:11,500 --> 00:00:15,300
皮ありのままで大丈夫です。

5
00:00:15,800 --> 00:00:19,200
野菜はキャベツ・玉ねぎ・えのきを

6
00:00:19,200 --> 00:00:22,600
食べやすいサイズに切っておきます。
```

Whisperの生出力だと「今日は気仙沼から届いた秋鮭を使ってちゃんちゃん焼きを作っていきますまず最初に鮭の切り身を用意してください」と句読点ゼロで1行になりがち。Claudeが自然な区切りで分割してくれる。

## 過去30本に一括適用

```typescript
interface VideoJob {
  videoId: string;
  audioPath: string;
  title: string;
}

async function batchGenerateSubtitles(jobs: VideoJob[]): Promise<void> {
  for (const job of jobs) {
    const outputPath = `./subtitles/${job.videoId}.srt`;

    try {
      await generateSubtitles(job.audioPath, outputPath);
      console.log(`✅ ${job.title}`);
    } catch (err) {
      console.error(`❌ ${job.title}: ${err}`);
    }

    // Whisper APIのレート制限（並列は避ける）
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
```

30本処理して約45分。**コストは1本あたりWhisper約15円＋Claude約20円＝35円、30本で1,050円程度**。

## 効果

| 指標 | Before | After（1ヶ月後） |
|------|--------|-----------------|
| 視聴維持率（平均） | 41% | 57%（1.4倍） |
| 音声オフ視聴の割合 | 測定外 | 推定23%（コメント分析） |
| 字幕起因の検索流入 | 0 | 月間+890セッション |
| 字幕作成1本あたりの時間 | 30〜60分 | 5分（確認のみ） |

視聴維持率の改善が一番大きかった。業者さんの動画は調理工程が多く「この後何をするのか」が字幕で見えると、音なし環境でも離脱しにくくなる。

## ポイントと注意点

**うまくいったこと：**
- 漁業用語（「水揚げ」「活け締め」「神経抜き」など）をWhisperが概ね正確に認識した
- Claudeの整形で30文字ルールを守った字幕になり、スマホでの読みやすさが上がった
- 方言の「〜だべ」「〜だっちゃ」も消さずに保持される

**ハマったこと：**
- 動画ファイルのままWhisperに送れないので、`ffmpeg`で音声抽出が必要
  ```bash
  ffmpeg -i input.mp4 -ar 16000 -ac 1 -q:a 0 -map a output.mp3
  ```
- 25MB超の音声はWhisperのファイルサイズ制限に引っかかる。長い動画は`ffmpeg`でチャンク分割してから結合する

## 次のステップ

字幕をSRTで出したあと、そのテキストをClaudeに渡してブログ記事に変換する流れも試せそう。

「動画を撮ったら → 字幕生成 → 字幕テキストからブログ記事 → ブログ記事からSNS投稿」という自動ラインが組めれば、1本の動画から複数のコンテンツが取れる。

コードや相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
