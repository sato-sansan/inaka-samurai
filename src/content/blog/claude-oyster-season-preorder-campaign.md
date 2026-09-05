---
title: "Claude APIで牡蠣シーズン開幕の先行予約キャンペーンを自動準備した話【三陸水産EC】"
description: "10月の牡蠣解禁に向けて、先行予約ページ・告知メール・SNS投稿をClaude APIで一括生成。「今年の牡蠣どう告知しよう」という毎年の悩みを、過去データと生産者情報を渡すだけで解決した話。"
pubDate: 2026-09-05
author: sam
category: "Claude活用"
tags: ["Claude", "EC自動化", "メールマーケティング", "牡蠣", "水産業", "季節キャンペーン", "Shopify", "先行予約"]
readingTime: 8
---

## 「今年の牡蠣、いつから告知すればいい？」

9月に入ると業者さんから毎年この連絡が来る。

「三陸の牡蠣って10月から解禁なんだけど、先行予約ページとメールと、あとSNSも全部用意しないといけなくて。毎年バタバタするんだよね」

宮城県産の牡蠣（特に気仙沼・広田湾産）は全国的な人気ブランドで、シーズン初回ロットは毎年完売する。告知さえうまくできれば予約は取れる。問題は**準備にかかる時間**だ。

- 先行予約ページの商品説明文
- 昨年購入者向けの先行案内メール
- 新規顧客向けの「初めての三陸牡蠣」紹介メール
- Instagram・X用の開幕告知投稿

これらを毎年1から書いていた。Claude APIに過去データと生産者情報を渡したら、全部揃うまで30分かからなかった。

## 作ったもの

入力：
- 過去2年の牡蠣販売データ（販売開始日・完売日・リピート率）
- 生産者情報（漁師さんの名前・漁場・こだわり点）
- 今シーズンの生育状況（漁師さんからのメモ）

出力：
- Shopify商品説明文（先行予約ページ用）
- リピーター向け先行案内メール
- 新規向け「初めての三陸牡蠣」案内メール
- Instagram用キャプション（3パターン）
- X用投稿文（5パターン）

## 実装コード

### 1. 型定義とデータ準備

```typescript
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';

const client = new Anthropic();

interface OysterSeasonData {
  producerName: string;
  fishingGround: string;
  commitment: string[];       // こだわり・特徴
  seasonNote: string;         // 今年の生育状況メモ
  previousYears: {
    year: number;
    openDate: string;         // 販売開始日
    soldOutDate: string;      // 完売日
    repeatRate: number;       // リピート率（0〜1）
    totalSold: number;        // 販売個数
  }[];
  pricePerUnit: number;       // 1個あたり価格（税込）
  minimumOrder: number;       // 最低注文数
}

const OYSTER_DATA: OysterSeasonData = {
  producerName: '佐藤漁業（気仙沼・唐桑産）',
  fishingGround: '気仙沼湾奥部・唐桑半島沖の清浄海域',
  commitment: [
    '水揚げ後24時間以内に出荷',
    '自社の浄化設備で品質確認済み',
    '殻付きのまま送るため鮮度が持続',
    '漁師が一つひとつ手作業で選別',
  ],
  seasonNote: `
    今年は夏の海水温が適度に高く、餌となるプランクトンが豊富だった。
    身の肥大が早く、昨年より1週間早い段階で食べ頃のサイズに達している。
    数量は昨年比で約1.2倍の見込み。脂のりと甘みは例年より強くなりそう。
  `.trim(),
  previousYears: [
    {
      year: 2025,
      openDate: '2025-10-12',
      soldOutDate: '2025-11-03',
      repeatRate: 0.68,
      totalSold: 1240,
    },
    {
      year: 2024,
      openDate: '2024-10-18',
      soldOutDate: '2024-11-10',
      repeatRate: 0.61,
      totalSold: 980,
    },
  ],
  pricePerUnit: 280,
  minimumOrder: 30,
};
```

### 2. Shopify商品説明文の生成

