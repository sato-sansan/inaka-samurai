---
title: "Claude × Notionで議事録を自動化した話【コード全公開】"
description: "会議の音声をWhisperで文字起こし → Claudeで要約 → Notionへ自動投稿。ゼロから実装した手順をすべて公開します。"
pubDate: 2026-03-10
author: sam
category: "Claude活用"
tags: ["Claude", "Notion", "自動化", "議事録"]
readingTime: 8
---

## やりたかったこと

毎週の定例会議、議事録をまとめるのに30分かかっていた。
これをゼロにしたい。

## 構成

```
録音（iPhone) → Whisper API（文字起こし）→ Claude API（要約・アクション抽出）→ Notion API（投稿）
```

## 実装コード（Claude API部分）

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

async function summarizeMeeting(transcript: string) {
  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `以下の会議記録を整理してください。

【フォーマット】
## 決定事項
- 箇条書き

## アクションアイテム
- 担当者 | 内容 | 期限

## 次回議題候補

---
${transcript}`,
      },
    ],
  });

  return message.content[0].type === 'text' ? message.content[0].text : '';
}
```

## 結果

議事録作成時間：**30分 → 3分**（確認・修正のみ）
