---
title: "Claude APIで購入後のお礼メールを商品別にパーソナライズした話【リピート率が1.4倍に】"
description: "「ご購入ありがとうございます」の一言で終わっていたお礼メールを、買った商品ごとに内容を変えた。カツオのたたきを買った人にはカツオだしの使い方を、秋サケを買った人には塩鮭の焼き方コツを添えたら、翌月のリピート率が変わった話。"
pubDate: 2026-08-11
author: sam
category: "Claude活用"
tags: ["Claude", "メール", "購入後フォロー", "パーソナライズ", "リピート率", "顧客体験", "水産業", "EC"]
readingTime: 8
---

## 「ありがとうございます」だけのメールを3ヶ月送り続けていた

[メルマガ自動生成](/blog/claude-newsletter-generator)を実装した後、ある業者さんから相談が来た。

「買ってくれた直後のお礼メールって、どうしたらいいんでしょう。今はShopifyの自動送信で"ご購入ありがとうございます"だけ送ってるんですが…」

見せてもらったら本当に定型文だった。注文番号と配送予定日だけ。カツオのたたきを買った人も、牡蠣の燻製オイル漬けを買った人も、全員同じ文章。

もったいない、と思った。

購入直後のお客さんは「買った商品への関心」が最高潮のタイミングだ。そこに「美味しい食べ方」「合う調味料」「次の旬の案内」を添えれば、自然なリピートにつながる。

Claude APIで、買った商品ごとに内容が変わるお礼メールを自動生成した。

## 作ったもの

Shopifyの購入webhook を受け取って：

1. **注文内容（商品名・数量）を解析**
2. **Claude APIが商品に合わせた本文を生成**（食べ方・保存方法・おすすめ料理・関連商品）
3. **24時間以内に自動送信**（配送状況確認メールとは別に）

## 実装コード

### 1. Shopify webhookから注文情報を取得

```typescript
import Anthropic from '@anthropic-ai/sdk';
import type { IncomingMessage, ServerResponse } from 'http';
import * as crypto from 'crypto';

interface ShopifyLineItem {
  title: string;
  variant_title?: string;
  quantity: number;
  product_type?: string;
  tags?: string;
}

interface ShopifyOrder {
  id: number;
  email: string;
  customer: {
    first_name: string;
    last_name: string;
  };
  line_items: ShopifyLineItem[];
  note?: string;
}

function verifyWebhook(body: string, signature: string): boolean {
  const hash = crypto
    .createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET!)
    .update(body, 'utf8')
    .digest('base64');
  return hash === signature;
}

export async function handleOrderWebhook(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const signature = req.headers['x-shopify-hmac-sha256'] as string;
  const body = await readBody(req);

  if (!verifyWebhook(body, signature)) {
    res.writeHead(401);
    res.end();
    return;
  }

  const order = JSON.parse(body) as ShopifyOrder;

  // 24時間後に送信するようスケジュール（即時送信だとShopifyの注文確認メールと被る）
  await scheduleFollowUpEmail(order, 24 * 60 * 60 * 1000);

  res.writeHead(200);
  res.end();
}
```

### 2. Claudeで商品ごとのお礼メール本文を生成

```typescript
const client = new Anthropic();

interface FollowUpEmail {
  subject: string;
  body: string;
  relatedProducts: string[];
}

async function generateFollowUpEmail(order: ShopifyOrder): Promise<FollowUpEmail> {
  const customerName = `${order.customer.last_name}様`;
  const itemList = order.line_items
    .map((item) => `・${item.title}${item.variant_title ? `（${item.variant_title}）` : ''} × ${item.quantity}`)
    .join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: `あなたは宮城県気仙沼の水産加工品ECショップのスタッフです。
お客様が以下の商品を購入してくださいました。翌日送る「購入後フォローアップメール」を書いてください。

【購入者】${customerName}
【購入商品】
${itemList}

【メールの方針】
- 商品特有の情報を必ず入れる（食べ方・保存方法・旬の背景・おすすめの調理法）
- セールス感を出さない。あくまで「役に立つ情報を届ける」スタンス
- 長さは本文350字以内。読むのに1分かからない長さ
- 末尾に関連商品を1〜2点だけ自然に案内する（ゴリ押しNG）
- 口調：やわらかい丁寧語。堅すぎず、親しみやすく

【出力フォーマット（JSONのみ）】
{
  "subject": "（件名。30字以内。「ご購入ありがとうございます」はNG）",
  "body": "（本文。350字以内）",
  "relatedProducts": [（関連商品候補のキーワード。1〜2個）]
}`,
      },
    ],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('メール生成のJSON解析失敗');
  return JSON.parse(jsonMatch[0]) as FollowUpEmail;
}
```

### 3. 生成したメールを送信

