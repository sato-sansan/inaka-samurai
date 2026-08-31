---
title: "Claude APIで秋鮭「初物入荷」案内メールを自動生成した話【三陸水産EC】"
description: "「今年の秋鮭が入ってきた。すぐ告知したい」という電話に即対応できた。漁師さんから仕入れた当日情報（重量・脂のり・産地）をClaudeに渡したら、初物ならではの旬感あふれるメール文面が3分で出てきた話。"
pubDate: 2026-08-31
author: sam
category: "Claude活用"
tags: ["Claude", "EC自動化", "メールマーケティング", "秋鮭", "水産業", "初物", "Shopify", "旬"]
readingTime: 7
---

## 「今日、秋鮭が入ったんだけど今すぐ告知できる？」

[秋刀魚キャンペーン](/blog/claude-autumn-saury-campaign)の仕組みを入れてから、業者さんの反応が変わってきた。

「あの仕組み、サンマだけじゃなくて秋鮭でも使えない？今朝5時に漁港に行ったら今年初の秋鮭が上がって、脂のりも最高だって言うんだよ。でも自分でメール書いてる時間がない…」

これは急ぎだ。しかも**初物**という情報は鮮度が命。その日のうちに告知しないと「旬感」が薄れる。

Claude APIに当日の仕入れ情報だけ渡して、初物案内メールを即生成する仕組みを組んだ。

## 作ったもの

業者さんがスマホでフォームに入力した内容（魚種・産地・重量・コメント）をそのままClaudeに渡すと：

1. **件名**（初物感・希少感を前面に出した20字以内）
2. **本文**（冒頭フック→産地ストーリー→購入CTA、300〜400字）
3. **LINE用短縮版**（100字以内）

を自動生成。Shopifyの商品URLと在庫数を添えてメール配信ツールに流し込む。

## 実装コード

### 1. 仕入れ情報の型定義

```typescript
interface CatchInfo {
  fishName: string;       // "秋鮭（北海道・知床産）"
  catchDate: string;      // "2026-08-31"
  fisherman: string;      // "田中漁業"
  weight: string;         // "3.2kg〜4.0kg"
  condition: string;      // "脂のり最高。今年一番の出来"
  currentStock: number;   // 40
  productUrl: string;     // Shopify商品URL
  pricePerUnit: string;   // "4,800円（税込）"
}
```

### 2. Claude APIで初物案内メールを生成

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface FirstCatchEmail {
  subject: string;
  body: string;
  lineMessage: string;
}

async function generateFirstCatchEmail(info: CatchInfo): Promise<FirstCatchEmail> {
  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `あなたは三陸・北海道の水産ECサイトのメールライターです。
「初物入荷」の案内メールを生成してください。

【仕入れ情報】
魚種: ${info.fishName}
漁獲日: ${info.catchDate}
漁師: ${info.fisherman}
サイズ・重量: ${info.weight}
状態・コメント: ${info.condition}
在庫数: ${info.currentStock}本
価格: ${info.pricePerUnit}
商品URL: ${info.productUrl}

【制作方針】
- 「初物」「今年初」という旬のワクワク感を最優先に出す
- 漁師さんの名前・産地を入れてストーリーを出す
- 在庫数が少ない場合は希少感を強調する（40本以下は「限定」を使う）
- 押しつけがましい売り文句は避け、"届けてくれた人の声"を想像させる文体にする
- 購入CTAは最後の1行のみ、シンプルに

【出力（JSONのみ）】
{
  "subject": "（件名：初物感が伝わる20字以内。記号・絵文字なし）",
  "body": "（本文：300〜400字。段落ごとに空行を入れる）",
  "lineMessage": "（LINE用：100字以内。絵文字1〜2個OK）"
}`,
      },
    ],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON解析失敗');
  return JSON.parse(jsonMatch[0]) as FirstCatchEmail;
}
```

### 3. 実際の生成結果（8月31日の仕入れ）

```
【件名】
今年初の秋鮭が入りました、知床から

【本文】
おはようございます。

今朝早く、北海道・知床の田中漁業から連絡が入りました。
「今年初の秋鮭、脂のりが今年一番いい。早く届けてやりたかった」

8月下旬はまだ早いと思っていましたが、今年は海水温の影響か、
例年より身が締まり脂の乗りも抜群の個体が揃いました。
重量は3.2〜4.0kg。丸ごと一本でお届けします。

ご自宅用はもちろん、9月のお礼やご挨拶にもちょうどよいサイズです。
今回の入荷は40本限り。前回は2日で完売しました。

▶ 知床秋鮭（初物）のご注文はこちら
https://example.myshopify.com/products/...

