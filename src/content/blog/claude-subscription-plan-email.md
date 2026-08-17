---
title: "Claude APIで水産ECの定期便プランを自動提案するメールを生成した話"
description: "一度きりで終わらせない。購入履歴と購入間隔からClaudeが最適な定期便プランを提案するメールを自動生成。リピート率が上がった実装例。"
pubDate: 2026-08-17
author: sam
category: "Claude活用"
tags: ["Claude", "メール", "サブスク", "定期便", "水産EC", "自動化", "顧客維持"]
readingTime: 8
---

## 問題：一度買ってもらったのにリピートしてもらえない

気仙沼の業者さんから相談が入った。

「初回購入してくれたお客さんがいるんだけど、次の注文がなかなか来ない。催促するメールを送りたいけど、個別に文章を考えてる時間がない」

水産物のECって、旬があるから「季節が変わったらまた買いたい」という潜在需要が高い。でも顧客側は次の購入タイミングを自分では判断しにくい。こちらから「そろそろカツオが旬ですよ」「前回ご注文から3ヶ月経ちました」と提案メールを送れば反応率は上がる。

問題は、顧客ごとに購入した商品・時期・間隔が違うので、定型文では響かない。Claude APIに購入履歴を渡して、個別最適化された定期便プランの提案文を生成させたら解決した。

## 作ったもの

顧客の購入履歴（商品・日付・数量）を入力すると：
- 定期便プランの提案本文（メール形式）
- おすすめの配送頻度と商品セット案
- 件名候補3パターン

を出力するスクリプト。

## 実装コード

### 1. 定期便提案メールを生成するコア関数

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface PurchaseRecord {
  productName: string;
  purchasedAt: string;  // YYYY-MM-DD
  quantity: number;
  amount: number;
}

interface CustomerProfile {
  name: string;
  purchases: PurchaseRecord[];
}

interface SubscriptionProposal {
  subjectLines: string[];
  emailBody: string;
  recommendedPlan: {
    frequency: string;
    products: string[];
    estimatedMonthlyAmount: string;
  };
}

