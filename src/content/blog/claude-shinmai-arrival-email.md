---
title: "Claude APIで新米「今年の収穫」告知メールを自動生成した話【農家EC】"
description: "「今年の新米が取れた。すぐ告知したい」に即対応。品種・産地・収穫コメントをClaudeに渡したら、新米ならではの旬感と生産者の想いを込めたメール文面が3分で出てきた話。"
pubDate: 2026-09-10
author: sam
category: "Claude活用"
tags: ["Claude", "EC自動化", "メールマーケティング", "新米", "農家", "米", "Shopify", "旬"]
readingTime: 7
---

## 「今年の新米が取れた。すぐ告知したいんだけど…」

[秋鮭の初物案内](/blog/claude-autumn-salmon-first-catch-email)の仕組みを入れてから、水産業だけでなく農家の方からも声がかかるようになった。

「岩手の農家さんなんですが、うちも新米のシーズンになって。毎年メール1本書くのに1〜2時間かかってて、その間にも田んぼの仕事があって……」

新米の告知は9月が勝負。早いところは8月末から出始めるし、「今年初めて取れました」という瞬間のワクワク感は時間が経つほど薄れる。

品種・産地・収穫コメントをClaudeに渡すだけで、旬感あふれる告知メールを自動生成する仕組みを組んだ。

## 作ったもの

農家さんがスマホで入力した今年の収穫情報をClaudeに渡すと：

1. **件名**（新米らしい清々しさと旬感を20字以内で）
2. **本文**（産地ストーリー→今年の出来→購入CTA、300〜400字）
3. **LINE用短縮版**（100字以内）

を自動生成。Shopifyの商品URLと在庫数を添えてメール配信ツールに流し込む。

## 実装コード

### 1. 収穫情報の型定義

```typescript
interface HarvestInfo {
  riceVariety: string;    // "ひとめぼれ（岩手県奥州産）"
  harvestDate: string;    // "2026-09-08"
  farmerName: string;     // "菊池農園"
  yieldComment: string;   // "今年は夏の日照が多く、粒が揃って甘みが強い"
  cookingNote: string;    // "水加減はいつもより少なめがおすすめ"
  currentStock: number;   // 80
  productUrl: string;     // Shopify商品URL
  pricePerKg: string;     // "980円/kg（税込）"
  bagSize: string;        // "5kg"
}
```

### 2. Claude APIで新米告知メールを生成

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface ShinmaiEmail {
  subject: string;
  body: string;
  lineMessage: string;
}

async function generateShinmaiEmail(info: HarvestInfo): Promise<ShinmaiEmail> {
  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `あなたは東北の農家ECサイトのメールライターです。
「新米入荷・今年の収穫」告知メールを生成してください。

【収穫情報】
品種・産地: ${info.riceVariety}
収穫日: ${info.harvestDate}
農家名: ${info.farmerName}
今年の出来コメント: ${info.yieldComment}
炊き方メモ: ${info.cookingNote}
在庫数: ${info.currentStock}袋
単位・容量: ${info.bagSize}
価格: ${info.pricePerKg}
商品URL: ${info.productUrl}

【制作方針】
- 「新米」「今年の収穫」という清々しい旬感を最優先に出す
- 農家さんの名前と産地の固有名詞を使って、誰がどこで作ったかを伝える
- 今年の天候・出来に関するコメントを盛り込み、毎年違う「今年ならでは」感を出す
- 在庫数が少ない場合（50袋以下）は「数量限定」を強調する
- 炊き方のヒントを1行添えると読者の食欲を刺激できる
- 売り込み感より「届けたい気持ち」が伝わる文体にする

【出力（JSONのみ）】
{
  "subject": "（件名：新米らしい清々しさと旬感、20字以内。記号・絵文字なし）",
  "body": "（本文：300〜400字。段落ごとに空行を入れる）",
  "lineMessage": "（LINE用：100字以内。絵文字1〜2個OK）"
}`,
      },
    ],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON解析失敗');
  return JSON.parse(jsonMatch[0]) as ShinmaiEmail;
}
```

### 3. 実際の生成結果（9月8日収穫分）

```
【件名】
今年の新米、奥州から届きました

【本文】
こんにちは。

先日、岩手県奥州市の菊池農園から連絡が入りました。
「今年の新米、刈り取れたよ。日照が多かったせいか、粒が揃ってていい年だと思う」

今年は夏の日射しが長く続いたおかげで、例年より甘みの強い仕上がりに。
品種はひとめぼれ。もちもちした食感と程よい粘りが特徴の、東北を代表する品種です。

炊くときは水加減をいつもより少し少なめにすると、甘みがさらに引き立ちます。

今回の入荷は80袋（5kg）。新米シーズンは早めにご注文いただく方が多い時期です。

▶ 奥州ひとめぼれ（新米）のご注文はこちら
https://example.myshopify.com/products/...

