---
title: "Claude APIで注文ごとに同梱メッセージカードをパーソナライズした話"
description: "「ありがとうございました」だけの印刷カードをやめて、Claude APIで注文内容・購入履歴・ギフト用途に合わせたメッセージを自動生成。開封した瞬間の体験が変わった。"
pubDate: 2026-08-29
author: sam
category: "Claude活用"
tags: ["Claude", "同梱メッセージ", "パーソナライズ", "EC", "顧客体験", "自動化", "Shopify"]
readingTime: 9
---

## きっかけ：箱を開けたときの印象を変えたかった

三陸の水産ECで、発送するすべての箱に印刷済みの感謝カードを入れていた。

「この度はお買い上げいただき、誠にありがとうございました。三陸の海の幸をお楽しみください。」

それだけ。

カツオを頼んだ人にも、ウニを頼んだ人にも、初めての方にも、もう10回以上リピートしてくれている方にも、全員同じカード。

ある日、常連さんからDMが来た。

「毎回同じカードで少し寂しい。でも商品は最高なので買い続けます」

刺さった。商品には手をかけているのに、一緒に届けるメッセージは量産品だった。

Claude APIで注文ごとに違うメッセージを生成して、印刷して同梱するようにした。

## 作ったもの

Shopifyの注文情報（商品・ギフト有無・購入回数）をもとに、Claude APIで**その注文専用のメッセージカード本文**を生成。注文処理の流れの中でPDF化して、発送ラベルと一緒に印刷する。

## 実装コード

### 1. メッセージ生成のコア関数

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface OrderItem {
  productName: string;
  variant?: string;
  quantity: number;
}

interface OrderContext {
  customerFirstName: string;
  isGift: boolean;
  giftMessage?: string;         // ギフトの場合の贈り主メモ
  orderCount: number;           // 累計注文回数（1なら初回）
  items: OrderItem[];
  season: 'spring' | 'summer' | 'autumn' | 'winter';
}

async function generatePackageInsertMessage(
  order: OrderContext
): Promise<string> {
  const itemNames = order.items
    .map((item) =>
      item.variant ? `${item.productName}（${item.variant}）` : item.productName
    )
    .join('、');

  const orderCountLabel =
    order.orderCount === 1
      ? '初めてのご注文'
      : `${order.orderCount}回目のご注文`;

  const giftContext = order.isGift
    ? `\n【ギフト注文】贈り主からのメモ：「${order.giftMessage ?? 'なし'}」`
    : '';

  const seasonLabel = {
    spring: '春',
    summer: '夏',
    autumn: '秋',
    winter: '冬',
  }[order.season];

  const message = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: `あなたは三陸・気仙沼の水産ECの担当者です。
商品と一緒に箱に入れる「同梱メッセージカード」の本文を書いてください。

【注文情報】
- お名前：${order.customerFirstName}様
- 商品：${itemNames}
- ${orderCountLabel}
- 季節：${seasonLabel}${giftContext}

【ルール】
1. 文字数：120〜180文字（印刷スペースに収まるサイズ）
2. 書き出し：「${order.customerFirstName}様」から始める
3. ${order.isGift ? 'ギフト注文なので、贈り主の気持ちを添えた温かみのある文面にする' : order.orderCount === 1 ? '初回注文なので、産地や鮮度へのこだわりをさりげなく一言添える' : `${order.orderCount}回目の注文なので、いつも選んでくれていることへの感謝を自然に込める`}
4. 商品の食べ方・旬・保存方法をさりげなく一言添える（押しつけがましくなく）
5. 締めは「三陸直送 気仙沼チーム」
6. 署名の前に空行を一行入れる

本文のみを出力してください（余計な説明・JSON・タグは不要）。`,
      },
    ],
  });

  return message.content[0].type === 'text'
    ? message.content[0].text.trim()
    : '';
}
```

### 2. Shopify注文データからコンテキストを組み立てる

```typescript
interface ShopifyOrder {
  id: number;
  note?: string;
  note_attributes: Array<{ name: string; value: string }>;
  customer: {
    first_name: string;
    orders_count: number;
  };
  line_items: Array<{
    title: string;
    variant_title: string | null;
    quantity: number;
  }>;
}

function getCurrentSeason(): OrderContext['season'] {
  const month = new Date().getMonth() + 1;
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

function buildOrderContext(shopifyOrder: ShopifyOrder): OrderContext {
  const giftAttr = shopifyOrder.note_attributes.find(
    (a) => a.name === 'gift'
  );
  const isGift = giftAttr?.value === 'true';

  return {
    customerFirstName: shopifyOrder.customer.first_name,
    isGift,
    giftMessage: isGift ? shopifyOrder.note ?? undefined : undefined,
    orderCount: shopifyOrder.customer.orders_count,
    items: shopifyOrder.line_items.map((item) => ({
      productName: item.title,
      variant: item.variant_title ?? undefined,
      quantity: item.quantity,
    })),
    season: getCurrentSeason(),
  };
}
```

### 3. 注文確定Webhookで自動生成

```typescript
import express from 'express';
import crypto from 'crypto';
import fs from 'fs/promises';

const app = express();
const WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET ?? '';

function verifyShopifyWebhook(rawBody: string, signature: string): boolean {
  const hash = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody, 'utf8')
    .digest('base64');
  return hash === signature;
}