async function generateSubscriptionEmail(
  customer: CustomerProfile
): Promise<SubscriptionProposal> {
  const purchaseHistory = customer.purchases
    .map(
      (p) =>
        `- ${p.purchasedAt}：${p.productName}×${p.quantity}（${p.amount.toLocaleString()}円）`
    )
    .join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: `あなたは気仙沼の水産EC「三陸直送便」のメール担当です。
以下の顧客情報をもとに、定期便プランを提案するメールと件名を作成してください。

【顧客情報】
お名前：${customer.name} 様
購入履歴：
${purchaseHistory}

【作成ルール】
1. subjectLines（件名候補3案）：
   - 開封率を上げるため「再入荷」「旬」「あなただけ」系の訴求を変えて3案
   - 20文字以内

2. emailBody（メール本文）：
   - 冒頭：季節の挨拶＋購入へのお礼（2〜3行）
   - 購入履歴から読み取れる傾向・好みに触れる（1〜2行）
   - 定期便プランの具体的なメリット提案（箇条書き3点）
   - 締め：購入ページへの誘導文（プレースホルダー[URL]を使う）
   - 全体で300〜400字
   - 敬語・丁寧語。押しつけがましくない自然なトーン

3. recommendedPlan（提案プラン）：
   - frequency：購入間隔から判断した配送頻度（例「隔月」「月1回」）
   - products：過去の購入から推測するおすすめ商品リスト（3点以内）
   - estimatedMonthlyAmount：概算月額（「約○○円〜」形式）

【出力フォーマット（JSONのみ、説明不要）】
{
  "subjectLines": ["...", "...", "..."],
  "emailBody": "...",
  "recommendedPlan": {
    "frequency": "...",
    "products": ["...", "...", "..."],
    "estimatedMonthlyAmount": "..."
  }
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSONのパースに失敗しました');

  return JSON.parse(jsonMatch[0]) as SubscriptionProposal;
}
```

### 2. 複数顧客へのバッチ処理

```typescript
import * as fs from 'fs';

interface BatchResult {
  customerName: string;
  subjectLines: string[];
  emailBody: string;
  recommendedPlan: SubscriptionProposal['recommendedPlan'];
}

async function batchGenerateEmails(
  customers: CustomerProfile[]
): Promise<BatchResult[]> {
  const results: BatchResult[] = [];

  for (const customer of customers) {
    const proposal = await generateSubscriptionEmail(customer);

    results.push({
      customerName: customer.name,
      subjectLines: proposal.subjectLines,
      emailBody: proposal.emailBody,
      recommendedPlan: proposal.recommendedPlan,
    });

    // APIレートリミット対策
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return results;
}

// 結果をCSV出力（Shopifyのメール配信ツールに取り込む）
function exportToCsv(results: BatchResult[], outputPath: string): void {
  const header =
    'customer_name,subject_line_1,subject_line_2,subject_line_3,email_body,recommended_frequency,estimated_amount';

  const rows = results.map((r) =>
    [
      `"${r.customerName}"`,
      `"${r.subjectLines[0]}"`,
      `"${r.subjectLines[1]}"`,
      `"${r.subjectLines[2]}"`,
      `"${r.emailBody.replace(/"/g, '""').replace(/\n/g, '\\n')}"`,
      `"${r.recommendedPlan.frequency}"`,
      `"${r.recommendedPlan.estimatedMonthlyAmount}"`,
    ].join(',')
  );

  fs.writeFileSync(outputPath, [header, ...rows].join('\n'));
  console.log(`✅ ${results.length}件のメールを出力: ${outputPath}`);
}
```

### 3. 実際の入出力例

```typescript
const customer: CustomerProfile = {
  name: '田中 美咲',
  purchases: [
    {
      productName: '気仙沼産 本カツオたたき（冷凍）200g',
      purchasedAt: '2026-05-10',
      quantity: 2,
      amount: 4800,
    },
    {
      productName: '三陸産 銀鮭切り身 400g',
      purchasedAt: '2026-06-22',
      quantity: 1,
      amount: 2600,
    },
    {
      productName: '気仙沼産 本カツオたたき（冷凍）200g',
      purchasedAt: '2026-07-30',
      quantity: 2,
      amount: 4800,
    },
  ],
};

const proposal = await generateSubscriptionEmail(customer);
console.log(JSON.stringify(proposal, null, 2));
```

**出力例：**

```json
{
  "subjectLines": [
    "【田中様限定】旬のカツオ定期便、始めませんか",
    "2ヶ月に1度お届け、三陸の定番をあなたのもとへ",
    "リピートありがとうございます。定期便でもっとお得に"
  ],
  "emailBody": "田中美咲様\n\n暑い日が続いておりますが、いかがお過ごしでしょうか。三陸直送便をご愛顧いただき、誠にありがとうございます。\n\n田中様には5月以降、カツオたたきを中心にご注文いただいておりました。お気に召していただけているようで、大変嬉しく思っております。\n\nこの度、田中様にぴったりの「定期便プラン」をご案内させてください。\n\n・毎回の注文手続きが不要で、旬のタイミングに自動でお届け\n・定期便限定で送料無料、さらに5%OFF\n・お届け内容・頻度はいつでも変更・停止OK\n\n今なら初回送料無料キャンペーン中。ご興味があればぜひご覧ください。\n👉 定期便の詳細・お申込み：[URL]",
  "recommendedPlan": {
    "frequency": "隔月（約2ヶ月に1回）",
    "products": [
      "気仙沼産 本カツオたたき（冷凍）200g×2",
      "三陸産 銀鮭切り身 400g",
      "季節のおすすめ1品（自動セレクト）"
    ],
    "estimatedMonthlyAmount": "約2,400円〜（隔月換算）"
  }
}
```

田中さんの場合、5月・6月・7月と約6週ごとに購入していることをClaudeが読み取って「隔月」を提案してきた。カツオのリピートも拾って商品セットに反映している。

### 4. Shopifyの顧客リストから自動読み込み

```typescript
import { parse } from 'csv-parse/sync';

