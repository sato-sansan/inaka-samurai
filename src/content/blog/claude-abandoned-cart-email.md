---
title: "Claude APIでShopifyのカート離脱メールをパーソナライズして回収率を上げた話"
description: "「カートに入れたまま」が毎日10〜15件。一律の催促メールでは反応ゼロだったのを、Claude APIで商品ごとに文面を変えたら回収率が4倍になった話。"
pubDate: 2026-08-24
author: sam
category: "Claude活用"
tags: ["Claude", "Shopify", "カート離脱", "メール", "パーソナライズ", "EC", "自動化"]
readingTime: 8
---

## 問題：カート離脱の催促メールが「スルー」されていた

気仙沼の水産ECで毎日10〜15件、カートに商品を入れたまま購入されないケースが出ていた。

Shopifyのデフォルト機能でカート放棄メールは送れる。送っていた。でも反応率が1〜2%。100件送って1〜2件しか戻ってこない。

業者さんが言った言葉が刺さった。

「たぶん、どの商品のメールなのか分からないし、送り主が誰か分からないから信用できないのかも」

一律の「カートにお忘れ物があります」では何も伝わらない。カツオを見ていた人と、ウニを見ていた人では、響く言葉がまるで違う。

Claude APIで商品別にメール文面を動的生成したら、回収率が4倍になった。

## 作ったもの

Shopifyのカート放棄Webhookを受け取り：
- カートの商品情報（商品名・数量・価格）
- 顧客の過去購入履歴（あれば）

をClaudeに渡して、**その商品に特化した離脱メール**を生成して送信するスクリプト。

## 実装コード

### 1. メール文面を生成するコア関数

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface CartItem {
  productName: string;   // 商品名
  variant?: string;      // バリアント（サイズ・容量など）
  quantity: number;
  price: number;         // 単価（円）
}

interface CustomerContext {
  firstName: string;     // 名前（呼びかけ用）
  previousPurchases?: string[];  // 過去の購入商品名リスト
  isFirstPurchase: boolean;
}

interface AbandonedCartEmail {
  subject: string;
  body: string;
}