app.post(
  '/webhooks/orders/paid',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['x-shopify-hmac-sha256'] as string;
    const rawBody = req.body.toString();

    if (!verifyShopifyWebhook(rawBody, signature)) {
      return res.status(401).send('Unauthorized');
    }

    const shopifyOrder = JSON.parse(rawBody) as ShopifyOrder;
    const orderContext = buildOrderContext(shopifyOrder);
    const insertText = await generatePackageInsertMessage(orderContext);

    // テキストファイルに書き出し → 印刷システムが読み込む
    await fs.writeFile(
      `/var/spool/inserts/order-${shopifyOrder.id}.txt`,
      insertText,
      'utf8'
    );

    console.log(`✅ メッセージ生成完了: 注文#${shopifyOrder.id}`);
    res.status(200).send('OK');
  }
);
```

### 4. 実際の出力例

**初回注文・生ウニ（塩水漬け100g）× 1**

```
田中様

初めてのご注文、ありがとうございます。
今朝水揚げの生ウニを、添加物なしの塩水に漬けてお届けしています。
到着後はできるだけ当日中にお召し上がりください。
ミョウバンなしなので、そのままご飯にのせるだけで十分です。
また三陸の味に会いに来てください。

三陸直送 気仙沼チーム
```

**8回目の注文・冷凍カツオのたたき × 2セット**

```
佐藤様

8回目のご注文、いつも本当にありがとうございます。
今回も三陸沖の初鰹を藁焼き・急速冷凍してお届けします。
解凍は冷蔵庫で一晩がおすすめ。半解凍のまま切ると断面がきれいです。
これからも旬の便りをお届けできるよう、頑張ります。

三陸直送 気仙沼チーム
```

**ギフト注文・メカジキの西京漬け × 1・贈り主メモ「父の誕生日に」**

```
山田様

父上のお誕生日のお祝いに、三陸のメカジキをお選びいただきありがとうございます。
西京漬けは焼くだけで仕上がります。グリルで中火8〜10分、皮目からどうぞ。
遠くからでも、おいしいものでつながれることが私たちの一番の喜びです。
どうぞ素敵なお誕生日をお過ごしください。

三陸直送 気仙沼チーム
```

## コストと運用

**APIコスト（1件あたり）**

| 項目 | 数値 |
|------|------|
| 入力トークン | 約350 |
| 出力トークン | 約200 |
| 1件あたりの生成コスト | 約0.20円 |
| 月300件出荷の場合 | 約60円/月 |

**印刷フロー**

1. 注文確定Webhookを受信（決済完了直後）
2. Claude APIでメッセージ生成（約1〜2秒）
3. テキストファイルをスプールフォルダに保存
4. 発送処理担当がラベル印刷と同時にカード印刷
5. 箱詰め時に同梱

カード用紙はA6サイズ（ポストカードサイズ）。フォントはUDフォントを使い、高齢の方でも読みやすいサイズに設定している。

## 変わったこと

導入から3ヶ月でリピート率が12%上がった。計測が難しいが、SNSへの投稿（「メッセージが嬉しかった」「◯回目って書いてあった」）が明らかに増えた。

常連さんからメッセージが来た。

「今回で15回目って書いてあって、数えてくれてたんだって嬉しくなりました。また注文します」

印刷コストは1枚約8円。APIコストを加えても10円以下。梱包材の費用の中に埋もれるレベルだが、届いた人の印象はまるで違う。

**ギフト注文での反響が特に大きい：**受け取った方から「贈り主が選んでくれたことがカードに書いてあって感動した」という声が届いた。贈り主のメモを文脈に組み込むのは、人間が手書きでも難しいことをClaudeがさらっとやってくれる。

## まとめ

同梱メッセージカードは「あってあたりまえ」で見落とされがちなコンタクトポイントだった。

量産カードをやめてからは、箱を開けた瞬間が「体験」になった。商品の品質には自信があったが、届けた後の印象まで設計できていなかった。

月60円のAPIコスト。印刷コスト込みでも月3,000円以下。リピート率の変化を考えると、これより費用対効果の高い施策はなかなかない。

同梱物に力を入れていない水産ECや農産物直売ECは、まずここから始めると変化を実感しやすいと思う。

コード・カスタマイズ相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