interface ShopifyCustomerRow {
  'First Name': string;
  'Last Name': string;
  'Total Spent': string;
  'Total Orders': string;
}

interface ShopifyOrderRow {
  Email: string;
  'Lineitem name': string;
  'Created at': string;
  'Lineitem quantity': string;
  'Total': string;
}

function buildCustomerProfiles(
  customersPath: string,
  ordersPath: string
): CustomerProfile[] {
  const customerRows = parse(fs.readFileSync(customersPath, 'utf-8'), {
    columns: true,
  }) as (ShopifyCustomerRow & { Email: string })[];

  const orderRows = parse(fs.readFileSync(ordersPath, 'utf-8'), {
    columns: true,
  }) as ShopifyOrderRow[];

  // メールでグループ化
  const ordersByEmail = new Map<string, PurchaseRecord[]>();
  for (const row of orderRows) {
    if (!ordersByEmail.has(row.Email)) {
      ordersByEmail.set(row.Email, []);
    }
    ordersByEmail.get(row.Email)!.push({
      productName: row['Lineitem name'],
      purchasedAt: row['Created at'].split('T')[0],
      quantity: parseInt(row['Lineitem quantity'], 10),
      amount: parseFloat(row['Total']),
    });
  }

  return customerRows
    .filter((c) => (ordersByEmail.get(c.Email)?.length ?? 0) >= 2)
    .map((c) => ({
      name: `${c['Last Name']} ${c['First Name']}`,
      purchases: ordersByEmail.get(c.Email) ?? [],
    }));
}

// 実行
const profiles = buildCustomerProfiles('customers.csv', 'orders.csv');
const results = await batchGenerateEmails(profiles);
exportToCsv(results, 'subscription-proposals.csv');
```

## コストと効果

**APIコスト試算（1顧客あたり）**

| 項目 | 数値 |
|------|------|
| 入力トークン（購入履歴3〜5件） | 約500 |
| 出力トークン | 約600 |
| 1件の生成コスト | 約0.5円 |
| 100人分 | 約50円 |

**時間削減**

| 作業 | Before | After |
|------|--------|-------|
| 1件のメール作成 | 15〜20分 | 確認のみ（3分） |
| 100人分の対応 | 約25時間（現実的に不可能） | 約30分（バッチ実行＋確認） |
| 送信後のリピート率 | 12%（定型メール） | 23%（パーソナライズ後） |

**業者さんの感想：**「名前だけ入れた定型文と、ちゃんと購入履歴を読んだ文章って、お客さんへの伝わり方が全然違う。開封率もクリック率も上がった」

## ポイントと注意点

**うまくいった点**
- 購入間隔をClaudeが自動判断して配送頻度を提案してくれる
- 「カツオを2回買っている人にカツオを勧める」という当たり前のことが、手作業なしでできる
- 件名候補が3案出るのでA/Bテストをすぐ始められる

**注意点**
- 購入件数が1件しかない顧客には間隔判断ができないため、2件以上でフィルタリングが必要
- 定期便プランの価格・在庫はリアルタイムでは反映されないので、URLで誘導して最終確認させる設計にする
- 送りすぎはリスト疲弊につながる。月1回程度を上限に設定するのが無難

## まとめ

「一度買ってもらったのにリピートしてもらえない」という問題は、多くの地方EC事業者が抱えている。でも顧客ごとに購入傾向を見てパーソナライズされたメールを送るのは、手作業では現実的じゃなかった。

Claude APIを使えば、Shopifyの顧客データを流し込むだけで100件でも50円のコストで完結する。しかも定型文より圧倒的に反応率が高い。

リピート率を上げたいEC事業者さんにはすぐ試してほしい実装。

コード・カスタマイズ相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
