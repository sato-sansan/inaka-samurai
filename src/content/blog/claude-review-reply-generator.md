---
title: "Claude APIで楽天市場・Shopifyのレビュー返信文を自動生成した話【水産EC実践例】"
description: "溜まったレビューに全件返信できていなかった水産EC事業者さん。Claude APIで商品・評価・内容から返信下書きを自動生成したら、月80件のレビュー返信が1時間以内で完了するようになった。"
pubDate: 2026-09-18
author: sam
category: "Claude活用"
tags: ["Claude", "楽天市場", "Shopify", "レビュー返信", "カスタマーサポート", "水産EC", "自動化"]
readingTime: 7
---

## 問題：レビューへの返信が「いつかやる」で積み上がる

気仙沼の業者さんから相談が来た。

「楽天のレビューに返信した方がいいのはわかってるんですが、月80件来ると全部は無理で…とりあえず星1と星2だけ返してる状態です」

実は楽天市場でのレビュー返信率はSEO（サーチ）にも影響する。返信率が高い店舗はランキングに優遇されるケースが多い。それだけじゃなく、次の購入者がレビューを見るときに「ちゃんとお礼を言ってる店」という印象がつく。

でも1件あたり3〜5分、月80件で5〜7時間。本業の傍らではきつい。

Claude APIで返信下書きを自動生成したら、月80件が確認+送信だけの作業になって1時間以内に収まった。

## 作ったもの

レビューデータ（評価・商品名・レビュー本文）を入れると：

- 評価（星1〜5）に合わせたトーンの返信下書き
- レビュー本文中の具体的な言及に返す個別メッセージ
- 楽天・Shopifyそれぞれの文字数制限に収まった文章

を生成するスクリプト。

## 実装コード

### 1. レビュー返信を生成するコア関数

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface ReviewInput {
  platform: 'rakuten' | 'shopify' | 'google';
  productName: string;
  rating: 1 | 2 | 3 | 4 | 5;
  reviewText: string;
  reviewerName?: string;   // 楽天ではニックネームが取得できる場合
  purchaseDate?: string;   // 購入時期（季節感を出すため）
}

interface ReplyResult {
  replyText: string;
  charCount: number;
  tone: 'apologetic' | 'grateful' | 'informative';
}

const CHAR_LIMITS: Record<ReviewInput['platform'], number> = {
  rakuten: 500,
  shopify: 1000,
  google: 4096,
};

