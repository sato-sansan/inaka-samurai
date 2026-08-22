---
title: "Claude APIで休眠顧客への再アプローチメールを自動生成した話【水産EC】"
description: "半年以上注文がない顧客に手書きメールを出す時間はない。購入履歴と経過日数をClaudeに渡したら、一人ひとりに合わせたパーソナルな再アプローチ文が自動で生成できるようになった。"
pubDate: 2026-08-22
author: sam
category: "Claude活用"
tags: ["Claude", "Shopify", "メールマーケティング", "休眠顧客", "EC自動化", "水産業", "顧客維持"]
readingTime: 8
---

## 「昔は買ってくれていた人」をほったらかしにしていた

[購入後フォローアップメール](/blog/claude-post-purchase-followup)を入れてから、初回購入→2回目購入のコンバージョンは改善した。

でも盲点があった。

「2〜3回買ってくれたけど、半年以上注文がない方が150人いる」

常連になりかけていたのに、いつの間にか離れてしまった顧客層だ。競合に流れたのか、ライフスタイルが変わったのか、理由はわからない。でも**何もしなければ戻ってこない**のは確かだ。

150人に個別で手書きのメールは書けない。だからといって全員に同じ「久しぶりです！」テンプレを送るのも失礼だ。

Shopifyの購入履歴をClaudeに渡して、一人ひとりの過去の注文内容と休眠期間に合わせた再アプローチメールを自動生成する仕組みを作った。

## 作ったもの

Shopifyの顧客データ（最終注文日・注文履歴・合計購入額）を読み込んで：

1. **休眠顧客を自動抽出**（最終注文から90日以上経過した顧客）
2. **顧客ランクを判定**（累計購入額と注文回数でA/B/Cに分類）
3. **個別の再アプローチメールを生成**（過去の購入商品と季節に合わせた内容）
4. **送信タイミングを分散**（一度に大量送信せず、1日50件ずつ）

## 実装コード

### 1. 顧客データの型定義と休眠判定

```typescript
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import { parse } from 'csv-parse/sync';

const client = new Anthropic();

interface CustomerData {
  email: string;
  firstName: string;
  lastName: string;
  lastOrderDate: string;
  totalOrders: number;
  totalSpend: number;
  purchasedItems: string[]; // 過去に購入した商品名リスト
}

type CustomerRank = 'A' | 'B' | 'C';

function classifyRank(customer: CustomerData): CustomerRank {
  if (customer.totalSpend >= 30000 || customer.totalOrders >= 5) return 'A';
  if (customer.totalSpend >= 10000 || customer.totalOrders >= 2) return 'B';
  return 'C';
}

function daysSinceLastOrder(lastOrderDate: string): number {
  const last = new Date(lastOrderDate);
  const now = new Date();
  return Math.floor((now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
}

function loadDormantCustomers(filePath: string): CustomerData[] {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const rows = parse(raw, { columns: true }) as Record<string, string>[];

  return rows
    .map((row) => ({
      email: row['Email'],
      firstName: row['First Name'],
      lastName: row['Last Name'],
      lastOrderDate: row['Last Order Date'],
      totalOrders: parseInt(row['Total Orders'], 10),
      totalSpend: parseFloat(row['Total Spend']),
      purchasedItems: row['Products'].split('|').map((s) => s.trim()),
    }))
    .filter((c) => daysSinceLastOrder(c.lastOrderDate) >= 90);
}
```

### 2. Claude APIでパーソナルメールを生成

```typescript
interface WinBackEmail {
  subject: string;
  body: string;
}

async function generateWinBackEmail(
  customer: CustomerData,
  rank: CustomerRank
): Promise<WinBackEmail> {
  const days = daysSinceLastOrder(customer.lastOrderDate);
  const itemList = customer.purchasedItems.slice(0, 3).join('、');

  const rankContext = {
    A: 'リピート購入いただいていた大切なお客様',
    B: '複数回ご購入いただいたお客様',
    C: 'ご購入いただいたことのあるお客様',
  }[rank];

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `あなたは三陸の水産EC「海の幸 気仙沼」の担当者です。
以下の顧客情報をもとに、温かみのある再アプローチメールを作成してください。

【顧客情報】
- 氏名: ${customer.lastName} ${customer.firstName} 様
- 最終購入から: ${days}日経過
- 過去の購入商品（代表）: ${itemList}
- 顧客ランク: ${rankContext}
- 累計購入額: ${customer.totalSpend.toLocaleString()}円

【メール作成のポイント】
- 「久しぶりですね」という感じを押しつけない、さりげない表現にする
- 過去の購入商品に関連した旬の情報や新商品を1点だけ紹介する
- 高圧的なセール訴求ではなく、近況報告に近いトーンにする
- 署名は「スタッフ 佐藤」とする
- 300字以内の本文に収める

