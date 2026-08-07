---
title: "Claude APIで「入荷お知らせ」メールをパーソナライズした話【開封率12%→41%の実装例】"
description: "在庫切れ商品の入荷待ち登録者に全員同じメールを送っていたら開封率12%だった。Claude APIで購入履歴・待機日数を読ませてパーソナライズしたら41%になった話。"
pubDate: 2026-08-07
author: sam
category: "Claude活用"
tags: ["Claude", "メール", "パーソナライズ", "在庫管理", "EC", "水産業", "Shopify"]
readingTime: 8
---

## 問題：入荷通知を出しても誰も買わない

[メルマガの施策](/blog/claude-newsletter-generator)で2回目購入率が31%に上がった。次の課題は**在庫切れの機会損失**だった。

気仙沼の業者さんの商品は季節もの。カツオ、サンマ、牡蠣──旬は短く、入荷タイミングが読みにくい。「在庫なし」のまま興味を持ったお客さんが離れていく。

Shopifyの入荷待ち通知機能でメール登録は促しているが、入荷時に全員同じ文面を一斉送信するだけだった。

開封率 **12%**。クリック率 **4%**。ほぼ無視されている。

「みんなに同じ文章を送っているのが問題では」と思い、Claude APIで顧客ごとにパーソナライズしてみた。

## 作ったもの

- 在庫入荷イベントをトリガーに
- 入荷待ち登録者の購入履歴・登録日数・購入回数を読んで文脈を組み立て
- 各顧客に合わせたパーソナライズ入荷通知を生成

## 実装コード

### 1. 型定義

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface CustomerContext {
  name?: string;
  registeredDaysAgo: number;
  pastPurchases: string[];
  totalOrders: number;
  lastOrderDaysAgo?: number;
}

interface RestockProduct {
  name: string;
  stockNote: string;       // 例: "今期最後の入荷・100パックのみ"
  price: string;
  seasonalContext: string; // 例: "8月下旬、カツオシーズン終盤"
}

interface RestockEmailResult {
  subject: string;
  body: string;
  cta: string;
}
```

### 2. パーソナライズメール生成

```typescript
async function generateRestockEmail(
  customer: CustomerContext,
  product: RestockProduct
): Promise<RestockEmailResult> {
  const contextHints: string[] = [];

  if (customer.registeredDaysAgo > 30) {
    contextHints.push(`${customer.registeredDaysAgo}日前から待ち続けている根強いファン`);
  } else {
    contextHints.push(`最近（${customer.registeredDaysAgo}日前）に登録、関心が高いタイミング`);
  }

  if (customer.totalOrders >= 5) {
    contextHints.push('5回以上購入のリピーター。信頼関係があるので品質への感謝が刺さる');
  } else if (customer.totalOrders >= 2) {
    contextHints.push('2〜4回購入の安定顧客。旬の希少性を伝えると効果的');
  } else {
    contextHints.push('まだ未購入または初期段階。入荷通知が初めての接点になる可能性がある');
  }

  if (customer.pastPurchases.length > 0) {
    contextHints.push(`過去の購入商品: ${customer.pastPurchases.join('、')}`);
  }

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1000,
    messages: [
      {
        role: 'user',
        content: `あなたは地方産品EC（水産加工品）のメールマーケターです。
在庫入荷を待っていたお客様向けのパーソナライズ通知メールを作成してください。

【入荷商品】
商品名: ${product.name}
在庫状況: ${product.stockNote}
価格: ${product.price}
季節背景: ${product.seasonalContext}

【顧客情報】
${contextHints.map((h) => `- ${h}`).join('\n')}

【指示】
- 件名：25字以内。「入荷しました」で終わらせず感情を動かすひと工夫を入れる
- 本文：250〜300字。ですます調。待たせた感謝と在庫の希少性を伝える。セールス臭を避ける
- CTA：15字以内。購入ボタン上のテキスト

【出力（JSONのみ）】
{
  "subject": "...",
  "body": "...",
  "cta": "..."
}`,
      },
    ],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON解析失敗');

  return JSON.parse(jsonMatch[0]) as RestockEmailResult;
}
```

### 3. Shopifyの入荷待ちリストと連携

```typescript
import * as fs from 'fs';
import { parse } from 'csv-parse/sync';

interface WaitlistRow {
  email: string;
  customer_name: string;
  registered_at: string;
  total_orders: string;
  past_products: string;
  last_order_at: string;
}

function loadWaitlist(
  csvPath: string
): Array<{ email: string; context: CustomerContext }> {
  const raw = fs.readFileSync(csvPath, 'utf-8');
  const rows = parse(raw, { columns: true }) as WaitlistRow[];
  const now = new Date();

  return rows.map((row) => {
    const registeredAt = new Date(row.registered_at);
    const lastOrderAt = row.last_order_at ? new Date(row.last_order_at) : undefined;

    return {
      email: row.email,
      context: {
        name: row.customer_name || undefined,
        registeredDaysAgo: Math.floor(
          (now.getTime() - registeredAt.getTime()) / (1000 * 60 * 60 * 24)
        ),
        pastPurchases: row.past_products
          ? row.past_products.split(',').map((s) => s.trim()).filter(Boolean)
          : [],
        totalOrders: parseInt(row.total_orders, 10) || 0,
        lastOrderDaysAgo: lastOrderAt
          ? Math.floor(
              (now.getTime() - lastOrderAt.getTime()) / (1000 * 60 * 60 * 24)
            )
          : undefined,
      },
    };
  });
}

