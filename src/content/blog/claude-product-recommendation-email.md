---
title: "Claude APIで購入履歴から「次にぴったりの魚」を推薦するメールを自動生成した話"
description: "カツオを買った人にはビンチョウ、サンマを買った人には秋鮭を。Claude APIに購入履歴と在庫情報を渡すだけで、一人ひとりに合ったおすすめ商品メールが10秒で出てくる仕組みを作った話。"
pubDate: 2026-08-16
author: sam
category: "Claude活用"
tags: ["Claude", "Shopify", "レコメンド", "メール", "パーソナライズ", "水産EC", "自動化"]
readingTime: 8
---

## 問題：「今週の新入荷」メールが全員に同じ内容

気仙沼の業者さんから相談が来た。

「メルマガは作れるようになったんだけど、全員に同じ内容を送ってる。カツオが好きな人と、牡蠣しか買わない人に同じメールを送っても仕方ないよね？」

そう、まったくそのとおり。購買データは積み上がってるのに、セグメント配信ができていない。ECツールのセグメント機能は使い方が複雑で、専任担当がいないと運用できない。

Claude APIに購入履歴と今週の在庫を渡して、一人ひとりに最適なおすすめメールを出力させたら、かなりシンプルに解決できた。

## 作ったもの

Shopifyから取得した顧客の購入履歴と今週の在庫リストを渡すと：
- 顧客ごとにおすすめ商品を1〜3点ピックアップ
- その人の購買傾向に合わせたメール本文を自動生成
- 件名候補3パターン

を出力するスクリプト。

## 実装コード

### 1. レコメンドメールを生成するコア関数

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface PurchaseHistory {
  customerId: string;
  customerName: string;
  orders: Array<{
    date: string;
    items: Array<{
      name: string;
      category: string;
      quantity: number;
    }>;
  }>;
}

interface AvailableProduct {
  id: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  highlight: string; // 産地・鮮度・調理法などの特徴メモ
}

interface RecommendationResult {
  recommendedProducts: Array<{
    productId: string;
    reason: string;
  }>;
  emailSubjectCandidates: string[];
  emailBody: string;
}