【出力フォーマット（JSONのみ）】
{
  "subject": "（件名）",
  "body": "（本文）"
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('パース失敗');

  return JSON.parse(jsonMatch[0]) as WinBackEmail;
}
```

### 3. バッチ処理と送信制御

```typescript
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransporter({
  host: process.env.SMTP_HOST,
  port: 587,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWinBackCampaign(filePath: string): Promise<void> {
  const customers = loadDormantCustomers(filePath);
  console.log(`休眠顧客数: ${customers.length}人`);

  const results: { email: string; rank: CustomerRank; subject: string }[] = [];

  for (let i = 0; i < customers.length; i++) {
    const customer = customers[i];
    const rank = classifyRank(customer);

    try {
      const email = await generateWinBackEmail(customer, rank);

      await transporter.sendMail({
        from: '"海の幸 気仙沼" <info@kesennuma-umi.jp>',
        to: customer.email,
        subject: email.subject,
        text: email.body,
      });

      results.push({ email: customer.email, rank, subject: email.subject });
      console.log(`[${i + 1}/${customers.length}] 送信完了: ${customer.email}`);

      // APIレート制限対策：1件ごとに1.5秒待機
      await sleep(1500);
    } catch (err) {
      console.error(`送信失敗: ${customer.email}`, err);
    }
  }

  // 実行ログを保存
  fs.writeFileSync(
    'win-back-log.json',
    JSON.stringify({ date: new Date().toISOString(), results }, null, 2)
  );
  console.log(`完了: ${results.length}件送信`);
}

runWinBackCampaign('shopify-customers.csv');
```

### 4. 実際に生成されたメールの例

**Aランク顧客（累計4万円・7回購入）への例**

```
件名: ホタテの新シーズンが始まりました

高橋 美咲 様

ご無沙汰しております、海の幸 気仙沼スタッフの佐藤です。

先日、今年初の大型ホタテが水揚げされました。以前ご購入いただいた
活ホタテと同じ漁師さんの船から届いたものです。

貝柱の厚みが例年より2〜3ミリ増しているとのことで、刺身での食べ比べが
楽しい時期になりそうです。

もしご興味があれば、ページを覗いてみてください。

スタッフ 佐藤
```

**Bランク顧客（累計1.5万円・2回購入）への例**

```
件名: 秋のめかぶが入荷しました

田中 健一 様

こんにちは、海の幸 気仙沼の佐藤です。

以前めかぶ丼セットをお買い上げいただきましたが、
ちょうど秋の新物めかぶが獲れ始めたところです。

夏の疲れが残るこの時期にぴったりで、地元では
「秋めかぶは体に染みる」と言われています。

よろしければのぞいてみてください。

スタッフ 佐藤
```

## コストと効果

**APIコスト試算（150人分）**

| 項目 | 数値 |
|------|------|
| 1件あたり入力トークン | 約450 |
| 1件あたり出力トークン | 約200 |
| 150人分の合計コスト | 約200円 |

**施策の結果（初回実施から4週間後）**

| 指標 | 数値 |
|------|------|
| 送信数 | 150件 |
| 開封率 | 48%（業界平均21%） |
| 再購入率 | 12%（18人が再注文） |
| 平均注文額 | 6,200円 |
| 施策の売上貢献 | 約11万円 |

開封率が高かった理由として、業者さんが「件名が押しつけがましくなかった」「本文が短くて読みやすかった」と分析している。

## ポイントと注意点

**うまくいった点**
- 過去の購入商品に言及するだけで「ちゃんと覚えていてくれた」感が生まれた
- 300字の制約をプロンプトに入れたことで、長すぎず読み捨てられない文量になった
- 顧客ランクで温度感を変えたことで、Aランクからの反応が特に良かった

**注意点**
- 法律上、メール配信には受信者の事前同意（オプトイン）が必要。Shopifyの購入顧客はデフォルトでオプトアウト手続きが保護されているが、メール配信リストへの登録確認は必ず行う
- 同一顧客への再送は最低3ヶ月以上空けること
- Claudeが生成した季節の情報（「秋のめかぶ」など）は実際の在庫状況と照合してから送信する

## まとめ

「150人に個別のメールを書く」は現実的ではなかったが、「150人分の文章をClaudeに生成させる」は200円とコーヒー1杯分の時間でできた。

同じ「久しぶりです」でも、その人が以前何を買ったかに触れるだけで、受け取る側の印象は全然違う。それをスケールさせたのがこの仕組みだ。

眠っている顧客リストがある方は、まず手元のCSVで試してほしい。

コード・カスタマイズ相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
