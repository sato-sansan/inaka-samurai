---
title: "Claude APIでカニ漁解禁前キャンペーンを丸ごと仕込んだ話【三陸水産EC】"
description: "11月のズワイガニ漁解禁に向けて9月から準備を始めた。在庫予測・ギフトセット企画・LP用コピー・先行予約メール・SNS投稿をClaudeに一括生成させた4フェーズの実装とプロンプト設計のポイントを公開する。"
pubDate: 2026-09-21
author: sam
category: "Claude活用"
tags: ["Claude", "EC自動化", "メールマーケティング", "カニ", "季節キャンペーン", "水産業", "SNS", "Shopify"]
readingTime: 11
---

## 「カニの解禁って、いつでしたっけ」

9月の下旬、業者さんから電話が来た。

「もう10月になりますよね。去年カニの予約受付をいつ始めたかを調べたら11月3日になってて、完全に出遅れたんですよ。今年は早めに動きたくて。ただ、カニって高いので変なコピーを使うと品が落ちる気がして……」

気持ちはよくわかる。ズワイガニは北陸では11月6日（山陰では11月1日）が底曳き網漁の解禁日。三陸では松島湾のガザミや花咲ガニの時期がやや異なるが、「カニ＝冬の最高級品」というイメージはお客さんの中に根付いている。だから雑に打ち出せない。

**「品を落とさず、でも予約を早めに確保する」という両立をClaudeに任せた。**

## 作ったもの

4フェーズをClaude APIに任せた。

1. **先行予約向けギフトセットの企画**（価格帯・用途別で3〜4案）
2. **LP用コピーの生成**（ファーストビュー・セット説明・FAQ）
3. **先行予約メールの生成**（早期特典メール・解禁直前アラート）
4. **X・Instagram投稿文の生成**（解禁前の期待感を高めるコンテンツ）

## 実装コード

### 1. 型定義とカニの在庫予測データ

```typescript
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';

const client = new Anthropic();

interface CrabProduct {
  id: string;
  name: string;
  unitPrice: number;
  weightGram: number;
  category: 'ズワイガニ' | '毛ガニ' | '花咲ガニ' | 'タラバガニ';
  origin: string;
  availableFrom: string;   // 解禁・入荷予定日
  expectedStock: number;   // 入荷予定数
  giftRank: 'S' | 'A' | 'B';
  features: string[];
}

const CRAB_PRODUCTS: CrabProduct[] = [
  {
    id: 'C001',
    name: '三陸産 活ズワイガニ（800g前後・1杯）',
    unitPrice: 5800,
    weightGram: 800,
    category: 'ズワイガニ',
    origin: '三陸沖',
    availableFrom: '2026-11-06',
    expectedStock: 80,
    giftRank: 'A',
    features: ['活け締め', '甘い', '繊維質な身', '鍋・焼き・刺しどれでも'],
  },
  {
    id: 'C002',
    name: '北海道産 毛ガニ（400g前後・1杯）',
    unitPrice: 4200,
    weightGram: 400,
    category: '毛ガニ',
    origin: '北海道・根室沖',
    availableFrom: '2026-10-20',
    expectedStock: 60,
    giftRank: 'A',
    features: ['濃厚なカニ味噌', 'かにみそが最大の魅力', 'ギフト定番'],
  },
  {
    id: 'C003',
    name: '北海道産 花咲ガニ（700g前後・1杯）',
    unitPrice: 6800,
    weightGram: 700,
    category: '花咲ガニ',
    origin: '北海道・根室沖',
    availableFrom: '2026-10-15',
    expectedStock: 30,
    giftRank: 'S',
    features: ['希少', '濃厚な旨味', '花のように開く爪', '贈答向き最高峰'],
  },
  {
    id: 'C004',
    name: 'ズワイガニ脚むき身（500g・冷凍）',
    unitPrice: 3800,
    weightGram: 500,
    category: 'ズワイガニ',
    origin: '三陸沖加工',
    availableFrom: '2026-11-06',
    expectedStock: 200,
    giftRank: 'B',
    features: ['調理済み', 'すぐ使える', 'コスパ高い', 'サラダ・パスタにも'],
  },
  {
    id: 'C005',
    name: '三陸産 ズワイガニ姿（1kg・冷凍）',
    unitPrice: 7800,
    weightGram: 1000,
    category: 'ズワイガニ',
    origin: '三陸沖',
    availableFrom: '2026-11-06',
    expectedStock: 50,
    giftRank: 'S',
    features: ['贈答用', '箱入り', '食卓映え', '1kg超のボリューム感'],
  },
];
```