【LINE用メッセージ】
🐟 今年初の秋鮭が知床から入りました！脂のりが今年一番との声。40本限り、お早めに👉 [URL]
```

## 配信フロー全体

```typescript
import * as fs from 'fs';

interface DeliveryConfig {
  emailListPath: string;      // 顧客リストCSV
  shopifyProductId: string;
  mailerApiKey: string;       // SendGrid等
}

async function runFirstCatchCampaign(
  info: CatchInfo,
  config: DeliveryConfig
): Promise<void> {
  console.log(`📦 ${info.fishName} 初物案内メール生成中...`);

  // 1. メール生成
  const email = await generateFirstCatchEmail(info);
  console.log(`✅ 件名: ${email.subject}`);

  // 2. Shopifyで在庫確認（二重チェック）
  const stockOk = await checkShopifyStock(config.shopifyProductId, info.currentStock);
  if (!stockOk) {
    console.warn('⚠️ Shopifyの在庫数が合いません。送信を中断します。');
    return;
  }

  // 3. メール配信（SendGrid等に投げる想定）
  await sendBulkEmail({
    subject: email.subject,
    body: email.body,
    listPath: config.emailListPath,
    apiKey: config.mailerApiKey,
  });

  // 4. LINE公式アカウントに投稿
  await postToLine(email.lineMessage);

  console.log(`🎉 配信完了: ${info.fishName} 初物案内`);
}

// エントリーポイント（スマホフォームからのWebhook受信を想定）
export async function POST(request: Request): Promise<Response> {
  const body = await request.json() as CatchInfo;

  await runFirstCatchCampaign(body, {
    emailListPath: process.env.EMAIL_LIST_PATH!,
    shopifyProductId: process.env.SHOPIFY_PRODUCT_ID!,
    mailerApiKey: process.env.SENDGRID_API_KEY!,
  });

  return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
}
```

### 4. 業者さんが使うスマホ入力フォーム

Notionフォームを使って、スマホから30秒で入力できるようにした。

| 項目 | 入力例 |
|------|--------|
| 魚種 | 秋鮭（北海道・知床産） |
| 漁師名 | 田中漁業 |
| 重量 | 3.2〜4.0kg |
| 状態コメント | 脂のり最高。今年一番の出来 |
| 在庫数 | 40 |
| 価格 | 4,800円 |

フォームを送信すると Notion Webhook → Next.js API → Claude → 配信まで自動で流れる。

## コストと時間

**APIコスト（1回の初物案内生成）**

| 項目 | 数値 |
|------|------|
| 入力トークン | 約600 |
| 出力トークン | 約350 |
| 1回のコスト | 約0.4円 |

**時間比較**

| 作業 | Before（手書き） | After（Claude） |
|------|-----------------|----------------|
| メール文面作成 | 30〜60分 | 3分（フォーム入力のみ） |
| LINE用短縮版作成 | 別途10分 | 同時生成 |
| 仕入れ当日に配信できる率 | 40%（後回しになることが多い） | 95% |

## ポイントと工夫

**「初物感」を引き出すプロンプトのコツ**

単に「案内メールを書いて」だと平凡な商品説明になる。

- `漁師さんの名前・産地を入れてストーリーを出す` → 固有名詞が入ると読者の頭に絵が浮かぶ
- `在庫数40本以下は「限定」を使う` → 数字をトリガーにすることで希少感の出し方を制御できる
- `押しつけがましい売り文句は避ける` → これがないと「今すぐご注文ください！」系の文になりがち

**LINE用短縮版を同時生成する**

メール本文と別のプロンプトにすると2倍のコストがかかる。同一レスポンスのJSONに含めることで1回で済む。

**Shopifyの在庫二重チェック**

フォーム入力の在庫数は業者さんの手入力なので誤りがある。配信前にShopify APIで確認することで「在庫0なのにメールが届いた」事故を防ぐ。

## 実際の業者さんの声

「今まで、いい魚が入っても"メール書く時間がない"って後回しにしてた。今朝は漁港から帰ってフォームを入れたら昼前には配信が終わってた。初物って鮮度感が命だから、こういう速さが一番大事」

前回の秋鮭初物メール（昨年手書き版）は2日後に配信して開封率22%。今年の即日版は開封率34%だった。

## まとめ

「初物」の情報は入荷当日が一番価値がある。でも現場は忙しく、メールを書く時間が取れないケースが多い。

仕入れ情報を構造化してClaudeに渡すだけで、旬感・ストーリー・希少感を兼ね備えたメール文面が3分で手に入る。コストは0.4円。スマホフォームと組み合わせることで、漁港から帰ってすぐ配信できる体制が整った。

秋鮭以外にも、毛ガニ・牡蠣・ホタルイカなど「旬が短く、入荷日が予測しにくい」商品全般に応用できる。

コード・カスタマイズ相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
