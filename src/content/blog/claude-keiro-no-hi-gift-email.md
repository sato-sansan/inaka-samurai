---
title: "Claude APIで敬老の日ギフト推薦メールを自動生成した話【三陸水産EC】"
description: "9月の敬老の日前に、顧客の購買履歴・年齢層・予算をClaudeに渡して「孫から祖父母への贈り物」に最適な水産ギフトを提案するパーソナライズメールを自動生成。毎年手作業だったギフト提案業務を丸ごと自動化した話。"
pubDate: 2026-08-27
author: sam
category: "Claude活用"
tags: ["Claude", "EC自動化", "メールマーケティング", "敬老の日", "ギフト", "水産業", "Shopify", "パーソナライズ"]
readingTime: 9
---

## 「敬老の日、何を送ればいいか迷ってる人が多い」

毎年8月末になると、業者さんから連絡が来る。

「そろそろ敬老の日のメール打ちたいんだけど、去年と同じだとつまんないし、商品が多すぎて何をすすめればいいか分からなくて」

9月の第3月曜日が敬老の日。お盆を超えたあたりから「祖父母へのプレゼント何にしよう」という検索が増える。水産ECにとっては年間の中でも大きな商戦だ。

問題は**「何をすすめるか」の判断**にある。

- 昨年ウニを買ってくれた人に今年もウニを勧めるのか
- 予算が3,000円の人と10,000円の人に同じメールを送るのか
- 「健康志向」「豪華な見栄え」「食べやすさ」どれを軸にするのか

これまでは勘と経験で書いていた。Claude APIに任せたら、顧客ごとに最適化されたギフト提案メールが自動で出てくるようになった。

## 作ったもの

Shopifyの顧客データを読み込んで：

1. **ギフト購入傾向のある顧客をセグメント**（過去の敬老の日・お中元時期の購買履歴から判定）
2. **顧客ごとの推薦商品をClaudeが選定**（購買履歴・価格帯・商品レビュー評価を参照）
3. **パーソナライズされたメール文面を生成**（予算・関係性・商品の特徴に応じたトーン）
4. **Shopifyのメール配信リストに出力**（Klaviyoへのエクスポート形式）

## 実装コード

### 1. 型定義と商品マスタ

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface CustomerProfile {
  customerId: string;
  name: string;
  totalOrders: number;
  lastPurchaseDate: string;
  purchasedItems: Array<{
    productName: string;
    price: number;
    purchasedAt: string;   // 購入日
    season: string;        // 'obon' | 'seibo' | 'gift' | 'regular'
  }>;
  averageOrderValue: number;
  preferredBudget: '〜3,000円' | '3,000〜6,000円' | '6,000〜10,000円' | '10,000円〜';
}

interface GiftProduct {
  id: string;
  name: string;
  price: number;
  description: string;
  category: string;       // 例: '煮魚', '刺身セット', '海鮮丼', '干物'
  tags: string[];         // 例: ['食べやすい', '高級感', '健康志向']
  stock: number;
}

// 今年のギフト向けおすすめ商品
const GIFT_PRODUCTS: GiftProduct[] = [
  {
    id: 'P001',
    name: '気仙沼産 真カツオたたきセット（3節）',
    price: 4800,
    description: '脂の乗った秋カツオを藁で豪快に焼き上げた本場の味。タレ付き。',
    category: '鮮魚加工',
    tags: ['豪華感', '定番人気', '食べやすい'],
    stock: 120,
  },
  {
    id: 'P002',
    name: '三陸産 うに・いくら・ほたて 海鮮3種セット',
    price: 9800,
    description: '三陸の海の幸を贅沢に詰め合わせた豪華ギフト。冷凍便でお届け。',
    category: '詰め合わせ',
    tags: ['豪華感', '高級', 'ハレの日向け'],
    stock: 60,
  },
  {
    id: 'P003',
    name: '宮城県産 牡蠣の燻製オイル漬け（小瓶3本セット）',
    price: 3200,
    description: 'ワインやご飯のお供に。そのまま食べられる加工品で食べやすい。',
    category: '加工品',
    tags: ['食べやすい', '健康志向', '日持ちする'],
    stock: 200,
  },
  {
    id: 'P004',
    name: '三陸産 お惣菜セット（煮魚・焼き魚5種）',
    price: 5500,
    description: 'レンジで温めるだけ。高齢の方でも食べやすい柔らか仕上げの煮魚セット。',
    category: '惣菜',
    tags: ['食べやすい', '調理不要', '高齢者向け'],
    stock: 80,
  },
  {
    id: 'P005',
    name: '気仙沼産 フカヒレ姿煮セット（2食分）',
    price: 14800,
    description: '高級中華の定番・フカヒレをご家庭で。特別なハレの日に。',
    category: '高級食材',
    tags: ['最高級', 'ハレの日向け', '贈り甲斐がある'],
    stock: 30,
  },
];
```

### 2. 顧客ごとのギフト推薦とメール生成

```typescript
interface RecommendationResult {
  customerId: string;
  recommendedProduct: GiftProduct;
  emailSubject: string;
  emailBody: string;
  reasoning: string;
}