### 2. ギフトセットを企画させる

```typescript
interface CrabGiftSet {
  setName: string;
  tagline: string;
  targetOccasion: string;   // 用途（歳暮・自宅用・手土産など）
  items: Array<{ id: string; quantity: number }>;
  setPrice: number;
  priceTier: 'プレミアム' | 'スタンダード' | 'カジュアル';
  seasonalAngle: string;    // 冬・解禁・旬など訴求軸
  targetCustomer: string;
}

async function planCrabGiftSets(
  products: CrabProduct[],
  count: number
): Promise<CrabGiftSet[]> {
  const productList = products
    .filter((p) => p.expectedStock >= 20)
    .map(
      (p) =>
        `ID:${p.id} / ${p.name} / ¥${p.unitPrice.toLocaleString()} / ` +
        `ランク:${p.giftRank} / 入荷予定:${p.availableFrom} / ` +
        `特徴:${p.features.join('・')}`
    )
    .join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 3000,
    messages: [
      {
        role: 'user',
        content: `三陸水産ECのカニ漁解禁キャンペーン向けギフトセットを${count}種類提案してください。

【商品一覧】
${productList}

【条件】
- 11月の解禁直後から12月末の歳暮シーズンまで使えるセット構成
- 「カニ＝高級品」という品格を保ちながら予約を早期化する訴求
- プレミアム（1万円超）・スタンダード（5〜1万円）・カジュアル（5千円以下）を網羅
- セット名は15文字以内。「三陸」「北海道」など産地名を入れる
- セット価格は単品合計より10〜15%お得に設定

【出力（JSONの配列のみ）】
[
  {
    "setName": "セット名",
    "tagline": "キャッチコピー（〜40文字）",
    "targetOccasion": "想定利用シーン（〜60文字）",
    "items": [{ "id": "商品ID", "quantity": 数量 }],
    "setPrice": セット価格（税込）,
    "priceTier": "プレミアム" or "スタンダード" or "カジュアル",
    "seasonalAngle": "季節的訴求軸（〜50文字）",
    "targetCustomer": "対象顧客像（〜60文字）"
  }
]`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '[]';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('ギフトセット企画のJSON解析失敗');
  return JSON.parse(jsonMatch[0]) as CrabGiftSet[];
}
```

### 3. LPコピーを生成する

```typescript
interface CrabLpCopy {
  heroHeadline: string;      // ファーストビューのキャッチ
  heroSubcopy: string;       // サブコピー
  setDescriptions: Array<{
    setId: string;
    h2: string;
    body: string;
    bulletPoints: string[];
  }>;
  faq: Array<{ question: string; answer: string }>;
  ctaText: string;           // ボタンテキスト
  urgencyNote: string;       // 数量限定・締め切り文
}

async function generateLpCopy(
  sets: CrabGiftSet[],
  openingDate: string,
  reservationDeadline: string
): Promise<CrabLpCopy> {
  const setsSummary = sets
    .map(
      (s) =>
        `セット名:${s.setName} / タグライン:${s.tagline} / 価格:¥${s.setPrice.toLocaleString()} / ` +
        `用途:${s.targetOccasion} / 訴求:${s.seasonalAngle}`
    )
    .join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 3500,
    messages: [
      {
        role: 'user',
        content: `三陸水産ECのカニ漁解禁キャンペーンLP用コピーを生成してください。

【キャンペーン情報】
- 漁解禁日：${openingDate}
- 先行予約締め切り：${reservationDeadline}
- セット一覧：
${setsSummary}

【コピーの方針】
- 「高級感・旬・三陸の産地信頼」を前面に出す
- 安売り感・焦りを煽る表現を避ける（カニのブランド価値を守る）
- 「今だから先行予約する合理的な理由」を提示する
  （数量限定・解禁直後の新鮮な個体を確保できる、など）
- FAQは2〜3問。「配送方法」「鮮度」「キャンセル」に答える