```typescript
interface ShopifyContent {
  title: string;
  bodyHtml: string;
  metaDescription: string;
  tags: string;
}

async function generateShopifyContent(
  data: OysterSeasonData
): Promise<ShopifyContent> {
  const historyText = data.previousYears
    .map(
      (y) =>
        `${y.year}年: 販売開始${y.openDate}、完売${y.soldOutDate}、` +
        `リピート率${Math.round(y.repeatRate * 100)}%、販売数${y.totalSold}個`
    )
    .join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: `三陸水産ECのShopify先行予約ページ用コンテンツを作成してください。

【生産者・商品情報】
生産者: ${data.producerName}
漁場: ${data.fishingGround}
こだわり:
${data.commitment.map((c) => `- ${c}`).join('\n')}
今年の生育状況: ${data.seasonNote}

【過去の販売実績】
${historyText}

【価格】
¥${data.pricePerUnit.toLocaleString()}／個（税込）
最低注文数: ${data.minimumOrder}個（¥${(data.pricePerUnit * data.minimumOrder).toLocaleString()}〜）

【出力（JSONのみ）】
{
  "title": "Shopify商品タイトル（〜60文字、先行予約感・産地・今年の特長を含む）",
  "bodyHtml": "商品ページ本文HTML（h2・p・ulタグ使用、500〜700文字相当。①今年の牡蠣の特徴 ②生産者紹介 ③内容・お届け方法 ④食べ方の順）",
  "metaDescription": "SEOメタディスクリプション（〜120文字）",
  "tags": "Shopifyタグのカンマ区切り（先行予約,牡蠣,殻付き,気仙沼,三陸,季節限定 など）"
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('商品説明文のJSON解析失敗');

  return JSON.parse(jsonMatch[0]) as ShopifyContent;
}
```

### 3. リピーター・新規向けメールの生成

```typescript
interface CampaignEmails {
  repeat: { subject: string; body: string };
  newCustomer: { subject: string; body: string };
  lastCall: { subject: string; body: string };
}

