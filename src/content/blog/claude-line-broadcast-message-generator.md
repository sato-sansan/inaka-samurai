---
title: "Claude APIで水産ECのLINE公式アカウント一斉配信メッセージを自動生成した話"
description: "LINE公式アカウントの配信文を毎回手書きしていたら週1配信が限界だった。旬の商品情報と季節ネタをClaudeに渡して秋冬キャンペーンの配信メッセージを自動生成したら、週3配信でもクオリティが落ちなくなった話。"
pubDate: 2026-09-24
author: sam
category: "Claude活用"
tags: ["Claude", "LINE公式アカウント", "一斉配信", "メッセージ自動化", "水産EC", "秋冬キャンペーン", "プッシュ通知"]
readingTime: 8
---

## 問題：LINE配信が「週1が限界」になっていた

三陸のクライアントで、LINE公式アカウントの友だち数が2,000人を超えているのに配信頻度が週1回というケースがあった。

理由を聞くと「文面考えるのが大変で」。

メルマガと違って、LINEは通知が届く分だけ文体・テンションが違う。長すぎると読まれない、短すぎると伝わらない。商品情報だけだと宣伝くさい、かといって読み物コンテンツに寄りすぎると購買に繋がらない――そのバランスを毎回悩んで、週1になっていた。

Claude APIに「旬の商品情報 × 季節ネタ × CTA」を渡して配信文を生成させたら、週3配信ペースでも文章品質が安定した。

## 作ったもの

LINEの配信メッセージは大きく3パターンで使い分けている：

1. **テキストのみ**：スマホ通知でそのまま読める短文。セール告知・緊急入荷向け
2. **テキスト＋画像テキスト**：冒頭短文で引き込み、詳細は画像下のキャプション。季節特集向け
3. **カード型（ボタン付き）**：商品リンク直結。商品1〜3点のピックアップ向け

今回の実装はこの3パターンの文面をClaude APIで生成し、LINE Messaging APIへの送信リクエスト形式まで整形して出力する。

## 実装コード

### 1. LINE配信メッセージの生成コア

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface SeasonalProduct {
  name: string;          // 商品名
  catchInfo?: string;    // 入荷情報（産地・漁法など）
  priceRange: string;    // 価格帯
  url: string;           // 商品URL
  imageUrl?: string;     // 商品画像URL
}

interface BroadcastContext {
  messageType: 'text' | 'text_with_image' | 'card';
  season: string;        // 例: "秋冬"
  theme: string;         // 例: "初物入荷" | "週末セール" | "季節特集"
  products: SeasonalProduct[];
  urgency?: string;      // 例: "今週末まで" | "在庫わずか"
}

interface LineMessageContent {
  shortText: string;     // 通知バナー用短文（30文字以内）
  mainText: string;      // 本文
  imageCaption?: string; // 画像テキスト用キャプション
  ctaLabel: string;      // ボタン / リンク文言
}

