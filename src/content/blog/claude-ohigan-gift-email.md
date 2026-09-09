---
title: "Claude APIで秋のお彼岸ギフト向けメールを自動生成した話【三陸水産EC】"
description: "9月20〜26日のお彼岸シーズンは帰省・法要ギフトの需要がある。一律の「お彼岸特集」メールでは反応が薄かったのを、Claude APIで購入履歴・家族構成に合わせてパーソナライズしたら開封率が2.3倍になった話。"
pubDate: 2026-09-08
author: sam
category: "Claude活用"
tags: ["Claude", "お彼岸", "ギフト", "メール", "パーソナライズ", "水産EC", "三陸"]
readingTime: 9
---

## お彼岸ギフトは「ニッチだけど確実にある需要」

春のお彼岸（3月）、秋のお彼岸（9月）。

仏事のお供え・帰省みやげ・法要後の手土産として、産地直送の海産物はちょうどいいポジションにある。「高すぎず、かといって普通のスーパーでは買えない」という価格帯と希少性が、ギフトとして刺さる。

ただ、お彼岸向けのメールは今まであまり力を入れていなかった。一律で「秋のお彼岸ギフト特集」を送るだけで、クリック率は2〜3%止まり。

業者さんから聞いた話：「お彼岸って、どんな方へ送るかがバラバラなんです。お供え用の人もいれば、実家への手土産の人も、法事の引き出物にしたい人もいる。全員に同じメールを送っても、ピンとこないのかも」

この言葉をヒントに、Claude APIで送る相手に合わせたメールを生成する仕組みを作った。

## 作ったもの

顧客の購入履歴と属性（推定）から：
- お供え向け（仏壇用・法要用）
- 帰省手土産向け（実家・義実家向け）
- 自宅用・季節を楽しみたい層

の3パターンに分類し、それぞれ異なる訴求軸でメールを生成して送るシステム。

## 実装コード

### 1. 顧客セグメント分類

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface CustomerProfile {
  customerId: string;
  firstName: string;
  purchaseHistory: Array<{
    productName: string;
    giftWrapping: boolean;
    deliveryAddress: 'self' | 'other';  // 自宅か別住所か
    message?: string;  // ギフトメッセージの有無
    month: number;
  }>;
  estimatedAge?: number;
  registeredAddress: string;  // 都市部か地方か
}

type OhiganSegment = 'memorial' | 'homecoming' | 'self';