【LINE用メッセージ】
🌾 今年の新米が岩手・奥州から届きました！日照たっぷりで甘みが強い仕上がり。ひとめぼれ5kg。数に限りがあります👉 [URL]
```

## 配信フロー全体

```typescript
import * as fs from 'fs';

interface DeliveryConfig {
  emailListPath: string;
  shopifyProductId: string;
  mailerApiKey: string;
}

async function runShinmaiCampaign(
  info: HarvestInfo,
  config: DeliveryConfig
): Promise<void> {
  console.log(`🌾 ${info.riceVariety} 新米告知メール生成中...`);

  // 1. メール生成
  const email = await generateShinmaiEmail(info);
  console.log(`✅ 件名: ${email.subject}`);

  // 2. Shopifyで在庫確認（二重チェック）
  const stockOk = await checkShopifyStock(config.shopifyProductId, info.currentStock);
  if (!stockOk) {
    console.warn('⚠️ Shopifyの在庫数が合いません。送信を中断します。');
    return;
  }

  // 3. メール配信（SendGrid等）
  await sendBulkEmail({
    subject: email.subject,
    body: email.body,
    listPath: config.emailListPath,
    apiKey: config.mailerApiKey,
  });

  // 4. LINE公式アカウントに投稿
  await postToLine(email.lineMessage);

  console.log(`🎉 配信完了: ${info.riceVariety} 新米告知`);
}

// エントリーポイント（スマホフォームからのWebhook受信を想定）
export async function POST(request: Request): Promise<Response> {
  const body = await request.json() as HarvestInfo;

  await runShinmaiCampaign(body, {
    emailListPath: process.env.EMAIL_LIST_PATH!,
    shopifyProductId: process.env.SHOPIFY_PRODUCT_ID!,
    mailerApiKey: process.env.SENDGRID_API_KEY!,
  });

  return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
}
```

### 4. 農家さんが使うスマホ入力フォーム

Notionフォームで、収穫後すぐにスマホから30秒で入力できるようにした。

| 項目 | 入力例 |
|------|--------|
| 品種・産地 | ひとめぼれ（岩手県奥州産） |
| 収穫日 | 2026-09-08 |
| 農家名 | 菊池農園 |
| 今年の出来コメント | 夏の日照が多く、粒が揃って甘みが強い |
| 炊き方メモ | 水加減はいつもより少なめがおすすめ |
| 在庫数 | 80 |
| 価格（kg当たり） | 980円 |

フォーム送信 → Notion Webhook → Next.js API → Claude → 配信まで自動で流れる。

## コストと時間

**APIコスト（1回の新米告知生成）**

| 項目 | 数値 |
|------|------|
| 入力トークン | 約650 |
| 出力トークン | 約380 |
| 1回のコスト | 約0.4円 |

**時間比較**

| 作業 | Before（手書き） | After（Claude） |
|------|-----------------|----------------|
| メール文面作成 | 60〜120分 | 3分（フォーム入力のみ） |
| LINE用短縮版作成 | 別途10分 | 同時生成 |
| 収穫当日に配信できる率 | 30%（翌日以降になることが多い） | 95% |

## ポイントと工夫

**「今年ならでは」の文章にするための型定義**

毎年同じ文になると読者が飽きる。`yieldComment`（今年の出来コメント）を必須フィールドにしておくことで、Claudeが「今年は日照が多く〜」「今年は雨が少なく〜」と年ごとに違う文章を自然に生成してくれる。

**炊き方メモを1行添える効果**

単なる告知メールに炊き方の豆知識を1行加えると、読者が「試してみたい」と感じやすくなる。農家さんが現場で気づいていることをそのままフォームに書くだけでよい。

**在庫数トリガーで「限定感」を制御**

`currentStock`が50袋以下なら「数量限定」を出すようプロンプトに明記した。農家ECは在庫が少ないケースが多いので、自動で希少感を演出できる。

**Shopifyの在庫二重チェック**

フォーム入力は手入力のため誤りが起きやすい。配信前にShopify APIで在庫を確認することで「品切れなのにメールが届いた」事故を防ぐ。

## 農家さんの声

「田んぼから戻ってきて、ご飯食べながらスマホでフォームを入力したら、翌朝には配信が終わってた。今まで新米メールだけで半日つぶれてたのに。来年からはこれで行く」

昨年の新米告知は収穫から3日後に手書きで配信して開封率19%。今年の即日版は開封率31%になった。

## まとめ

新米の情報は収穫当日が一番新鮮だ。でも農家の現場は収穫期が一番忙しく、メールを書く時間が取れない。

収穫情報を構造化してClaudeに渡すだけで、旬感・産地ストーリー・今年ならではの出来映えを盛り込んだメール文面が3分で手に入る。コストは0.4円。スマホフォームと組み合わせれば、田んぼから帰ってすぐ配信できる体制が整う。

ひとめぼれ・コシヒカリ・あきたこまちなど品種が違ってもプロンプトの構造は同じ。新米以外にも、じゃがいも・玉ねぎ・枝豆など「収穫したら即告知したい」農産物全般に使える。

コード・カスタマイズ相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