async function generateReviewReply(
  review: ReviewInput,
  shopInfo: { name: string; description: string }
): Promise<ReplyResult> {
  const charLimit = CHAR_LIMITS[review.platform];

  const ratingGuidance: Record<number, string> = {
    1: 'お客様の不満に真摯に向き合い、改善への意欲を示す。言い訳はしない。具体的な改善策や補償の可能性に触れる。',
    2: '不満点を受け止めつつ、改善中・対応中であることを伝える。謝罪は丁寧に、ただし過剰にならない。',
    3: '良かった点への感謝と、改善要望への回答を両立させる。次回への期待につなげる。',
    4: '具体的な感想への感謝を述べ、言及された商品の魅力を補足する。星5への橋渡し。',
    5: '具体的に何が良かったかに触れて感謝を返す。常套句にならないよう、レビュー本文の言葉を拾う。',
  };

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `あなたは${shopInfo.name}（${shopInfo.description}）のカスタマーサービス担当です。
以下のお客様レビューへの返信文を作成してください。

【レビュー情報】
プラットフォーム: ${review.platform}
商品名: ${review.productName}
評価: 星${review.rating}
${review.reviewerName ? `レビュワー名: ${review.reviewerName}様` : ''}
${review.purchaseDate ? `購入時期: ${review.purchaseDate}` : ''}

【レビュー本文】
${review.reviewText}

【返信方針】
${ratingGuidance[review.rating]}

【制約】
- 文字数: ${charLimit}字以内
- 敬語・丁寧語を使う
- 「このたびは…」「大変…」などの使い回し感のある冒頭を避ける
- レビュー本文中の具体的な言及（料理名・産地・鮮度など）に必ず触れる
- 署名は不要（システムが追加する）
- 絵文字は使わない

【出力フォーマット（JSONのみ）】
{
  "replyText": "返信文",
  "tone": "apologetic|grateful|informative"
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON parse failed');

  const result = JSON.parse(jsonMatch[0]) as Omit<ReplyResult, 'charCount'>;
  return { ...result, charCount: result.replyText.length };
}
```

### 2. 一括処理とCSV出力

楽天の場合、RMSからレビューをCSVエクスポートできる。そのCSVを読み込んで一括処理する：

```typescript
import * as fs from 'fs';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

interface RakutenReviewRow {
  '商品管理番号': string;
  '商品名': string;
  '総合評価': string;
  'レビュー本文': string;
  'ニックネーム': string;
  '記入日': string;
  '返信済み': string; // "済" or ""
}

interface OutputRow extends RakutenReviewRow {
  '返信下書き': string;
  '文字数': string;
  'トーン': string;
}

async function bulkGenerateReplies(
  csvPath: string,
  shopInfo: { name: string; description: string },
  outputPath: string
): Promise<void> {
  const raw = fs.readFileSync(csvPath, 'utf-8');
  const rows = parse(raw, {
    columns: true,
    skip_empty_lines: true,
  }) as RakutenReviewRow[];

  // 未返信のみ対象
  const unreplied = rows.filter((r) => r['返信済み'] !== '済');
  console.log(`未返信レビュー: ${unreplied.length}件`);

  const outputRows: OutputRow[] = [...rows.map((r) => ({
    ...r,
    '返信下書き': r['返信済み'] === '済' ? '（返信済み）' : '',
    '文字数': '',
    'トーン': '',
  }))];

  const rowMap = new Map(rows.map((r, i) => [r, i]));

  // 3件並列で処理（APIレート制限対策）
  const CONCURRENCY = 3;
  for (let i = 0; i < unreplied.length; i += CONCURRENCY) {
    const batch = unreplied.slice(i, i + CONCURRENCY);

    await Promise.all(
      batch.map(async (row) => {
        const rating = parseInt(row['総合評価'], 10) as 1 | 2 | 3 | 4 | 5;
        if (![1, 2, 3, 4, 5].includes(rating)) return;

        const result = await generateReviewReply(
          {
            platform: 'rakuten',
            productName: row['商品名'],
            rating,
            reviewText: row['レビュー本文'],
            reviewerName: row['ニックネーム'],
          },
          shopInfo
        );

        const idx = rowMap.get(row);
        if (idx !== undefined) {
          outputRows[idx]['返信下書き'] = result.replyText;
          outputRows[idx]['文字数'] = String(result.charCount);
          outputRows[idx]['トーン'] = result.tone;
        }

        console.log(
          `✅ ${row['商品名'].slice(0, 20)}… 星${rating} → ${result.charCount}字`
        );
      })
    );

    if (i + CONCURRENCY < unreplied.length) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const output = stringify(outputRows, { header: true });
  fs.writeFileSync(outputPath, output);
  console.log(`\n📄 出力完了: ${outputPath} (${unreplied.length}件処理)`);
}

// 実行例
await bulkGenerateReplies(
  'rakuten-reviews-export.csv',
  {
    name: 'まるみや海産',
    description: '気仙沼・三陸産の鮮魚・干物・加工品を産地直送する水産EC',
  },
  'rakuten-reviews-with-reply.csv'
);
```

### 3. 実際の出力例

**星5レビューへの返信：**

```
入力レビュー（星5）:
「三陸の秋サンマ、今シーズン一番おいしかったです。
脂のりが全然違う。塩焼きにしたら箸が止まらなかった。
来年も絶対買います。」

生成された返信:
三陸のサンマで最高の秋を過ごしていただけたとのこと、
とてもうれしいです。おっしゃる通り、9〜10月は
三陸沖の親潮と黒潮がぶつかる時期で、サンマの脂のりが
一年で最もよくなります。「箸が止まらなかった」という
お言葉は、漁師さんや仕入れスタッフへの最高のご報告になります。
来シーズンもご期待に沿える一本をお届けできるよう、
産地と連携して仕入れてまいります。

文字数: 162字 / トーン: grateful
```

**星2レビューへの返信：**

```
入力レビュー（星2）:
「いくらの粒が小さくて、思ったより量が少なかった。
写真と違う感じがした。味は悪くなかったけど。」

生成された返信:
この度はご期待に添えず、申し訳ございませんでした。
いくらの粒の大きさは秋鮭の個体差により変動があり、
写真の粒より小さくなることがございます。
ご不満をおかけしたにもかかわらず、味については
評価いただきましたこと、感謝しております。
商品説明ページに粒サイズの目安と実測値を掲載するよう
改善いたします。次回ご購入の際は、改めてご期待ください。

文字数: 187字 / トーン: apologetic
```

### 4. 星1レビューへの特別対応

星1・2は下書き生成後に人間が必ず確認するフローにする：

```typescript
async function processLowRatingReviews(
  reviews: ReviewInput[],
  shopInfo: { name: string; description: string }
): Promise<void> {
  const lowRatings = reviews.filter((r) => r.rating <= 2);
  const results = await Promise.all(
    lowRatings.map((r) => generateReviewReply(r, shopInfo))
  );

  // Slack通知で担当者にレビューと下書きをセットで送る
  for (let i = 0; i < lowRatings.length; i++) {
    const review = lowRatings[i];
    const reply = results[i];

    const slackMessage = {
      text: `⚠️ 低評価レビュー（星${review.rating}）要確認`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*商品:* ${review.productName}\n*評価:* ★${review.rating}\n*レビュー:*\n${review.reviewText}`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*返信下書き（${reply.charCount}字）:*\n${reply.replyText}`,
          },
        },
      ],
    };

    await fetch(process.env.SLACK_WEBHOOK_URL ?? '', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slackMessage),
    });
  }
}
```

## コストと効果

**APIコスト試算（1件あたり）**

| 項目 | 数値 |
|------|------|
| 平均入力トークン | 約350 |
| 平均出力トークン | 約280 |
| 1件あたりのコスト | 約0.2円 |
| 月80件処理時 | 約16円 |

**作業時間の変化**

| 指標 | Before | After |
|------|--------|-------|
| 1件の返信作成時間 | 3〜5分 | 確認+送信30秒 |
| 月80件の合計時間 | 約6時間 | 約1時間 |
| 返信率 | 約25%（低評価優先） | 約95%（全件） |
| APIコスト | — | 月16円 |

**業者さんの感想：**「返信率が上がってから楽天のレビュー件数も増えた。返信を読んでいるお客さんが安心して注文してくれているのかも」

## ポイントと注意点

**うまくいった点**

- レビュー本文中の具体的なワード（魚種名・料理・産地）をプロンプトで必ず拾わせることで、コピペ感のない返信が生成された
- 星1〜5のトーン制御をレーティング別にプロンプトに入れると、読んで自然な温度感になる
- 楽天の500字制限を守るため文字数制限を明示したところ、超過率が3%以下に収まった

**注意点**

- 生成された返信はかならず読んで確認する。特に事実関係（出荷日・補償ポリシー）は実際の対応と齟齬が出ないよう確認
- 星1のレビューに対してシステムが単独で送信しない設計にする（管理者承認フロー必須）
- 同一商品に類似したレビューが続くと、返信文が似通ってくる → プロンプトに「前の返信と重複しないよう変化をつけて」を追加すると分散する
- 楽天は返信後24時間以内に編集できるが、それ以降は変更不可。確認は送信前に済ませる

## まとめ

レビューへの返信は「やったほうがいい」と知りながら手が回らない作業の典型だった。

月80件・6時間だった返信作業が、Claude APIを挟むことで「確認して送るだけの1時間」に変わった。コストは月16円。

返信率が上がると次のレビュー件数も増える、という好循環も起きている。レビューを書いた人への誠実な返信が、次に読む人への信頼になる。その部分を自動化しても、文章の質を保てるのがClaudeの強みだと感じている。

実装・カスタマイズの相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