【出力（JSONのみ）】
{
  "heroHeadline": "ファーストビューのキャッチコピー（20文字以内）",
  "heroSubcopy": "サブコピー（〜60文字）",
  "setDescriptions": [
    {
      "setId": "セット名（キーとして使用）",
      "h2": "セクション見出し（〜30文字）",
      "body": "本文（200〜300文字）",
      "bulletPoints": ["箇条書き1", "箇条書き2", "箇条書き3"]
    }
  ],
  "faq": [
    { "question": "Q", "answer": "A（〜150文字）" }
  ],
  "ctaText": "CTAボタンのテキスト（〜20文字）",
  "urgencyNote": "数量限定・締め切り等の補足（〜50文字）"
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('LPコピーのJSON解析失敗');
  return JSON.parse(jsonMatch[0]) as CrabLpCopy;
}
```

### 4. 先行予約メールとSNS投稿を生成する

```typescript
interface CrabCampaignEmails {
  preReservation: { subject: string; body: string };  // 先行予約開始
  openingDay: { subject: string; body: string };       // 解禁当日
  lastCall: { subject: string; body: string };          // 在庫残りわずか
}

interface CrabSnsContent {
  xPreReservation: string;
  xOpeningDay: string;
  xHashtags: string;
  instagramCaption: string;
  instagramHashtags: string;
}

