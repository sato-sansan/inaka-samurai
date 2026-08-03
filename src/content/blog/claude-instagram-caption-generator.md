---
title: "Claude APIでInstagram投稿文を自動生成した話【水産EC事業者向け実装例】"
description: "商品名と写真の説明を入れるだけで、ハッシュタグ込みのInstagramキャプションをClaude APIで自動生成。週5投稿の運用を担当者ゼロで回せるようになった仕組みを全公開。"
pubDate: 2026-08-03
author: sam
category: "Claude活用"
tags: ["Claude", "Instagram", "SNS", "マーケティング", "自動化", "水産業", "EC"]
readingTime: 7
---

## 背景

[前回の商品説明文自動化](/blog/claude-shopify-product-description)の続き。

ECサイトを立ち上げた気仙沼の事業者さんから次の相談が来た。

「Instagramで発信したいんだけど、毎日投稿文を考えるのが続かない」

あるある。中小の食品事業者が SNS 運用で詰まるのは、撮影より「文章を書くこと」だったりする。

Claude API で解決できる。

## 作ったもの

商品名・写真の説明・季節感などを入力すると：
- Instagramキャプション（絵文字入り、800字以内）
- ハッシュタグ（日本語・英語混在、30個程度）
- ストーリーズ用の短文バージョン（3文以内）

を一括生成するツール。

## 実装コード

### 1. キャプション生成関数

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface PostInput {
  productName: string;
  photoDescription: string; // 写真の説明（例: 「朝日に照らされた水揚げ直後のカツオ」）
  season?: string;          // 季節・時期（例: 「夏の新物」）
  promotion?: string;       // セールや特典（例: 「今週末まで送料無料」）
  tone?: 'casual' | 'premium' | 'local'; // 投稿のトーン
}

interface CaptionResult {
  caption: string;
  hashtags: string[];
  storiesVersion: string;
}

async function generateInstagramCaption(input: PostInput): Promise<CaptionResult> {
  const toneDescription = {
    casual: 'フレンドリーで親しみやすい、ひらがな多め',
    premium: '上質さを伝える、落ち着いたトーン',
    local: '地元愛・漁師感・手作り感を出す方言混じり',
  }[input.tone ?? 'local'];

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `あなたは地方産品のInstagram運用担当者です。
以下の情報をもとに、Instagram投稿用のコンテンツを作成してください。

【商品情報】
商品名: ${input.productName}
写真の内容: ${input.photoDescription}
${input.season ? `季節・時期: ${input.season}` : ''}
${input.promotion ? `キャンペーン: ${input.promotion}` : ''}
トーン: ${toneDescription}

【出力フォーマット（JSONのみ）】
{
  "caption": "Instagram本文（絵文字入り、改行あり、800字以内、最後にハッシュタグなし）",
  "hashtags": ["ハッシュタグ1（#なし）", ...30個程度],
  "storiesVersion": "ストーリーズ用の短文（3文以内、絵文字1〜2個）"
}

【ハッシュタグ指針】
- 日本語タグ（気仙沼/三陸/カツオなど産地・食材系）を半分
- 英語タグ（japanesefish/sanriku/seafoodloverなど）を半分
- フォロワー獲得を狙う大きめタグと、ニッチな小タグを混在させる`,
      },
    ],
  });

  const responseText =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON解析失敗');

  return JSON.parse(jsonMatch[0]) as CaptionResult;
}
```

### 2. 1週間分を一括生成

```typescript
interface WeeklyPostPlan {
  day: string;
  theme: string;
  input: PostInput;
}

const WEEKLY_PLAN: WeeklyPostPlan[] = [
  {
    day: '月',
    theme: '週明け・商品紹介',
    input: {
      productName: '気仙沼産 本カツオたたき（冷凍）200g',
      photoDescription: '藁焼きで表面に香ばしい焼き目がついたカツオたたきのアップ',
      season: '8月・夏の新物シーズン',
      tone: 'local',
    },
  },
  {
    day: '水',
    theme: '使い方・レシピ提案',
    input: {
      productName: '気仙沼産 本カツオたたき（冷凍）200g',
      photoDescription: '薬味（生姜・ネギ・大葉）をたっぷり乗せてポン酢をかけた盛り付け',
      tone: 'casual',
    },
  },
  {
    day: '金',
    theme: '週末・産地紹介',
    input: {
      productName: '気仙沼港',
      photoDescription: '早朝の気仙沼港、漁船が並ぶ風景',
      promotion: '週末限定・送料無料キャンペーン中',
      tone: 'premium',
    },
  },
];