async function classifyOhiganSegment(
  customer: CustomerProfile
): Promise<OhiganSegment> {
  const historyText = customer.purchaseHistory
    .map(
      (p) =>
        `${p.month}月：${p.productName}（ギフト包装:${p.giftWrapping ? 'あり' : 'なし'}、配送先:${p.deliveryAddress === 'other' ? '別住所' : '自宅'}、メッセージ:${p.message ? 'あり' : 'なし'}）`
    )
    .join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content: `水産ECの顧客データから、お彼岸メールのセグメントを判定してください。

【顧客情報】
- 名前：${customer.firstName}様
- 推定年齢：${customer.estimatedAge ? `${customer.estimatedAge}代` : '不明'}
- 登録住所：${customer.registeredAddress}

【購入履歴】
${historyText}

【セグメント定義】
- memorial：法要・仏壇のお供え目的（別住所への送付が多い、3月/9月に購入、メッセージカードの使用など）
- homecoming：帰省手土産目的（都市部在住、実家等への送付がある）
- self：自分用・ご家族用の季節の味覚として購入

JSON形式のみで出力してください：
{"segment": "memorial" | "homecoming" | "self", "confidence": 0.0〜1.0, "reason": "判定理由（日本語30文字以内）"}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) return 'self';

  const result = JSON.parse(jsonMatch[0]) as {
    segment: OhiganSegment;
    confidence: number;
  };
  return result.confidence >= 0.6 ? result.segment : 'self';
}
```

### 2. セグメント別メール生成

```typescript
interface OhiganEmailContent {
  subject: string;
  preheader: string;  // メールクライアントのプレビュー文
  body: string;
  recommendedProducts: string[];
}

async function generateOhiganEmail(
  customer: CustomerProfile,
  segment: OhiganSegment
): Promise<OhiganEmailContent> {
  const segmentInstructions: Record<OhiganSegment, string> = {
    memorial: `
【訴求軸】仏事・法要のお供えとして
- 「故人が好きだった海のもの」「先祖への感謝を込めて」などのフレーズが刺さる
- 熨斗・のしがけ対応・個包装など、仏事に配慮した包装オプションを強調
- 「お供え」「御霊前」「御供」などの熨斗表記に対応していることを明記
- 三陸の海の豊かさ＝自然への感謝というトーンに寄せる
- おすすめ商品：塩数の子・昆布巻き・乾物セットなど日持ちする商品`,

    homecoming: `
【訴求軸】帰省・実家への手土産として
- 「都会では買えない本物の味」「親への感謝の気持ち」で刺さる
- 持ち帰りやすい（常温・冷凍で輸送可能）点を強調
- 「実家の両親・義父母に喜ばれた」というリアリティ
- 産地直送ならではの鮮度・希少性をアピール
- おすすめ商品：海産物詰め合わせ・乾物ギフトセット・鮭切り身など`,

    self: `
【訴求軸】秋の味覚・季節を楽しむ
- お彼岸の時期は秋の魚が最盛期というタイミングの良さを伝える
- 「自分へのご褒美」「家族で秋の食卓を」というトーン
- 旬の魚の美味しさ・料理レシピのヒントを添える
- お彼岸という特別感より「今が旬」という食欲訴求
- おすすめ商品：秋鮭・秋刀魚・戻り鰹など旬の鮮魚`,
  };

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `三陸・気仙沼の水産ECサイトとして、お彼岸向けメールを書いてください。

【送り先】
${customer.firstName}様（${segment === 'memorial' ? '法要・仏事用途' : segment === 'homecoming' ? '帰省手土産用途' : '自宅用・季節楽しみ'}と推定）

【セグメント別指示】
${segmentInstructions[segment]}

【共通ルール】
- 件名：30文字以内、お彼岸を直接的に押しつけない
- プレビュー文（preheader）：40文字以内、件名の補足
- 本文：250〜350文字
  - 「${customer.firstName}様」で始める
  - 売り込み感を出さず、季節の挨拶から自然につなぐ
  - 三陸の海・旬の素材への敬意を感じるトーン
  - 商品紹介は1〜2種にとどめる
  - 最後に「ご不明な点はお気軽にどうぞ」一言
  - 署名は「三陸直送 気仙沼チーム」

【おすすめ商品（本文に1〜2種を自然に組み込む）】
セグメントに合わせた商品を3種リストアップもしてください。

JSON形式のみで出力：
{
  "subject": "...",
  "preheader": "...",
  "body": "...",
  "recommendedProducts": ["商品A", "商品B", "商品C"]
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON parse failed');

  return JSON.parse(jsonMatch[0]) as OhiganEmailContent;
}
```

### 3. バッチ送信ロジック

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

async function sendOhiganCampaign(customers: CustomerProfile[]): Promise<void> {
  const results = {
    memorial: 0,
    homecoming: 0,
    self: 0,
    failed: 0,
  };

  for (const customer of customers) {
    try {
      // セグメント判定
      const segment = await classifyOhiganSegment(customer);

      // メール生成
      const email = await generateOhiganEmail(customer, segment);

      // 送信
      await transporter.sendMail({
        from: '"気仙沼チーム" <hello@example.com>',
        to: `${customer.firstName} <customer@example.com>`,
        subject: email.subject,
        text: email.body,
        headers: {
          'X-Preheader': email.preheader,
        },
      });

      results[segment]++;

      // APIレート制限を考慮して少し待機
      await new Promise((resolve) => setTimeout(resolve, 200));
    } catch (err) {
      console.error(`送信失敗: ${customer.customerId}`, err);
      results.failed++;
    }
  }

  console.log('送信完了:', results);
}
```

### 4. 実際の出力例

**memorialセグメント（法要・仏事用）の場合**

```
件名：
三陸の海の恵みを、大切な方へ

プレビュー文：
熨斗・のしがけ対応、個包装でお届けします

本文：
田中様

秋の彼岸の時期を迎えました。
この季節、三陸の海は秋鮭・秋刀魚・数の子と、
一年でもっとも実りある時期です。

故人が好まれた海のものを、
産地直送でお届けできればと思いご案内しております。
「塩数の子 御供セット」「昆布巻きギフト」は
熨斗がけ・のし紙対応で、個包装でお届けします。

法要の手配でお忙しい時期かと存じますが、
包装・のし表記などご不明な点はお気軽にどうぞ。

三陸直送 気仙沼チーム
```

**homecomingセグメント（帰省手土産用）の場合**

```
件名：
秋の実家帰りに、三陸の本物を

プレビュー文：
都会では買えない旬の味、冷凍便でそのままお届け

本文：
佐藤様

お彼岸の時期、実家に帰省される方も多い季節ですね。

「三陸の海産物を手土産にしたい」とよくご相談いただきますが、
今年の秋鮭は9月上旬から水揚げが始まり、例年より脂のりが良いです。
「秋鮭切り身ギフトセット」は冷凍便なので
新幹線での持ち帰りをお待たせせず、直接ご実家へお届けも可能です。

ご両親・義ご両親への感謝の気持ちを
三陸の海から届けませんか。
配送日時の調整などお気軽にご相談ください。

三陸直送 気仙沼チーム
```

## コストと効果

**APIコスト試算（1通あたり）**

| 項目 | セグメント分類 | メール生成 | 合計 |
|------|------|------|------|
| 入力トークン | 約400 | 約600 | 約1,000 |
| 出力トークン | 約100 | 約500 | 約600 |
| 費用（約） | 0.2円 | 0.45円 | 0.65円 |

200人に送って130円。セグメント別送信を手作業でやろうとすると数時間かかるのが、実行時間40分（API待機込み）で完了する。

**お彼岸キャンペーンの結果（秋の実施）**

| 指標 | 一律送信（昨年） | セグメント別（今年） |
|------|------|------|
| 開封率 | 24% | 55% |
| クリック率 | 2.8% | 11.3% |
| 注文転換率 | 0.9% | 4.2% |
| キャンペーン売上 | 約82,000円 | 約310,000円 |

業者さんの感想：「memorialの人に『熨斗がけ対応』って書いてあるだけで問い合わせが減った。それだけで安心するんだと思う」

## ポイントと注意点

**うまくいった点**
- セグメント分類の精度が思ったより高かった（購入履歴の別住所送付がmemorial判定に効く）
- プレビュー文（preheader）に具体的な情報を入れることで開封率が上がった
- 「売り込まない」トーンを徹底したことで返信（問い合わせ）が増えた

**改善したい点**
- 購入履歴が少ない新規顧客はselfセグメント判定になりがち（デフォルト扱い）
- 法要の日程は読み取れないので、法要後の「引き出物」需要は拾えていない

**注意点**
- 仏事関連は「ご愁傷様」「お悔やみ」などの表現は使わない（受け取り方がバラバラ）
- 熨斗・のしがけの表記ミスはクレームになるので、オペレーション側の確認フローを別途設ける
- 配信停止（unsubscribe）リンクは必ず含める

## まとめ

お彼岸は「ニッチ」な季節需要だと思っていたが、顧客の用途が多様なだけで、刺さるメッセージは確実にある。

法要用途の人に「旬の秋刀魚が美味しいですよ」は完全にすれ違い。帰省手土産を探している人に「個包装で大切な方へ」も少しずれている。

購入履歴を使ったセグメント分類は実装コストが低い割に効果が大きい。Claude APIのセグメント判定精度は完璧ではないが「方向性が合っていれば開封率は上がる」という実感があった。

コード・カスタマイズ相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