async function generateEmailsAndSns(
  sets: CrabGiftSet[],
  openingDate: string,
  reservationDeadline: string
): Promise<{ emails: CrabCampaignEmails; sns: CrabSnsContent }> {
  const setsSummary = sets
    .map(
      (s) => `・${s.setName}（¥${s.setPrice.toLocaleString()}）：${s.tagline}`
    )
    .join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 3500,
    messages: [
      {
        role: 'user',
        content: `三陸水産ECのカニ解禁キャンペーン用のメール3種とSNS投稿を作成してください。

【キャンペーン情報】
- 漁解禁日：${openingDate}
- 先行予約締め切り：${reservationDeadline}
- ラインナップ：
${setsSummary}

【メール3種のルール】
1. 先行予約開始メール（10月中旬・解禁3週間前）：
   - 先行予約の特典（早期確保・数量保証）を伝える
   - 過度な焦りを煽らず、産地の安心感を前面に
2. 解禁当日メール：
   - 「今日解禁になりました」という旬の臨場感
   - 注文〜お届けまでのイメージを具体的に描写
3. 在庫残りわずかメール（在庫20%時点）：
   - 「いくつか残っています」程度の丁寧な表現
   - 無理に煽らない

【共通ルール】
- 件名は30文字以内
- 本文300〜400文字
- 産地（三陸・北海道・根室など）の言葉を必ず入れる
- URLプレースホルダーは {{shop_url}}

【SNS】
- X投稿（先行予約告知用・解禁当日用）は各120文字以内
- Xハッシュタグ：5〜6個
- Instagramキャプション：220文字以内
- Instagramハッシュタグ：8〜10個

【出力（JSONのみ）】
{
  "emails": {
    "preReservation": { "subject": "件名", "body": "本文" },
    "openingDay":     { "subject": "件名", "body": "本文" },
    "lastCall":       { "subject": "件名", "body": "本文" }
  },
  "sns": {
    "xPreReservation": "X先行予約告知文",
    "xOpeningDay":     "X解禁当日投稿文",
    "xHashtags":       "ハッシュタグ（スペース区切り）",
    "instagramCaption": "Instagramキャプション",
    "instagramHashtags": "ハッシュタグ（スペース区切り）"
  }
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('メール・SNSのJSON解析失敗');
  return JSON.parse(jsonMatch[0]) as {
    emails: CrabCampaignEmails;
    sns: CrabSnsContent;
  };
}
```

### 5. 実行スクリプト

```typescript
async function main() {
  console.log('🦀 カニ漁解禁キャンペーン自動生成開始...\n');

  const openingDate = '2026年11月6日（金）';
  const reservationDeadline = '2026年10月31日（土）23:59';

  console.log('📦 ギフトセットを企画中...');
  const sets = await planCrabGiftSets(CRAB_PRODUCTS, 3);

  sets.forEach((s, i) => {
    console.log(`\n【案${i + 1}】${s.setName}（${s.priceTier}）`);
    console.log(`  タグライン: ${s.tagline}`);
    console.log(`  用途: ${s.targetOccasion}`);
    console.log(`  訴求: ${s.seasonalAngle}`);
    console.log(`  価格: ¥${s.setPrice.toLocaleString()}`);
  });

  console.log('\n📄 LPコピーを生成中...');
  const lp = await generateLpCopy(sets, openingDate, reservationDeadline);
  console.log(`\nヒーローキャッチ: ${lp.heroHeadline}`);
  console.log(`サブコピー: ${lp.heroSubcopy}`);
  console.log(`CTA: ${lp.ctaText}`);
  console.log(`緊急性メモ: ${lp.urgencyNote}`);

  console.log('\n✉️ メール・SNSを生成中...');
  const { emails, sns } = await generateEmailsAndSns(
    sets,
    openingDate,
    reservationDeadline
  );

  console.log('\n--- 先行予約メール ---');
  console.log(`件名: ${emails.preReservation.subject}`);
  console.log(`本文:\n${emails.preReservation.body}`);

  console.log('\n--- 解禁当日メール ---');
  console.log(`件名: ${emails.openingDay.subject}`);
  console.log(`本文:\n${emails.openingDay.body}`);

  console.log('\n--- X先行予約投稿 ---');
  console.log(sns.xPreReservation);
  console.log(sns.xHashtags);

  console.log('\n--- Instagramキャプション ---');
  console.log(sns.instagramCaption);

  const output = { sets, lp, emails, sns };
  fs.writeFileSync(
    'crab-season-campaign-2026.json',
    JSON.stringify(output, null, 2),
    'utf-8'
  );
  console.log('\n✅ crab-season-campaign-2026.json に保存完了');
}

main().catch(console.error);
```

## 実際に生成された内容

### ギフトセット企画案（出力例）

```
【案1】三陸カニ三昧セット（プレミアム）
  タグライン: 旬の産地から、三陸の冬を丸ごと届ける
  用途: 年末の歳暮・特別な人への贈答・自宅の豪華な食卓に
  訴求: 解禁直後だけ手に入る旬の個体を先行予約で確保

【案2】北三陸 毛×花咲セット（スタンダード）
  タグライン: カニ味噌と希少な花咲が一箱に
  用途: 家族でのカニ鍋・帰省土産・社内ギフトに
  訴求: 花咲ガニは根室産のみ・シーズン入荷数わずか

【案3】三陸ズワイ手軽セット（カジュアル）
  タグライン: 初めてのカニギフトに、迷わない一箱
  用途: 気軽なお礼・初めてカニを贈る相手・自宅鍋用に
  訴求: むき身加工済みで調理いらず・送料込みで5千円台
```

### LPのヒーローコピー（生成例）

```
【キャッチ】
冬の旬は、解禁日に始まる。

【サブコピー】
三陸沖・北海道産のカニを、漁解禁の瞬間から先行予約でお届けします。
数に限りがあります。旬の鮮度のまま確保できるのは、今だけです。

【FAQ例】
Q: 活け締めと冷凍の違いは？
A: 活け締めは解禁直後に加工し、鮮度のまま発送します。
   冷凍は旬の時期に急速凍結したもので、通年お届けできます。
   贈答には活け締めを、ストック用途には冷凍をおすすめしています。

Q: キャンセルはできますか？
A: 発送日の3日前まで無料でキャンセルできます。
   それ以降はカニを仕込む工程に入るため、対応が難しくなります。

【CTAボタン】
今すぐ先行予約する（数量限定）
```

### メール（生成例）

**先行予約開始メール（10月中旬）:**

```
件名: 三陸カニ漁の解禁前に、先に確保しませんか

11月6日、三陸沖のズワイガニ漁が解禁されます。

解禁直後の個体は旬の旨味が強く、
冬のカニのなかでも別格の味わいです。
ただ入荷できる数は限られるため、例年11月中旬には
先行分が完売になっていました。

今年は10月31日まで先行予約を受け付けています。
セットは三陸産・北海道産の3種類。
贈答用の化粧箱入りから、手軽なむき身セットまでご用意しました。

早めに動いていただいた方には、確実にお届けします。
▶ セットを確認する: {{shop_url}}
```

**解禁当日メール（11月6日）:**

```
件名: 今日、三陸沖のズワイガニ漁が解禁されました

本日11月6日、三陸沖の底曳き網漁が解禁されました。

今朝の水揚げから加工に入り、
明日以降から順次お届けを開始します。

冷凍では出せない、解禁直後の活け締めの香りと身の張り。
鍋でも焼きでも、今が一番です。

北海道の毛ガニ・花咲ガニも同時入荷中です。
産地直送・最短翌日着でお届けします。
▶ 今シーズンのカニを選ぶ: {{shop_url}}
```

### X投稿（生成例）

**先行予約告知:**

```
三陸沖のズワイガニ漁解禁は11月6日です。

解禁直後の旬の個体を確保できるのは、先行予約だけ。
今シーズンも数量限定でご用意しています。

#カニ #ズワイガニ #三陸 #旬 #先行予約 #冬の味覚
```

**Instagramキャプション（生成例）:**

```
冬の食卓に、本物のカニを。

三陸産ズワイガニ・北海道産毛ガニ・花咲ガニが解禁を迎えます。
漁師さんが今朝獲ったカニが、翌日には食卓に届く。

鍋に入れた瞬間に広がる香り、身を割いたときの質感——
これを体験すると、スーパーの冷凍カニには戻れません。

先行予約受付中です。
```

## コストと効果

**APIコスト（一連の生成処理）**

| 処理 | トークン数（概算） | コスト |
|------|------------------|--------|
| ギフトセット企画3案 | 入力1,600＋出力2,500 | 約1.8円 |
| LPコピー生成 | 入力1,800＋出力3,000 | 約2.1円 |
| メール3種＋SNS | 入力2,000＋出力3,000 | 約2.2円 |
| 合計 | | **約6.1円** |

**工数削減**

| 作業 | Before（手動） | After（Claude API） |
|------|--------------|-------------------|
| セット企画・価格設定 | 2〜3時間 | 0分（自動） |
| LPコピー作成 | 約3時間 | 10分（確認のみ） |
| キャンペーンメール3種 | 約2時間 | 10分（確認のみ） |
| X・Instagram投稿文 | 約1時間 | 即時 |
| 合計 | 約8〜9時間 | **約20分** |

**業者さんの一言：**
「去年は出遅れてカニシーズンが始まってから慌ててページ作ったので、初速がなかったんですよ。今年は9月のうちにメール文もLP案も揃ってるのが信じられない。"高級感を保つ"っていうのも、自分で文章書くと値段を並べてしまうだけになってたけど、産地の話を入れながら書いてくれるんですね」

## ポイントと注意点

**うまくいった点**
- `giftRank: 'S' | 'A' | 'B'` を渡すことでSランク商品を核にした高単価セットが自然に提案された
- 「安売り感・焦りを煽る表現を避ける」という制約を明記したことで、カニのブランド価値を維持したコピーが生成できた
- 「先行予約する合理的な理由」をプロンプトに入れたことで、「早く買え」ではなく「今確保する意味がある」という説得力のある文章になった

**注意点**
- カニの解禁日は種類と産地で異なる（ズワイガニ山陰11/1、北陸11/6、毛ガニ・花咲は通年入荷もあり）。プロンプトに渡す `availableFrom` は商品ごとに正確に設定すること
- 活け締めと冷凍の違いをFAQに入れることで、配送トラブルへの問い合わせが減った（昨年実績）
- X投稿の「先行予約」という文言は、実際の予約ページが存在することを前提にしている。ページ未完成の状態で投稿しないこと
- 「在庫残りわずかメール」は在庫20%のタイミングで送るが、トリガーはShopifyのWebhookと連携して自動化できる（別記事で解説予定）

## まとめ

カニキャンペーンの難しさは、「高い商品だから雑なコピーを出せない」という制約にある。でも、制約をプロンプトに書き込んでしまえばClaudeはその制約の中で動く。

**在庫データ（入荷予定・希少性・産地）→ 制約（品格を守る・産地名を入れる）→ Claude → セット企画＋LP＋メール＋SNS**というパイプラインが今回も機能した。

作業時間が8〜9時間から20分になったことより、**「9月中に11月の準備が終わる」というリードタイムの変化**のほうが実感として大きい。去年カニシーズンに出遅れた業者さんが、今年は2ヶ月前に全素材を揃えて待てる状態になった。

次回は「在庫残りわずか」アラートのShopify Webhook連携を実装する予定。カニに限らず、入荷数が少ない季節商品全般に使い回せる仕組みを考えている。

コード・カスタマイズ相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