```typescript
import * as nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendFollowUpEmail(order: ShopifyOrder): Promise<void> {
  const email = await generateFollowUpEmail(order);

  await transporter.sendMail({
    from: `"気仙沼海の幸 さむ" <${process.env.SMTP_FROM}>`,
    to: order.email,
    subject: email.subject,
    text: email.body,
  });

  console.log(`フォローアップ送信完了: 注文${order.id} → ${order.email}`);
}

async function scheduleFollowUpEmail(order: ShopifyOrder, delayMs: number): Promise<void> {
  setTimeout(() => sendFollowUpEmail(order), delayMs);
}
```

### 4. 実際の生成例

**ケース1：カツオのたたきを購入した場合**

```json
{
  "subject": "本カツオ、届いたらすぐやってほしいこと",
  "body": "この度はご購入ありがとうございます。\n\n本カツオのたたきは、届いた翌日が最も脂がのっていておいしい状態です。冷蔵庫で保管して、できれば24時間以内にお召し上がりください。\n\n食べる30分前に冷蔵庫から出して常温に戻すと、藁焼きの香りがより引き立ちます。ポン酢とにんにくスライスだけで十分ですが、気仙沼では味噌と薬味で食べる方も多いです。\n\n残った場合は、翌日にカツオだし茶漬けにするのがおすすめ。骨まわりのお肉を熱いご飯にのせて出汁をかけるだけで、ひと手間料理になります。\n\nまた旬のタイミングにご案内しますね。",
  "relatedProducts": ["かつおだし", "藁焼きたたきセット"]
}
```

**ケース2：宮城産殻付き牡蠣を購入した場合**

```json
{
  "subject": "牡蠣が届く前に準備しておくと嬉しいこと",
  "body": "ご注文ありがとうございます。まもなく宮城産の牡蠣が届きます。\n\n殻付き牡蠣は、届いたら濡れた新聞紙に包んで冷蔵庫の野菜室へ。平らな面を上にして保管すると身の水分が逃げにくく、3〜4日は美味しく食べられます。\n\n牡蠣ナイフをお持ちでない場合は、電子レンジで1分加熱すると口が開きます（加熱しすぎると縮むので注意）。\n\n三陸の牡蠣は身がしっかりしているので、生食はもちろんバター醤油炒めや牡蠣フライも絶品です。ぜひお試しを。",
  "relatedProducts": ["牡蠣ナイフ", "殻なし剥き牡蠣（加熱用）"]
}
```

商品が変わると、Claudeが自動で全然違う内容を生成してくれる。

## 結果（3ヶ月運用後）

| 指標 | Before（定型文） | After（パーソナライズ） |
|------|----------------|----------------------|
| フォローメールの開封率 | 28% | 51% |
| 翌月のリピート購入率 | 18% | 25%（約1.4倍） |
| メール経由の関連商品クリック率 | — | 12% |
| 「メールが参考になった」返信 | ほぼ0 | 月5〜8件 |

「牡蠣の保存方法、知らなかったです！」という返信が来るようになった、と業者さんが喜んでいた。

## コスト

| 項目 | 単価 |
|------|------|
| Claude API（1通あたり） | 約1〜2円 |
| 月100件の注文で | 約100〜200円 |
| SMTP送信料（SendGrid等） | 月0〜数百円（無料枠内がほとんど） |

月200円以下で、全顧客のリピート率が1.4倍になった。

## 設計のポイント

**送信タイミングは「24時間後」が正解だった**

購入直後はShopifyの注文確認・配送通知が届く。そこにさらにメールを重ねると「うるさい」と感じられる。翌日に送ると「届く前日にちょうどいい情報が来た」という反応になった。

**「商品を売ろうとしない」スタンスが信頼につながった**

プロンプトで「セールス感を出さない」を強調したのが効いた。関連商品の案内は1〜2点だけ、しかも自然な流れで添えるだけ。ゴリ押しすると読まれなくなる。

**複数商品を注文された場合の処理**

```typescript
// 複数商品購入の場合は最も「金額の大きい商品」をメインにする
function pickMainItem(items: ShopifyLineItem[]): ShopifyLineItem {
  // 実際はShopifyのline_item.priceで比較するのがベスト
  return items[0]; // シンプルにするなら最初の1件でも十分
}
```

複数商品を全部まとめてプロンプトに入れても、Claudeは自然にバランスを取ってくれる。ただし「全部を詳しく」はやりすぎになるので、「特にこだわりの1品」を冒頭で紹介する流れが読みやすかった。

## まとめ

購入後のお礼メールは、多くのECサイトで「使われていない接点」になっている。

定型文から商品ごとの情報に変えただけで、開封率が2倍近くになり、リピート率も明確に上がった。お客さんにとっては「役に立つ情報をくれるお店」になる。事業者にとっては「次の購入を自然に引き出す仕組み」になる。

食べ方を知らずに失敗すると二度と買わない、ということも水産品には多い。だからこそ、使い方の情報を届けることはリピートより前に「顧客満足の底上げ」になっている気がする。

コードの利用・カスタマイズ相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
