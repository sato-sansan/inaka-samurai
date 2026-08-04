---
title: "Claude APIでShopifyのレビューを分析して改善点を自動抽出した話"
description: "溜まった顧客レビュー100件を手で読むのをやめた。Claudeに投げたら「送料への不満が38%」「保冷梱包への感謝が52%」と一発で出てきた話。"
pubDate: 2026-08-04
author: sam
category: "Claude活用"
tags: ["Claude", "Shopify", "レビュー分析", "顧客理解", "自動化", "EC"]
readingTime: 7
---

## 問題：レビューが溜まっているのに読む時間がない

Shopifyで商品説明文を自動生成してから3ヶ月。気仙沼の業者さんのECサイトはレビューが積み上がってきた。

「いいレビューも悪いレビューも、全部読んだほうがいいのは分かってるんだけど…」

100件を超えると流し読みになる。「ありがとうございます系」と「梱包が残念系」の区別はできても、**具体的に何が多くて、何を改善すべきか**が見えなくなる。

Claude APIにレビューを全部投げたら、一発で傾向が分かった。

## 作ったもの

Shopifyからエクスポートしたレビューテキストを投げると：
- カテゴリ別の頻出テーマと割合
- 改善優先度付きのアクションリスト
- ポジティブ・ネガティブの代表的なコメント抜粋

を出力するスクリプト。

## 実装コード

### 1. レビューをClaudeで分析

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface ReviewAnalysis {
  summary: string;
  themes: Array<{
    category: string;
    sentiment: 'positive' | 'negative' | 'neutral';
    percentage: number;
    examples: string[];
  }>;
  actionItems: Array<{
    priority: 'high' | 'medium' | 'low';
    action: string;
    reason: string;
  }>;
}

async function analyzeReviews(reviews: string[]): Promise<ReviewAnalysis> {
  const reviewText = reviews
    .map((r, i) => `[${i + 1}] ${r}`)
    .join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: `あなたはECサイトのUX改善コンサルタントです。
以下の顧客レビュー${reviews.length}件を分析してください。

【レビュー一覧】
${reviewText}

【出力フォーマット（JSONのみ）】
{
  "summary": "（全体のトレンドを2〜3文で）",
  "themes": [
    {
      "category": "（テーマ名：例「配送・梱包」「鮮度・品質」「価格・コスパ」など）",
      "sentiment": "positive / negative / neutral",
      "percentage": （0〜100の整数。全レビューに占める割合）,
      "examples": [（代表的なコメントを原文のまま2件）]
    }
  ],
  "actionItems": [
    {
      "priority": "high / medium / low",
      "action": "（具体的なアクション）",
      "reason": "（根拠：どのレビューの声から来ているか）"
    }
  ]
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('パース失敗');

  return JSON.parse(jsonMatch[0]) as ReviewAnalysis;
}
```

### 2. Shopifyのレビューエクスポートを読み込む

Shopifyの「レビュー」アプリ（Judge.me等）からCSVでエクスポートして使う：

```typescript
import * as fs from 'fs';
import { parse } from 'csv-parse/sync';

interface ReviewRow {
  body: string;
  rating: string;
  created_at: string;
}

function loadReviewsFromCSV(filePath: string): string[] {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const rows = parse(raw, { columns: true }) as ReviewRow[];

  return rows
    .filter((r) => r.body && r.body.trim().length > 10)
    .map((r) => `★${r.rating} ${r.body.trim()}`);
}

// 使用例
const reviews = loadReviewsFromCSV('shopify-reviews.csv');
const analysis = await analyzeReviews(reviews);
```

### 3. レポートをMarkdownで出力

```typescript
function formatReport(analysis: ReviewAnalysis): string {
  const lines: string[] = [
    '# レビュー分析レポート',
    '',
    '## サマリー',
    analysis.summary,
    '',
    '## テーマ別内訳',
    '',
  ];

  for (const theme of analysis.themes) {
    const emoji = theme.sentiment === 'positive' ? '✅' : theme.sentiment === 'negative' ? '⚠️' : '📌';
    lines.push(`### ${emoji} ${theme.category}（${theme.percentage}%）`);
    lines.push('**代表コメント：**');
    theme.examples.forEach((ex) => lines.push(`- 「${ex}」`));
    lines.push('');
  }

  lines.push('## アクションアイテム', '');
  const priorityOrder = ['high', 'medium', 'low'] as const;
  for (const p of priorityOrder) {
    const items = analysis.actionItems.filter((a) => a.priority === p);
    if (items.length === 0) continue;
    const label = p === 'high' ? '🔴 高優先度' : p === 'medium' ? '🟡 中優先度' : '🟢 低優先度';
    lines.push(`### ${label}`);
    items.forEach((item) => {
      lines.push(`- **${item.action}**`);
      lines.push(`  └ 根拠：${item.reason}`);
    });
    lines.push('');
  }

  return lines.join('\n');
}

// レポート保存
const report = formatReport(analysis);
fs.writeFileSync('review-report.md', report);
console.log(report);
```

### 4. 実際の出力例（抜粋）

```
# レビュー分析レポート

## サマリー
全体的な満足度は高く、鮮度と味への評価が中心。一方で配送時の保冷不足と
梱包の傷みへの指摘が一定数あり、夏場の対策が優先課題となっている。

## テーマ別内訳

### ✅ 鮮度・味（52%）
代表コメント：
- 「届いた瞬間から新鮮で、スーパーとは全然違う」
- 「藁焼きの香りがしっかりして、本格的な味でした」

### ⚠️ 配送・梱包（38%）
代表コメント：
- 「夏場なので保冷剤が溶けかけていた。もう少し多いとありがたい」
- 「箱の角が潰れていた。中身は大丈夫だったけど心配した」

## アクションアイテム

### 🔴 高優先度
- **夏季の保冷剤を2個→3個に増量する**
  └ 根拠：「保冷剤が溶けていた」コメントが8件、6〜8月に集中
```

## コストと効果

**APIコスト試算（100件のレビュー分析）**

| 項目 | 数値 |
|------|------|
| 入力トークン（100件×平均80字） | 約1,600 |
| 出力トークン | 約1,000 |
| 1回の分析コスト | 約0.6円 |

**時間削減**

| 作業 | Before | After |
|------|--------|-------|
| 100件レビュー手動確認 | 約2時間 | 3分（コード実行のみ） |
| 改善施策の立案 | 半日（担当者間で議論） | レポート確認後30分で決定 |

**業者さんの感想：**「保冷剤を増やしたら、梱包への苦情が翌月からゼロになった」

## ポイントと注意点

**うまくいった点**
- パーセンテージで出させることで「感覚」から「数字」に変わった
- アクションアイテムに根拠を必須にしたことで、施策の説得力が上がった
- 100件でもコンテキストウィンドウに収まる（約8,000トークン）

**注意点**
- 300件を超える場合はバッチ分割が必要（例：100件ずつ3回に分けて最後に集計）
- Claudeの割合計算はあくまで定性的な推計なので、正確な数字が必要な場合は別途集計する
- 定期的に分析する場合（月1回など）はスクリプト化してスケジューラーで実行する

## まとめ

レビュー分析は「重要だと分かっているがやれていない」筆頭タスクだった。

100件を2時間かけて読んでいたものが3分になり、しかも「保冷剤38%」という具体的な数字が出てくることで施策の優先順位がすぐ決まる。改善サイクルが回るようになった。

手間をかけずに顧客の声を活かしたい事業者さんにはすぐ試してほしい実装。

コード・カスタマイズ相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
