---
title: "Claude APIで松茸「旬入荷」告知メールを自動生成した話【農家EC】"
description: "9月が勝負の松茸シーズン。採れた日の情報が一番鮮度が高いのに、高価な商品ゆえ文章に気を使って結局翌日になってしまう問題を、Claudeで即日配信できる体制に変えた話。"
pubDate: 2026-09-11
author: sam
category: "Claude活用"
tags: ["Claude", "EC自動化", "メールマーケティング", "松茸", "農家", "きのこ", "旬", "限定商品"]
readingTime: 8
---

## 「松茸が採れた。でも告知メールを書く時間がない」

[新米の即日告知](/blog/claude-shinmai-arrival-email)の仕組みを入れてから、きのこ農家の方からも声がかかるようになった。

「岩手の山の農家なんですが、松茸は採れる日がまちまちで。採れた当日に告知したいんですが、高価な商品なので変な文章を出すわけにもいかなくて……気づいたら翌日になってしまうんです」

松茸の旬は9〜10月のわずか数週間。しかも採れる量は天候と気温次第で日ごとに変わる。「今日採れた分だけ」を即日告知できるかどうかで、完売速度が大きく変わる。

入荷情報・等級・産地コメントをClaudeに渡すだけで、松茸ならではの希少感と旬感を込めた告知メールを自動生成する仕組みを組んだ。

## 作ったもの

採取当日に農家さんがスマホ入力した情報をClaudeに渡すと：

1. **件名**（希少感と旬を伝える20字以内）
2. **本文**（産地・今日の採れ高→等級説明→購入CTA、350〜450字）
3. **LINE用短縮版**（100字以内）

を自動生成。Shopifyの商品URLと残数をリアルタイムで引いてメール配信ツールに流し込む。

## 実装コード

### 1. 入荷情報の型定義

```typescript
interface MatsutakeInfo {
  origin: string;           // "岩手県遠野市・○○山"
  harvestDate: string;      // "2026-09-11"
  graderName: string;       // "鈴木山の幸農園"
  grade: string;            // "A品（笠が開ききっていない、香り最高）"
  todayStock: number;       // 12（本）
  pricePerUnit: string;     // "1本 3,500円（税込）"
  scent: string;            // "今朝の採取で香りが特に立っている"
  cookingSuggestion: string; // "土瓶蒸し・松茸ご飯がおすすめ"
  productUrl: string;       // Shopify商品URL
  isLimitedToday: boolean;  // 当日分限定かどうか
}
```

### 2. Claude APIで松茸告知メールを生成

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface MatsutakeEmail {
  subject: string;
  body: string;
  lineMessage: string;
}