async function generateCampaignEmails(
  data: OysterSeasonData,
  openDate: string,
  preorderDeadline: string
): Promise<CampaignEmails> {
  const latestYear = data.previousYears[0];

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 3000,
    messages: [
      {
        role: 'user',
        content: `三陸水産ECの牡蠣シーズン先行予約メールを3種類作成してください。

【商品情報】
産地: ${data.fishingGround}
販売開始日: ${openDate}
先行予約締め切り: ${preorderDeadline}
価格: ¥${data.pricePerUnit}/個（${data.minimumOrder}個〜）

【今年の特長】
${data.seasonNote}

【昨年実績（参考）】
完売日: ${latestYear.soldOutDate}（開始から${Math.ceil(
          (new Date(latestYear.soldOutDate).getTime() -
            new Date(latestYear.openDate).getTime()) /
            (1000 * 60 * 60 * 24)
        )}日で完売）
リピート率: ${Math.round(latestYear.repeatRate * 100)}%

【3種類のメール】
1. リピーター向け先行案内（販売開始2週間前送信）：昨年購入者への特別感を演出
2. 新規顧客向け（同時期送信）：三陸牡蠣の魅力と安心感を伝える
3. 残量アラート（完売見込み5日前送信）：緊急性・希少性を訴求

【共通ルール】
- 件名は30文字以内
- 本文300〜400文字（残量アラートは200〜250文字）
- 「${data.producerName.split('（')[0]}」の名前を本文に1回入れる
- URLプレースホルダーは {{shop_url}}

【出力（JSONのみ）】
{
  "repeat": { "subject": "件名", "body": "本文" },
  "newCustomer": { "subject": "件名", "body": "本文" },
  "lastCall": { "subject": "件名", "body": "本文" }
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('メールのJSON解析失敗');

  return JSON.parse(jsonMatch[0]) as CampaignEmails;
}
```

### 4. SNS投稿コンテンツの生成

```typescript
interface SnsContent {
  instagram: string[];   // キャプション3パターン
  x: string[];           // X投稿5パターン
}

async function generateSnsContent(
  data: OysterSeasonData,
  openDate: string
): Promise<SnsContent> {
  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: `三陸水産ECの牡蠣シーズン開幕告知用SNS投稿を作成してください。

【商品情報】
産地: ${data.fishingGround}
生産者: ${data.producerName}
販売開始: ${openDate}
今年の特長: ${data.seasonNote}

【Instagram（3パターン）】
- 各200〜300文字
- ハッシュタグを末尾に5〜8個（#三陸牡蠣 #気仙沼 など）
- パターン1：生産者視点のストーリー系
- パターン2：食べるシーン訴求
- パターン3：今年の特長フォーカス

【X（5パターン）】
- 各100文字以内
- 絵文字を1〜2個使用
- パターンごとに切り口を変える（告知・豆知識・生産者・食べ方・緊急感）

【出力（JSONのみ）】
{
  "instagram": ["キャプション1", "キャプション2", "キャプション3"],
  "x": ["投稿1", "投稿2", "投稿3", "投稿4", "投稿5"]
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('SNSコンテンツのJSON解析失敗');

  return JSON.parse(jsonMatch[0]) as SnsContent;
}
```

### 5. 実行スクリプト

```typescript
async function main() {
  const OPEN_DATE = '2026-10-05';
  const PREORDER_DEADLINE = '2026-10-03（金）正午';

  console.log('🦪 牡蠣シーズン先行予約キャンペーン生成開始...\n');

  // Shopify商品説明
  console.log('📝 Shopify商品説明文を生成中...');
  const shopify = await generateShopifyContent(OYSTER_DATA);
  console.log(`タイトル: ${shopify.title}`);
  console.log(`メタ: ${shopify.metaDescription}`);

  // メール3種
  console.log('\n✉️ キャンペーンメールを生成中...');
  const emails = await generateCampaignEmails(
    OYSTER_DATA,
    OPEN_DATE,
    PREORDER_DEADLINE
  );
  console.log('\n--- リピーター向け ---');
  console.log(`件名: ${emails.repeat.subject}`);
  console.log(`本文:\n${emails.repeat.body}`);
  console.log('\n--- 新規顧客向け ---');
  console.log(`件名: ${emails.newCustomer.subject}`);
  console.log(`本文:\n${emails.newCustomer.body}`);

  // SNS
  console.log('\n📱 SNS投稿を生成中...');
  const sns = await generateSnsContent(OYSTER_DATA, OPEN_DATE);
  console.log('\n【Instagram パターン1】');
  console.log(sns.instagram[0]);
  console.log('\n【X パターン1〜3】');
  sns.x.slice(0, 3).forEach((post, i) => console.log(`${i + 1}: ${post}`));

  // 保存
  const output = { shopify, emails, sns };
  fs.writeFileSync(
    'oyster-campaign-2026.json',
    JSON.stringify(output, null, 2),
    'utf-8'
  );
  console.log('\n✅ oyster-campaign-2026.json に保存完了');
}

main().catch(console.error);
```

### 6. 実際の出力例

```
🦪 牡蠣シーズン先行予約キャンペーン生成開始...

📝 Shopify商品説明文を生成中...
タイトル: 【2026年先行予約】気仙沼・唐桑産 殻付き牡蠣 30個〜｜今年は豊作・早めの食べ頃
メタ: 気仙沼湾の清浄海域で育った殻付き牡蠣。2026年は身の肥大が早く例年より脂のりが豊か。数量限定・完売必至の先行予約受付中。

--- リピーター向け ---
件名: 【先行案内】今年の唐桑牡蠣、例年より早く仕上がりました

本文:
昨年もご購入いただきありがとうございました。
三陸・気仙沼唐桑産の牡蠣が、今年は例年より一足早く食べ頃を迎えています。

今夏の海水温と豊富なプランクトンのおかげで身の肥大が早く、佐藤漁業さんから
「脂のりと甘みは今年が一番いい」との連絡をいただきました。

昨年は販売開始から22日で完売しました。今年は数量が増えていますが、
先行予約の締め切りは10月3日（金）正午です。

▶ 先行予約はこちら: {{shop_url}}

--- 新規顧客向け ---
件名: 気仙沼の牡蠣、今年は特別においしいです

本文:
「スーパーの牡蠣と全然違う」。初めてご購入いただいたお客様からよくいただく言葉です。

気仙沼湾奥部・唐桑半島沖で育った牡蠣は、漁師・佐藤さんが水揚げ後24時間以内に
自社の浄化設備で品質確認し、殻付きのまま出荷します。鮮度を保つのは「殻を開けない」こと。

今年は身の肥大が早く、例年より濃厚な甘みが期待できます。
30個（¥8,400）から注文できます。初めての方も安心なレシピ付きでお届けします。

▶ 詳細・ご注文: {{shop_url}}
```

**SNS出力例（Instagram パターン1 ／ 生産者視点）:**

```
気仙沼・唐桑半島沖から、2026年の牡蠣をお届けします🦪

今年の夏は海水温が絶妙で、プランクトンが豊富でした。
佐藤さんから「身の入りが例年より早い。今年はいい出来になりそうだ」と
連絡があったのは8月末のこと。

10月5日の販売開始に向けて、今は一つひとつ丁寧に選別の最終確認をしています。
漁場から食卓まで、一番おいしい状態でお届けするために。

先行予約受付中。昨年は22日で完売しました。
→ リンクはプロフィール欄から

#三陸牡蠣 #気仙沼 #唐桑 #殻付き牡蠣 #産直 #旬の食材 #漁師直送
```

## コストと効果

**APIコスト（全コンテンツ一括生成）**

| 処理 | トークン数（概算） | コスト |
|------|------------------|--------|
| Shopify商品説明文 | 入力1,200＋出力1,500 | 約1.0円 |
| メール3種生成 | 入力1,500＋出力2,500 | 約1.6円 |
| SNS投稿8本生成 | 入力800＋出力1,200 | 約0.8円 |
| 合計 | | **約3.4円** |

**工数削減**

| 作業 | Before（手動） | After（Claude API） |
|------|--------------|-------------------|
| 商品説明文作成 | 約1時間 | 5分（確認のみ） |
| メール3種の文面作成 | 約2時間 | 5分（確認のみ） |
| SNS投稿8本の作成 | 約1時間 | 3分（確認のみ） |
| 合計 | **約4時間** | **約13分** |

**業者さんの一言：**
「毎年9月になると『牡蠣どう告知しよう』ってバタバタしてた。今年は生産者さんのメモを貼り付けたら30分以内に全部揃ってびっくりした。生産者の名前を自然に文章に入れてくれるのが一番助かる」

## ポイントと注意点

**うまくいった点**
- 「今年の生育状況メモ」を入力するだけで、その年ならではの切り口が自動で出てくる
- リピーター向けと新規向けの文面の差分が明確で、両方がそのまま使えるクオリティ
- SNS投稿8本を一度に生成するため、予約投稿に必要な素材をまとめて揃えられる

**注意点**
- 生産者のコメントは毎年最新のものに更新する（同じ文面の使い回しを防ぐ）
- 「完売まで○日」などの実績数値は毎年確認して更新すること
- SNS投稿は1〜2本ずつ実際に確認してから投稿スケジュールに入れる

## まとめ

牡蠣シーズンの開幕準備は毎年同じ作業の繰り返しに見えて、「今年の特長」「生産者の声」「昨年の実績」を盛り込もうとすると毎回一から書き直しになっていた。

Claude APIに**変わる部分（今年の状況）だけをインプット**して、変わらない部分（出力フォーマット・産地名・確認事項）をプロンプトに固めておく。これだけで毎年の繰り返し作業を「確認作業」に変えられる。

牡蠣に限らず、ホタテ・うに・あわびなど、シーズンが決まっている水産物には全部応用できる実装だ。

コード・カスタマイズ相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