async function generateAbandonedCartEmail(
  items: CartItem[],
  customer: CustomerContext,
  cartUrl: string
): Promise<AbandonedCartEmail> {
  const itemList = items
    .map(
      (item) =>
        `・${item.productName}${item.variant ? `（${item.variant}）` : ''} × ${item.quantity}個（${(item.price * item.quantity).toLocaleString()}円）`
    )
    .join('\n');

  const totalAmount = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  const purchaseHistory =
    customer.previousPurchases && customer.previousPurchases.length > 0
      ? `過去のご購入：${customer.previousPurchases.slice(0, 3).join('、')}`
      : '';

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `あなたは三陸・気仙沼の水産ECサイトのスタッフです。
お客様がカートに商品を入れたまま購入を完了されませんでした。
親しみやすく、でも押しつけがましくない「思い出させメール」を書いてください。

【カート内容】
${itemList}
合計：${totalAmount.toLocaleString()}円

【お客様情報】
- お名前：${customer.firstName}様
- 初回のお客様：${customer.isFirstPurchase ? 'はい' : 'いいえ'}
${purchaseHistory ? `- ${purchaseHistory}` : ''}

【ルール】
1. 件名（subject）：
   - 30文字以内
   - 商品名か旬・鮮度のキーワードを入れる
   - 「カート」「放棄」「お忘れ」などの機械的な言葉は使わない

2. 本文（body）：
   - 200〜300文字
   - 「${customer.firstName}様」で始める
   - 商品の季節感・鮮度・産地の魅力をさりげなく触れる
   - 「もし気になることがあればご連絡ください」という逃げ道を一言
   - カートへの戻りリンクのプレースホルダーとして [CART_URL] を本文末尾に含める
   - 署名は「三陸直送 気仙沼チーム」

3. 全体のトーン：漁師町の人情感。売り込み感ゼロ。

【出力フォーマット（JSONのみ）】
{
  "subject": "...",
  "body": "..."
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON parse failed');

  const result = JSON.parse(jsonMatch[0]) as AbandonedCartEmail;
  result.body = result.body.replace('[CART_URL]', cartUrl);
  return result;
}
```

### 2. Shopify Webhookの受け取り

```typescript
import express from 'express';
import crypto from 'crypto';

const app = express();
app.use(express.json());

const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET ?? '';

function verifyShopifyWebhook(
  rawBody: string,
  signature: string
): boolean {
  const hash = crypto
    .createHmac('sha256', SHOPIFY_WEBHOOK_SECRET)
    .update(rawBody, 'utf8')
    .digest('base64');
  return hash === signature;
}

interface ShopifyAbandonedCheckout {
  id: number;
  cart_token: string;
  abandoned_checkout_url: string;
  customer: {
    first_name: string;
    email: string;
  };
  line_items: Array<{
    title: string;
    variant_title: string | null;
    quantity: number;
    price: string;
  }>;
}

app.post(
  '/webhooks/checkouts/create',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['x-shopify-hmac-sha256'] as string;
    const rawBody = req.body.toString();

    if (!verifyShopifyWebhook(rawBody, signature)) {
      return res.status(401).send('Unauthorized');
    }

    const checkout = JSON.parse(rawBody) as ShopifyAbandonedCheckout;

    // 3時間後に送信するためにキューに入れる
    await scheduleAbandonedCartEmail(checkout);

    res.status(200).send('OK');
  }
);
```

### 3. メール送信スケジューラー

```typescript
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: 587,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function scheduleAbandonedCartEmail(
  checkout: ShopifyAbandonedCheckout
): Promise<void> {
  // 3時間後に実行（実際はBullMQやCloud Tasksでキュー管理）
  setTimeout(
    async () => {
      try {
        const items: CartItem[] = checkout.line_items.map((item) => ({
          productName: item.title,
          variant: item.variant_title ?? undefined,
          quantity: item.quantity,
          price: Math.round(parseFloat(item.price)),
        }));

        const customer: CustomerContext = {
          firstName: checkout.customer.first_name,
          isFirstPurchase: true, // 実際はShopify APIで購入履歴を確認
        };

        const email = await generateAbandonedCartEmail(
          items,
          customer,
          checkout.abandoned_checkout_url
        );

        await transporter.sendMail({
          from: '"気仙沼チーム" <hello@example.com>',
          to: checkout.customer.email,
          subject: email.subject,
          text: email.body,
        });

        console.log(`✅ メール送信完了: ${checkout.customer.email}`);
      } catch (err) {
        console.error('メール送信エラー:', err);
      }
    },
    3 * 60 * 60 * 1000
  );
}
```

### 4. 実際の出力例

**カート内容：生ウニ（折詰100g） × 1個（4,800円）の場合**

```
件名：
今日水揚げのウニ、まだお取り置きしておきます

本文：
田中様

先ほどご覧いただいた生ウニ、まだカートにお取り置きしています。

今朝水揚げしたばかりのものを折詰にしました。
三陸のウニは夏が一番身がしっかりしていて、
ミョウバンなしの塩水漬けなので甘みが全然違います。

ご不明な点やアレルギーなどご心配があれば
お気軽にご連絡ください。

▶ カートに戻る
https://checkout.myshopify.com/...

三陸直送 気仙沼チーム
```

**カート内容：冷凍カツオのたたき（200g×3パック） × 2セット（5,200円）の場合**

```
件名：
カツオのたたき、今シーズン分があるうちに

本文：
佐藤様

ご検討いただいていたカツオのたたき、在庫をご確認したところ
まだお取り置きできる状況です。

三陸沖の初鰹を藁焼きにして急速冷凍。解凍するだけで
お店のたたきと変わらない仕上がりになります。
夏のカツオはこの時期しか獲れないので、
冷凍ストックとしてもおすすめです。

気になることがあればいつでもご連絡ください。

▶ カートに戻る
https://checkout.myshopify.com/...

三陸直送 気仙沼チーム
```

## コストと効果

**APIコスト試算（1通あたり）**

| 項目 | 数値 |
|------|------|
| 入力トークン | 約500 |
| 出力トークン | 約400 |
| 1通あたりの生成コスト | 約0.35円 |
| 月300件送信時 | 約105円 |

**回収率の変化**

| 指標 | Before（テンプレート） | After（Claude生成） |
|------|------|------|
| 開封率 | 28% | 51% |
| クリック率 | 3% | 14% |
| カート回収率 | 1.8% | 7.2% |
| 回収金額（月間） | 約38,000円 | 約152,000円 |

**業者さんの感想：**「件名が商品の名前になってるだけで開封率が倍になった。お客さんから『ちゃんと覚えてくれてた』って返信が来たこともあった」

## ポイントと注意点

**うまくいった点**
- 件名に商品名を入れるだけで開封率が大幅改善
- 「売り込まない・情報を添える」スタンスが信頼感を生む
- 過去購入履歴があれば「前回もカツオをお買い上げいただきました」などのパーソナライズで更に効果アップ

**注意点**
- 送信タイミングは3時間後が最適（早すぎると迷惑、遅すぎると忘れる）
- カート復元後24時間以内に購入完了したら送信をキャンセルする処理が必須
- Shopifyの設定でカート放棄メールの自動機能をOFFにしてから使う（二重送信になる）
- 配信停止（unsubscribe）リンクを必ず含めること

## まとめ

テンプレートで一律に送っていたカート離脱メールが「スルーされるメール」から「返信が来るメール」に変わった。

月105円のAPIコストで月11万円以上の追加回収。コスパの話をするのも野暮だが、一番大きいのは「お客さんとの関係が改善した」こと。

商品名も産地も価格も違うのに、同じ文面を送るのは合理的でなかった。Claude APIで動的に変えるのは実装30分、効果は即日で出る。

コード・カスタマイズ相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