async function generateRecommendationEmail(
  customer: PurchaseHistory,
  availableProducts: AvailableProduct[]
): Promise<RecommendationResult> {
  const historyText = customer.orders
    .flatMap((o) =>
      o.items.map((i) => `${o.date}: ${i.name}（${i.category}）×${i.quantity}`)
    )
    .join('\n');

  const productList = availableProducts
    .map(
      (p) =>
        `[${p.id}] ${p.name}（${p.category}）/ ${p.price}円 / ${p.highlight}`
    )
    .join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `あなたは三陸の水産ECサイトのCRMアドバイザーです。
以下の顧客の購入履歴と今週の在庫をもとに、パーソナライズされたおすすめメールを作成してください。

【顧客情報】
名前：${customer.customerName}様（ID: ${customer.customerId}）

【購入履歴】
${historyText}

【今週の在庫リスト】
${productList}

【作成ルール】
1. 購入履歴から顧客の好みのカテゴリ・魚種を読み取る
2. 在庫リストから最もマッチする商品を1〜3点選ぶ（stock=0は除く）
3. 顧客名を呼びかけに使う（〇〇様）
4. メール本文は200〜250字
5. 押しつけがましくなく、「お知らせ」トーンで

【出力フォーマット（JSONのみ）】
{
  "recommendedProducts": [
    { "productId": "...", "reason": "（購入傾向と在庫の紐付け理由）" }
  ],
  "emailSubjectCandidates": ["件名案1", "件名案2", "件名案3"],
  "emailBody": "（メール本文。${customer.customerName}様から書き始める）"
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('パース失敗');

  return JSON.parse(jsonMatch[0]) as RecommendationResult;
}
```

### 2. Shopifyの注文データを整形して渡す

ShopifyのAdmin APIから取得した注文データを `PurchaseHistory` 形式に変換する：

```typescript
interface ShopifyOrder {
  customer: { id: number; first_name: string; last_name: string };
  created_at: string;
  line_items: Array<{ title: string; quantity: number }>;
}

function formatPurchaseHistory(orders: ShopifyOrder[]): PurchaseHistory {
  const first = orders[0].customer;
  return {
    customerId: String(first.id),
    customerName: `${first.last_name}${first.first_name}`,
    orders: orders.map((o) => ({
      date: o.created_at.slice(0, 10),
      items: o.line_items.map((li) => ({
        name: li.title,
        category: guessCategory(li.title),
        quantity: li.quantity,
      })),
    })),
  };
}

function guessCategory(productName: string): string {
  if (/カツオ|まぐろ|サバ|アジ|サンマ|ビンチョウ/.test(productName)) return '青魚';
  if (/牡蠣|ホタテ|アサリ|ハマグリ/.test(productName)) return '貝類';
  if (/サーモン|鮭|秋鮭/.test(productName)) return '鮭系';
  if (/干物|一夜干し|みりん干し/.test(productName)) return '干物';
  if (/ウニ|イクラ|数の子/.test(productName)) return '珍味';
  return 'その他';
}
```

### 3. バッチ処理で複数顧客に一括生成

```typescript
import * as fs from 'fs';

interface OutputRecord {
  customerId: string;
  customerName: string;
  subject: string;
  body: string;
  productIds: string[];
}

async function generateBatchEmails(
  customers: PurchaseHistory[],
  availableProducts: AvailableProduct[]
): Promise<OutputRecord[]> {
  const results: OutputRecord[] = [];

  for (const customer of customers) {
    const rec = await generateRecommendationEmail(customer, availableProducts);

    results.push({
      customerId: customer.customerId,
      customerName: customer.customerName,
      subject: rec.emailSubjectCandidates[0],
      body: rec.emailBody,
      productIds: rec.recommendedProducts.map((r) => r.productId),
    });

    // レート制限対策
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const date = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(
    `recommendation-emails-${date}.json`,
    JSON.stringify(results, null, 2)
  );

  console.log(`✅ ${results.length}件のメールを生成しました`);
  return results;
}

// 使用例
const customers: PurchaseHistory[] = [
  /* Shopifyから整形したデータ */
];

const availableProducts: AvailableProduct[] = [
  {
    id: 'p-021',
    name: '三陸産ビンチョウマグロ（柵）200g',
    category: '青魚',
    price: 1980,
    stock: 30,
    highlight: '今週入荷・脂のりがよい・刺身向け',
  },
  {
    id: 'p-034',
    name: '気仙沼港直送 新物サンマ（冷凍）3尾',
    category: '青魚',
    price: 1580,
    stock: 50,
    highlight: '今シーズン初・塩焼き推奨',
  },
  {
    id: 'p-047',
    name: '宮城県産 殻付き牡蠣 1kg',
    category: '貝類',
    price: 2480,
    stock: 20,
    highlight: '加熱用・今季最大サイズ',
  },
];

await generateBatchEmails(customers, availableProducts);
```

## 実際の出力例

**カツオ・サバ中心の顧客（青魚好き）への出力：**

```json
{
  "recommendedProducts": [
    {
      "productId": "p-021",
      "reason": "カツオを3回購入しており青魚の旬に敏感。脂のりのよいビンチョウはカツオ好きに響きやすい"
    },
    {
      "productId": "p-034",
      "reason": "サバの購入歴あり。新物サンマは秋の青魚として自然な流れでおすすめできる"
    }
  ],
  "emailSubjectCandidates": [
    "田中様へ｜今週の三陸、ビンチョウが入りました",
    "カツオ好きの田中様に、今週のおすすめをお届けします",
    "今週は脂のりの良いビンチョウと新物サンマが入荷しました"
  ],
  "emailBody": "田中様\n\nいつもありがとうございます。\n\n今週の三陸から、田中様にぴったりな2品が入荷しました。\n脂がのった今シーズンのビンチョウマグロと、秋の新物サンマです。\n\nカツオをよくお選びいただいているので、青魚の旬の味わいはきっとお気に召していただけると思います。\n\n数量限定のため、お早めにどうぞ。"
}
```

**牡蠣・ホタテ中心の顧客（貝類好き）への出力：**

```
件名候補:「佐藤様へ｜今週の牡蠣、今シーズン最大サイズが届いています」

本文:
佐藤様

いつもご注文ありがとうございます。

嬉しいお知らせです。今週の宮城県産殻付き牡蠣が今シーズン最大サイズで入荷しました。
旨みが凝縮しており、加熱するほど身のふっくら感が際立ちます。

数量に限りがございますので、ぜひお早めにご検討ください。
```

## コストと効果

**APIコスト試算（顧客100人のバッチ処理）**

| 項目 | 数値 |
|------|------|
| 入力トークン（履歴＋在庫リスト、顧客1人あたり） | 約800 |
| 出力トークン（顧客1人あたり） | 約400 |
| 1件のメール生成コスト | 約0.5円 |
| 100件合計 | 約50円 |

**時間と効果**

| 作業 | Before | After |
|------|--------|-------|
| 100人分のセグメント分け | 2〜3時間（手動） | 自動（コード実行のみ） |
| メール本文の作成 | 1件15分 | 1件10秒 |
| 開封率（全員同一メール） | 約18% | 約31%（初月計測） |

**業者さんの感想：**「カツオ好きのお客さんに『ビンチョウ入りました』って送ったら、普段よりずっと反応がよかった。名前を入れるだけでも違うね」

## ポイントと注意点

**うまくいった点**
- 「なぜこの商品を勧めるか」の理由を出力させることで、施策の説明がつく
- 件名を3案出すことで、開封率のA/Bテストができる
- Claudeが履歴から自動でカテゴリを読み取るので、事前のタグ付けが不完全でも動く

**注意点**
- 購入回数が1〜2回の顧客はデータが少なく精度が下がる → 購入3回以上から先に試す
- 在庫リストが長すぎるとトークンが増える → 「今週のおすすめ10品」に絞って渡すとコスト削減になる
- 顧客名と購買履歴はプライバシーに関わるデータなのでサーバー処理に留め、ローカルに保存しない

## まとめ

「全員に同じメールを送る」から「その人が好きな魚を先読みして送る」に変えただけで、開封率が1.7倍になった。

購買データは持っているのに活かせていない、という水産EC事業者は多い。Claude APIに履歴と在庫を渡す形にすれば、専任のマーケターがいなくてもセグメント配信に近いことができる。

まず購入回数の多い上位顧客20人から試してみると、効果を実感しやすい。

コード・カスタマイズ相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