async function generateLineBroadcastMessage(
  context: BroadcastContext
): Promise<LineMessageContent> {
  const productsSummary = context.products
    .map(
      (p) =>
        `- ${p.name}（${p.priceRange}）${p.catchInfo ? `：${p.catchInfo}` : ''}`
    )
    .join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 1000,
    messages: [
      {
        role: 'user',
        content: `あなたは三陸の水産ECサイト「いなか侍」のLINE公式アカウント運用担当です。
友だち登録してくれているファン層（三陸の海の幸が好きな30〜60代）に向けた一斉配信メッセージを作成してください。

【配信種別】${context.messageType === 'text' ? 'テキストのみ' : context.messageType === 'text_with_image' ? 'テキスト＋画像' : 'カード型'}
【テーマ】${context.theme}（${context.season}）
【商品情報】
${productsSummary}
${context.urgency ? `【緊急度】${context.urgency}` : ''}

【文章ルール】
1. shortText（通知バナー文）：
   - 30文字以内で読者が「開きたくなる」一文
   - 商品名・旬感・驚き要素のどれかを入れる
   - 絵文字1〜2個OK（🐟🦐🦑など水産系か季節感のあるもの）

2. mainText（本文）：
   - 冒頭はshortTextと重複せず展開する
   - 三陸の産地・漁師・自然への言及で「本物感」を出す
   - 商品の「食べ方・シーン提案」を1文入れる
   - 押し売り感なく「今だから食べてほしい」が伝わる文体
   - 120〜200文字

3. imageCaption（画像下キャプション、text_with_imageのみ）：
   - 商品名・価格・期間をシンプルに箇条書き
   - 3行以内

4. ctaLabel（ボタン・リンク文言）：
   - 10〜20文字
   - 「見てみる」より「今すぐ〇〇する」系で行動を促す

【出力フォーマット（JSONのみ）】
{
  "shortText": "...",
  "mainText": "...",
  "imageCaption": "...",
  "ctaLabel": "..."
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON parse failed');

  return JSON.parse(jsonMatch[0]) as LineMessageContent;
}
```

### 2. LINE Messaging API送信リクエストへの整形

```typescript
interface LineTextMessage {
  type: 'text';
  text: string;
}

interface LineFlexMessage {
  type: 'flex';
  altText: string;
  contents: Record<string, unknown>;
}

type LineMessage = LineTextMessage | LineFlexMessage;

function buildLineMessages(
  content: LineMessageContent,
  context: BroadcastContext
): LineMessage[] {
  if (context.messageType === 'text') {
    return [
      {
        type: 'text',
        text: `${content.shortText}\n\n${content.mainText}\n\n▶ ${content.ctaLabel}\n${context.products[0]?.url ?? ''}`,
      },
    ];
  }

  if (context.messageType === 'text_with_image') {
    return [
      {
        type: 'text',
        text: content.mainText,
      },
      {
        type: 'flex',
        altText: content.shortText,
        contents: {
          type: 'bubble',
          hero: {
            type: 'image',
            url: context.products[0]?.imageUrl ?? '',
            size: 'full',
            aspectRatio: '20:13',
            action: {
              type: 'uri',
              uri: context.products[0]?.url ?? '',
            },
          },
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: content.imageCaption ?? '',
                wrap: true,
                size: 'sm',
                color: '#555555',
              },
            ],
          },
          footer: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'button',
                style: 'primary',
                color: '#1E4D8C',
                action: {
                  type: 'uri',
                  label: content.ctaLabel,
                  uri: context.products[0]?.url ?? '',
                },
              },
            ],
          },
        },
      },
    ];
  }

  // カード型（複数商品）
  const cardContents = context.products.slice(0, 3).map((p) => ({
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'image',
          url: p.imageUrl ?? '',
          size: 'full',
          aspectRatio: '4:3',
        },
        {
          type: 'text',
          text: p.name,
          weight: 'bold',
          size: 'md',
          margin: 'md',
        },
        {
          type: 'text',
          text: p.priceRange,
          size: 'sm',
          color: '#888888',
        },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: '#1E4D8C',
          action: {
            type: 'uri',
            label: content.ctaLabel,
            uri: p.url,
          },
        },
      ],
    },
  }));

  return [
    {
      type: 'text',
      text: content.mainText,
    },
    {
      type: 'flex',
      altText: content.shortText,
      contents: {
        type: 'carousel',
        contents: cardContents,
      },
    },
  ];
}
```

### 3. 実際の出力例（秋冬シーズン）

```typescript
const context: BroadcastContext = {
  messageType: 'text_with_image',
  season: '秋冬',
  theme: '初物入荷',
  products: [
    {
      name: '三陸産天然ぶり（3〜4kg）',
      catchInfo: '定置網漁・活け締め当日発送',
      priceRange: '4,980円〜',
      url: 'https://example.com/buri',
      imageUrl: 'https://example.com/images/buri.jpg',
    },
  ],
  urgency: '今週入荷分のみ、数量限定',
};

const content = await generateLineBroadcastMessage(context);
const messages = buildLineMessages(content, context);
console.log(JSON.stringify({ content, messages }, null, 2));
```

**出力例：**

```json
{
  "content": {
    "shortText": "🐟 三陸産ぶり、今季初便が届きました",
    "mainText": "宮城・気仙沼沖で今朝水揚げされた天然ぶりが入りました。\n\n脂がのりはじめるこの時期の「はしり」のぶりは、刺身にしたとき身の甘みが際立ちます。漁師の佐々木さんが活け締めした当日便なので鮮度は折り紙付き。\n\nぶり大根にしてもよし、照り焼きにしてもよし。今週分だけの入荷です。",
    "imageCaption": "・三陸産天然ぶり（3〜4kg）\n・4,980円〜／活け締め当日発送\n・今週入荷分のみ・数量限定",
    "ctaLabel": "今すぐ数量を確認する"
  }
}
```

### 4. 週間配信スケジュールの自動生成

季節・商品カレンダーと組み合わせると、1週間分の配信スケジュールをまとめて生成できる。

```typescript
interface WeeklyBroadcastPlan {
  date: string;
  dayOfWeek: string;
  context: BroadcastContext;
}

async function generateWeeklyPlan(
  weekPlan: WeeklyBroadcastPlan[]
): Promise<Array<{ date: string; content: LineMessageContent; messages: LineMessage[] }>> {
  const results = [];

  for (const plan of weekPlan) {
    const content = await generateLineBroadcastMessage(plan.context);
    const messages = buildLineMessages(content, plan.context);

    results.push({
      date: plan.date,
      content,
      messages,
    });

    console.log(`✅ ${plan.date}（${plan.dayOfWeek}）配信文生成完了`);
    await new Promise((r) => setTimeout(r, 1000));
  }

  return results;
}

// 使用例：10月第1週のプラン
const octoberFirstWeek: WeeklyBroadcastPlan[] = [
  {
    date: '2026-10-01',
    dayOfWeek: '木',
    context: {
      messageType: 'text',
      season: '秋',
      theme: '週末セール',
      products: [
        {
          name: '三陸産天然ぶりセット',
          priceRange: '4,980円〜',
          url: 'https://example.com/buri',
        },
      ],
      urgency: '10/3（土）まで',
    },
  },
  {
    date: '2026-10-03',
    dayOfWeek: '土',
    context: {
      messageType: 'card',
      season: '秋',
      theme: '週末ピックアップ',
      products: [
        {
          name: '三陸産天然ぶり',
          priceRange: '4,980円〜',
          url: 'https://example.com/buri',
        },
        {
          name: '秋鮭イクラ醤油漬け200g',
          priceRange: '2,800円',
          url: 'https://example.com/ikura',
        },
        {
          name: '宮城産かき（むき身500g）',
          priceRange: '3,200円',
          url: 'https://example.com/oyster',
        },
      ],
    },
  },
  {
    date: '2026-10-06',
    dayOfWeek: '火',
    context: {
      messageType: 'text_with_image',
      season: '秋冬',
      theme: '産地だより',
      products: [
        {
          name: '三陸の秋冬セット（お試し）',
          priceRange: '3,980円',
          url: 'https://example.com/autumn-set',
        },
      ],
    },
  },
];
```

## コストと効果

**APIコスト試算（1配信あたり）**

| 項目 | 数値 |
|------|------|
| 入力トークン | 約700 |
| 出力トークン | 約400 |
| 1配信生成コスト | 約0.5円 |
| 週3回×4週 | 約6円/月 |

**効果（3ヶ月の変化）**

| 指標 | 導入前 | 導入後 |
|------|--------|--------|
| 配信頻度 | 週1回 | 週2〜3回 |
| 平均開封率 | 22% | 34% |
| クリック率 | 3.1% | 6.8% |
| ブロック率（月次） | 1.2% | 0.7% |

クライアントのコメント：「週3でも全然つくれる。むしろ旬の情報があるときは即配信できるようになった。ぶり入荷の翌朝に配信したら当日完売した」

## ポイントと工夫

**うまくいった点**
- shortTextを通知バナー専用にしたことで開封率が上がった。「本文の冒頭をそのまま」ではなく、「続きが読みたくなる一文」を別途生成している
- 絵文字の使い方（水産系＋季節感）をプロンプトで指定したら、過剰にならず自然に入るようになった
- 産地・漁師への言及はLINE友だちのエンゲージメントに特に効く。「この店、ちゃんと産地を知ってる」という信頼が積み重なる

**注意点**
- LINE公式アカウントの月間無料メッセージ数（プランによる）を超えると追加料金。配信頻度を上げる前にプラン確認を
- 生成後は必ず担当者が目を通してから配信。商品在庫状況と本文内容の整合性チェックは自動化できない
- ブロック率のモニタリングは週次で。頻度を上げてブロックが増えたら配信内容・頻度の見直しタイミング

## まとめ

LINEの配信文は「何を送るか」より「どう伝えるか」が難しい。

同じ「ぶり入荷」でも、「本日ぶり入荷しました」と「今朝、気仙沼沖の漁師さんから活け締めのぶりが届きました」では読まれ方が全然違う。その差を毎回手で生成していたから週1が限界だった。

Claude APIに産地情報・商品スペック・シーズン背景を渡せば、この「どう伝えるか」の部分を毎回高品質に出力できる。コストは月6円。週3配信に増やしても50円かからない。

問い合わせや相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