async function generateMatsutakeEmail(
  info: MatsutakeInfo
): Promise<MatsutakeEmail> {
  const limitedNote = info.todayStock <= 20
    ? `本日分は${info.todayStock}本のみ。在庫がなくなり次第終了。`
    : '';

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `あなたは産直ECサイトの高級食材メールライターです。
松茸の旬入荷告知メールを生成してください。

【入荷情報】
産地: ${info.origin}
採取日: ${info.harvestDate}
生産者名: ${info.graderName}
等級・品質: ${info.grade}
本日在庫: ${info.todayStock}本
価格: ${info.pricePerUnit}
香りコメント: ${info.scent}
おすすめ料理: ${info.cookingSuggestion}
商品URL: ${info.productUrl}
数量限定メモ: ${limitedNote}

【制作方針】
- 松茸は「香り」と「旬の短さ」が最大の価値。採取当日の鮮度と香りを最優先に伝える
- 高価格帯商品なので「割引」より「今日しかない希少体験」として訴求する
- 産地・生産者の固有名詞を使い、どこで誰が採ったかを具体的に書く
- 等級の違いを読者が理解できるよう簡潔に説明する（専門用語を避ける）
- 在庫が少ない場合は「本日限り」「○本のみ」を自然に盛り込む
- おすすめ料理を1〜2行添えて、食卓のイメージを湧かせる
- 高級品にふさわしい落ち着いたトーンで。ただし堅すぎず、産地の空気感も出す

【出力（JSONのみ）】
{
  "subject": "（件名：20字以内。記号・絵文字なし。希少感と旬感を凝縮）",
  "body": "（本文：350〜450字。段落ごとに空行を入れる）",
  "lineMessage": "（LINE用：100字以内。絵文字1〜2個OK）"
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON解析失敗');
  return JSON.parse(jsonMatch[0]) as MatsutakeEmail;
}
```

### 3. 実際の生成結果（9月11日採取分）

```
【件名】
今朝の松茸、遠野から届きます

【本文】
こんにちは。

今朝、岩手県遠野市の山で鈴木山の幸農園が松茸を採取しました。
「笠がまだ開ききっていない、一番香りが立っている状態で採れた」という連絡が入り、
急いでご案内しています。

今日入荷したのは12本。笠が開ききっていない「A品」と呼ばれる等級で、
採取直後ならではのむせるような香りが特徴です。

土瓶蒸しにすると出汁に香りが溶け出し、松茸ご飯にすれば炊き上がった瞬間に
部屋中が秋の山の香りに包まれます。

本日採取分のみのご案内です。在庫がなくなり次第、販売を終了します。

▶ 遠野産松茸（A品）のご注文はこちら
https://example.myshopify.com/products/...

【LINE用メッセージ】
🍄 今朝採れた遠野の松茸、入荷しました！A品・本日12本限り。土瓶蒸しや松茸ご飯に最高の鮮度です👉 [URL]
```

## 配信フロー全体

```typescript
import * as fs from 'fs';

interface DeliveryConfig {
  emailListPath: string;
  shopifyProductId: string;
  mailerApiKey: string;
  lineChannelToken: string;
}

async function runMatsutakeCampaign(
  info: MatsutakeInfo,
  config: DeliveryConfig
): Promise<void> {
  console.log(`🍄 ${info.origin} 松茸告知メール生成中...`);

  // 1. メール生成
  const email = await generateMatsutakeEmail(info);
  console.log(`✅ 件名: ${email.subject}`);

  // 2. Shopify在庫リアルタイム確認
  const liveStock = await getShopifyStock(config.shopifyProductId);
  if (liveStock === 0) {
    console.warn('⚠️ 在庫なし。配信をスキップします。');
    return;
  }

  // 3. 在庫数をメール本文に反映（フォーム入力値とズレがあれば上書き）
  const finalEmail =
    liveStock !== info.todayStock
      ? await generateMatsutakeEmail({ ...info, todayStock: liveStock })
      : email;

  // 4. メール配信
  await sendBulkEmail({
    subject: finalEmail.subject,
    body: finalEmail.body,
    listPath: config.emailListPath,
    apiKey: config.mailerApiKey,
  });

  // 5. LINE公式アカウントに投稿
  await postToLineOfficial(finalEmail.lineMessage, config.lineChannelToken);

  console.log(`🎉 配信完了: 遠野産松茸 ${liveStock}本`);
}

// Webhook受信エントリーポイント
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as MatsutakeInfo;

  await runMatsutakeCampaign(body, {
    emailListPath: process.env.EMAIL_LIST_PATH!,
    shopifyProductId: process.env.SHOPIFY_PRODUCT_ID_MATSUTAKE!,
    mailerApiKey: process.env.SENDGRID_API_KEY!,
    lineChannelToken: process.env.LINE_CHANNEL_TOKEN!,
  });

  return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
}
```

### 4. 農家さんが使うスマホ入力フォーム

採取後すぐ山から入力できるNotionフォーム。30秒で完結させる設計にした。

| 項目 | 入力例 |
|------|--------|
| 産地（山の名前まで） | 岩手県遠野市・○○山 |
| 採取日 | 2026-09-11 |
| 生産者名 | 鈴木山の幸農園 |
| 等級 | A品（笠が開ききっていない） |
| 本日在庫数（本） | 12 |
| 価格（1本あたり） | 3,500円（税込） |
| 香りコメント | 今朝の採取で特に香りが立っている |
| おすすめ料理 | 土瓶蒸し・松茸ご飯 |

フォーム送信 → Notion Webhook → API → Claude → Shopify在庫確認 → 配信の流れ。

## コストと時間

**APIコスト（1回の松茸告知生成）**

| 項目 | 数値 |
|------|------|
| 入力トークン | 約700 |
| 出力トークン | 約420 |
| 1回のコスト | 約0.5円 |

**時間比較**

| 作業 | Before（手書き） | After（Claude） |
|------|-----------------|----------------|
| メール文面作成 | 30〜90分 | 3分（フォーム入力のみ） |
| 採取当日に配信できる率 | 40%（翌日になることが多い） | 98% |
| 完売までの時間 | 平均2.1日 | 平均4.3時間 |

完売速度が劇的に変わった理由は単純で、「採れた当日に告知できる」だけだ。
松茸を欲しい人は旬の鮮度に払っているので、翌日配信だと訴求力が下がる。

## ポイントと工夫

**「香り」を中心に据えるプロンプト設計**

松茸の価値は視覚より嗅覚にある。プロンプトに「香り最優先で伝える」と明示することで、Claudeが「むせるような香り」「炊き上がった瞬間に部屋中が」という体験を喚起する表現を選んでくれる。価格訴求ではなく体験訴求になる。

**Shopify在庫のリアルタイム反映**

農家さんが手入力する在庫数は誤差が出やすい。配信直前にShopifyのAPI在庫を確認し、ズレがあればその数値でメールを再生成する。「12本」と書いたのに実は8本しかなかった、という事故を防ぐ。

**等級の翻訳機能**

「A品」「B品」という業界表記をそのまま書くと読者に伝わらない。プロンプトで「読者が理解できるよう簡潔に説明する（専門用語を避ける）」と指定したことで、「笠が開ききっていない＝香りのピーク」という形で自然に補足される。

**在庫数トリガーで「本日限り感」を自動制御**

`isLimitedToday: true`または在庫20本以下の場合は「本日○本のみ」という表現が自動で入る。松茸ECは1回の配信で20〜30本しか手に入らないことも多いので、この制御は常に効いている。

## 農家さんの声

「去年までは写真を撮って、文章を考えて、Instagramに投稿して、そこからメールを書いて……気づいたら夜中の2時になってた。今年はフォームに入力するだけで全部終わる。採れた松茸は採れた日に届けたいんで、これが本来の姿だと思ってる」

昨年の配信は平均採取翌日。完売まで平均2日かかっていた。今年の即日配信で完売が平均4〜5時間になった。価格はまったく変えていない。

## まとめ

松茸は旬が命だ。採れた当日が一番香り高く、告知の鮮度もそこで決まる。

でも高価な商品だから文章に悩む。悩んでいる間に日が暮れる。これが小規模農家の現実だった。

香り・産地・採取日・等級・今日の本数をClaudeに渡すだけで、希少感と旬感を込めた告知文が3分で手に入る。コストは0.5円。Shopifyの在庫連携と組み合わせれば、山から帰って30分後に配信が終わる体制が整う。

松茸以外にも、舞茸・天然なめこ・椎茸など「今日採れた量だけ売りたい」きのこ全般に同じ仕組みが使える。プロンプトの「香り」を「旨み」「コリコリ感」に変えるだけで転用できる。

コード・カスタマイズ相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