async function sendRestockCampaign(
  waitlistCsvPath: string,
  product: RestockProduct
): Promise<void> {
  const waitlist = loadWaitlist(waitlistCsvPath);
  console.log(`入荷待ちリスト: ${waitlist.length}件`);

  // 100件ずつ分割してAPIレート制限を回避
  const BATCH_SIZE = 100;
  const allResults: Array<{ email: string; success: boolean; content?: RestockEmailResult }> = [];

  for (let i = 0; i < waitlist.length; i += BATCH_SIZE) {
    const batch = waitlist.slice(i, i + BATCH_SIZE);

    const results = await Promise.all(
      batch.map(async ({ email, context }) => {
        try {
          const content = await generateRestockEmail(context, product);
          return { email, success: true, content };
        } catch (err) {
          return { email, success: false };
        }
      })
    );

    allResults.push(...results);
    console.log(`${Math.min(i + BATCH_SIZE, waitlist.length)}/${waitlist.length}件 完了`);
  }

  fs.writeFileSync('restock-emails.json', JSON.stringify(allResults, null, 2));
  console.log(`保存完了: restock-emails.json`);
}

await sendRestockCampaign('waitlist.csv', {
  name: '気仙沼産 本カツオたたき（冷凍）200g',
  stockNote: '今期最後の入荷・100パックのみ。なくなり次第終了',
  price: '1,980円',
  seasonalContext: '8月下旬、今年の本カツオシーズンも終盤に差し掛かっています',
});
```

### 4. 実際の出力例（顧客タイプ別比較）

**パターンA：登録60日・未購入**

```
件名: 60日待った甲斐がありました。カツオ、入荷しました。

本文:
長らくお待たせいたしました。

60日前にご登録いただいた気仙沼産 本カツオたたきが、ようやく入荷いたしました。

今年の三陸カツオは豊漁で、例年より脂の乗りが良いとのこと。藁焼きの香りも格別です。
ただ、今期最後の入荷となり、残りは100パックのみとなっております。

長くお待ちいただいたお客様に、一番いい状態でお届けできるこのタイミングに、ぜひお試しください。

CTA: 今すぐカツオを注文する
```

**パターンB：5回以上購入のリピーター・登録10日**

```
件名: 今期最後です、カツオたたき入荷しました

本文:
いつもご愛顧ありがとうございます。

先日から入荷待ち登録いただいていた気仙沼産 本カツオたたきが入荷しました。

何度もご利用いただいているお客様はよくご存知の通り、この時期のカツオはひと味違います。
今年も藁焼きの香りと三陸の旨みをしっかり閉じ込めました。

「今期最後の入荷・100パックのみ」とのこと。
毎年この時期に楽しみにしてくださっている方には特に、お早めにお知らせしたかった商品です。

CTA: 今年最後のカツオを注文する
```

同じ商品・同じ在庫状況でも、顧客によって文脈がここまで変わる。

## コストと効果

**APIコスト試算（入荷待ちリスト200件）**

| 項目 | 数値 |
|------|------|
| 平均入力トークン | 約600/件 |
| 平均出力トークン | 約300/件 |
| 200件の生成コスト | 約220円 |
| 生成時間（並列） | 約3分 |

**開封率・購買率の比較**

| 指標 | 一斉通知（旧） | パーソナライズ（新） |
|------|--------------|---------------------|
| 開封率 | 12% | 41% |
| クリック率 | 4% | 22% |
| コンバージョン率 | 1.8% | 9.3% |
| 100パック完売までの時間 | 4日 | 6時間 |

業者さんの感想：「在庫が余ることを心配していたのに、今は入荷量が足りなくて困っている」

## ポイントと注意点

**うまくいった点**
- 「○日待った」という事実を件名・冒頭に入れるだけで開封率が大幅に上がった
- リピーターには「いつもご愛顧」という共感フレーズが自然に入ってくる
- 在庫の希少性（「100パックのみ」）はClaudeに判断させず、固定値で渡した

**注意点**
- 購入履歴がない顧客は文脈が薄い。デフォルトトーン（「まずはお試し」方向）に自動フォールバックする設計がよい
- 500件以上を一度に並列実行するとAPIレート制限に当たることがある。100件ずつ分割が安全
- 生成後は件名・在庫数・価格などの固有情報を必ずサンプルチェックする

## まとめ

在庫入荷通知は「出すだけ」では効果が薄い。「誰がどのくらい待っていたか」「その人は何を買ってきた人か」──そういう文脈をメールに乗せるだけで、開封率が3倍以上になった。

Claude APIのパーソナライズは難しくない。顧客データを渡してコンテキストを読ませるだけ。220円のAPIコストで100パックが6時間で完売するなら、やらない理由がない。

コード・カスタマイズ相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