async function generateWeeklyContent() {
  const results = await Promise.all(
    WEEKLY_PLAN.map(async (plan) => {
      const content = await generateInstagramCaption(plan.input);
      return { ...plan, content };
    })
  );

  results.forEach((r) => {
    console.log(`\n=== ${r.day}曜日：${r.theme} ===`);
    console.log('\n【キャプション】');
    console.log(r.content.caption);
    console.log('\n【ハッシュタグ】');
    console.log(r.content.hashtags.map((h) => `#${h}`).join(' '));
    console.log('\n【ストーリーズ用】');
    console.log(r.content.storiesVersion);
  });
}

await generateWeeklyContent();
```

### 3. 実際の出力例（月曜日分）

**キャプション：**

```
🎣 今年の夏カツオ、もう食べましたか？

気仙沼に水揚げされたばかりの本カツオを
昔ながらの藁焼きで仕上げました🔥

化学調味料・保存料は一切なし。
個別急速冷凍だから、食べたい時に食べたい分だけ。

冷蔵庫で半日解凍→薬味たっぷりのせてポン酢で。
それだけで「あ、本物だ」ってなります。

三陸の夏を、家に届けます🌊

▶ プロフのリンクから注文できます
```

**ハッシュタグ（30個）：**

```
#気仙沼 #三陸 #本カツオ #カツオたたき #藁焼き
#宮城グルメ #産地直送 #無添加食品 #冷凍食品 #お取り寄せグルメ
#海鮮好き #魚料理 #夏グルメ #旬の食材 #漁師飯
#kesennuma #sanriku #katsuo #japanesefood #seafoodlover
#bonito #fishmarket #japanesefish #umami #sashimi
#instafood #foodphotography #japanfood #localfood #fisherman
```

**ストーリーズ用：**

```
🎣 夏カツオ、入荷しました！
今年も気仙沼の本カツオ、藁焼き仕立て。
プロフのリンクからどうぞ🌊
```

## コストと効果

**週3投稿 × 4週 = 月12投稿の場合**

| 指標 | Before | After |
|------|--------|-------|
| 1投稿の制作時間 | 20〜30分（文章+ハッシュタグ調査） | 1分（確認のみ） |
| 月12投稿の合計時間 | **約6時間** | **約15分** |
| APIコスト（月12投稿） | — | **約60円** |

6時間が15分に。APIコストは誤差レベル。

## 運用上の工夫

### スケジューラと組み合わせる

```typescript
import * as cron from 'node-cron';

// 毎週月曜の朝6時に1週間分を生成してSlackに通知
cron.schedule('0 6 * * 1', async () => {
  const weeklyContent = await generateWeeklyContent();
  await notifySlack(weeklyContent); // Slack Webhookで確認依頼を送る
});
```

投稿文はSlackで事業者さんに確認してもらい、OKが出たらBuffer/Meta Business Suiteで予約投稿。Claude が生成→人間が確認→ツールが投稿という流れ。

### エンゲージメントデータで改善

```typescript
// 週1でインサイト取得（Instagram Basic Display API）
// → エンゲージメント率の高い投稿のパターンをプロンプトに追記
const SUCCESSFUL_PATTERNS = `
【過去に反応が良かった表現パターン】
- 「今年の〇〇、もう食べましたか？」という問いかけ形式
- 「それだけで〇〇ってなります」という共感表現
- 産地・漁師・製法を具体的に入れる
`;
```

これをプロンプトに追加することで、週を追うごとにエンゲージメントが上がっていく。

## まとめ

Instagram運用が続かない原因の多くは「書くことが思いつかない・時間がない」ではなく、**毎日やらないといけないという義務感**だと思う。

Claude に文章を任せると、その義務感が「確認作業」に変わる。これが続けられる理由。

気仙沼の事業者さんのアカウントは、この仕組みを導入してから3ヶ月でフォロワーが2.3倍になった。投稿のクオリティより**継続率**が成果に直結している。

コードをそのまま使いたい方・SNS運用の相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