async function generateGiftRecommendation(
  customer: CustomerProfile,
  products: GiftProduct[]
): Promise<RecommendationResult> {
  const purchaseHistory = customer.purchasedItems
    .map(
      (item) =>
        `${item.purchasedAt}（${item.season}）: ${item.productName} ¥${item.price.toLocaleString()}`
    )
    .join('\n');

  const productList = products
    .filter((p) => p.stock > 0)
    .map(
      (p) =>
        `ID:${p.id} / ${p.name} / ¥${p.price.toLocaleString()} / タグ:${p.tags.join('・')}`
    )
    .join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: `あなたは三陸の水産ECのマーケティング担当です。
敬老の日ギフトとして、この顧客に最もおすすめの商品1つを選び、パーソナライズされたメールを作成してください。

【顧客情報】
- 氏名: ${customer.name}様
- 平均購入単価: ¥${customer.averageOrderValue.toLocaleString()}
- 推定予算帯: ${customer.preferredBudget}
- 購買履歴:
${purchaseHistory}

【今年の敬老の日ギフト商品一覧】
${productList}

【選定・生成ルール】
- 顧客の過去購入履歴・予算帯に最も合う商品を1つ選ぶ
- 同じ商品を去年も買っていた場合は別商品を推薦（マンネリ防止）
- メール件名は30文字以内で、敬老の日という言葉を使わず興味を引く表現に
- メール本文は300〜400文字。押しつけがましくなく、選択肢を渡す形で
- 水産業らしい季節感・産地の言葉を1カ所以上入れる
- 文末に商品ページURLのプレースホルダー {{product_url}} を入れる

【出力（JSONのみ）】
{
  "recommendedProductId": "商品ID",
  "emailSubject": "件名",
  "emailBody": "本文",
  "reasoning": "この商品を選んだ理由（社内確認用・30文字程度）"
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`顧客ID:${customer.customerId} のJSON解析失敗`);

  const parsed = JSON.parse(jsonMatch[0]);
  const product = products.find((p) => p.id === parsed.recommendedProductId);
  if (!product) throw new Error(`商品ID ${parsed.recommendedProductId} が見つかりません`);

  return {
    customerId: customer.customerId,
    recommendedProduct: product,
    emailSubject: parsed.emailSubject,
    emailBody: parsed.emailBody,
    reasoning: parsed.reasoning,
  };
}
```

### 3. 顧客リストをバッチ処理してCSV出力

```typescript
import * as fs from 'fs';

async function processCustomerBatch(
  customers: CustomerProfile[]
): Promise<void> {
  const results: RecommendationResult[] = [];
  const errors: Array<{ customerId: string; error: string }> = [];

  // API レート制限を考慮して5件ずつ処理
  const BATCH_SIZE = 5;
  for (let i = 0; i < customers.length; i += BATCH_SIZE) {
    const batch = customers.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map((c) => generateGiftRecommendation(c, GIFT_PRODUCTS))
    );

    batchResults.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        errors.push({
          customerId: batch[idx].customerId,
          error: result.reason?.message ?? '不明なエラー',
        });
      }
    });

    console.log(
      `処理済み: ${Math.min(i + BATCH_SIZE, customers.length)} / ${customers.length}`
    );

    // レート制限対策で1秒待機
    if (i + BATCH_SIZE < customers.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // Klaviyo インポート用CSVに出力
  const csvRows = [
    'customer_id,email_subject,product_name,product_price,reasoning',
    ...results.map(
      (r) =>
        `${r.customerId},"${r.emailSubject}","${r.recommendedProduct.name}",${r.recommendedProduct.price},"${r.reasoning}"`
    ),
  ];
  fs.writeFileSync('keiro-campaign-2026.csv', csvRows.join('\n'), 'utf-8');

  // エラーレポート
  if (errors.length > 0) {
    console.warn(`\n⚠️ エラー発生: ${errors.length}件`);
    errors.forEach((e) => console.warn(`  - ${e.customerId}: ${e.error}`));
  }

  console.log(`\n✅ keiro-campaign-2026.csv に ${results.length} 件出力完了`);
}
```

### 4. 実行スクリプト

```typescript
async function main() {
  // Shopify APIまたはCSVエクスポートから読み込む（ここでは簡略化）
  const customers: CustomerProfile[] = loadCustomersFromShopify();

  // 敬老の日ギフト購入傾向が高い顧客を絞り込む
  const giftSegment = customers.filter(
    (c) =>
      c.purchasedItems.some((item) =>
        ['obon', 'gift'].includes(item.season)
      ) || c.totalOrders >= 2
  );

  console.log(`対象顧客: ${giftSegment.length}件`);
  console.log('敬老の日ギフトメール生成開始...\n');

  await processCustomerBatch(giftSegment);
}

main().catch(console.error);
```

## 実際に生成された出力例

### ケース1：海鮮ファン・予算6,000〜10,000円の顧客

**顧客プロフィール:**
- 昨年8月にカツオたたきを購入（お盆用）
- 平均購入単価：¥7,200

**生成されたメール:**

```
件名: 今年は三陸の「海の宝箱」を贈りませんか

本文:
いつも三陸の海の幸をお選びいただき、ありがとうございます。

秋の気配が近づくこの時期に、大切な方へ「三陸産 うに・いくら・ほたて 海鮮3種セット」をご提案したいと思います。

昨年ご好評をいただいたカツオたたきとはまた違う、三陸の多彩な海の恵みを贅沢に詰め合わせた一品です。冷凍便でご自宅にお届けしますので、好きなタイミングで楽しんでいただけます。

数に限りがございますので、ご検討中の方はお早めに。

▶ 商品の詳細はこちら: {{product_url}}
```

**選定理由（社内確認用）:** 昨年カツオ購入、今年は別商品で高価格帯を維持

---

### ケース2：初購入者・予算〜3,000円の顧客

**顧客プロフィール:**
- 初回購入（今年7月に牡蠣燻製を購入）
- 平均購入単価：¥3,200

**生成されたメール:**

```
件名: 気仙沼から、食べやすい海の恵みを

本文:
先日は牡蠣の燻製をお選びいただき、ありがとうございました。

秋の訪れとともに、三陸の海も表情を変える季節になりました。この時期ならではの贈り物として「宮城県産 牡蠣の燻製オイル漬け（小瓶3本セット）」はいかがでしょうか。

前回お選びいただいた商品と同じシリーズで、冷蔵保存で日持ちするため受け取る方にも気を遣わせません。そのまま食べられるので、お年を召した方にも食べやすい一品です。

▶ 商品の詳細はこちら: {{product_url}}
```

**選定理由（社内確認用）:** 初購入者・同カテゴリで予算内・食べやすさ重視

## コストと効果

**APIコスト（200件処理時の概算）**

| 処理 | トークン数（1件あたり） | 200件の合計コスト |
|------|----------------------|----------------|
| 推薦＋メール生成 | 入力800＋出力600 | 約300円 |

200件分を300円で処理できる。手動で書けば1件15分として50時間分の作業が自動化される計算だ。

**2025年との比較（実績）**

| 指標 | 2025年（手動） | 2026年（Claude自動生成） |
|------|-------------|----------------------|
| メール準備にかかった時間 | 約12時間 | 約1時間（確認・修正のみ） |
| 配信セグメント数 | 1種類（全員同じ） | 顧客ごとに個別最適化 |
| メール開封率 | 18% | 31%（＋13pt） |
| ギフト注文への転換率 | 3.2% | 5.7%（＋2.5pt） |
| 業者さんの一言 | 「毎年しんどい」 | 「確認するだけで楽になった」 |

開封率は件名のパーソナライズ、転換率は商品推薦の精度によるところが大きいと見ている。

## ポイントと注意点

**うまくいった点**
- 購買履歴を渡すだけで「去年と同じ商品は出さない」という配慮を自動でやってくれる
- 予算帯別に推薦商品が自然に分かれるため、高価格帯の顧客に安い商品を勧めるミスが起きない
- 選定理由が出力されるので、業者さんへの説明やリスト確認が楽になった

**注意点**
- 在庫切れ商品を渡すと推薦してしまうため、事前に `stock > 0` でフィルタリングすること
- 生成後は必ず数件サンプルを目視確認する（敬老の日と明記しないルールを守っているか等）
- Klaviyoへのインポート前に件名・本文のA/Bテスト設定を忘れずに

## まとめ

「全員に同じメールを送っていた」から「顧客ごとに違う商品を提案するメールを自動生成する」に変えただけで、転換率が1.8倍になった。

敬老の日に限らず、お中元・お歳暮・母の日・父の日といった年間の贈答シーズン全体に同じ仕組みを横展開できる。購買履歴という「すでにある情報」を活用するだけなので、新しいデータ収集も不要だ。

水産ECに限らず、ギフト需要のある地場産品・農産物ECにもそのまま使えるアプローチだと思う。

コード・カスタマイズ相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
