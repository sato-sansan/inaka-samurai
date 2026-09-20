---
title: "Claude APIで楽天・Amazon商品Q&Aへの自動回答文を生成した話【水産EC実践例】"
description: "楽天・AmazonのQ&A欄に来る質問に返答できていなかった水産EC事業者さん。Claude APIで商品情報・質問文から回答下書きを自動生成したら、週20件のQ&A対応が10分以内で完了するようになった。"
pubDate: 2026-09-20
author: sam
category: "Claude活用"
tags: ["Claude", "楽天市場", "Amazon", "商品Q&A", "カスタマーサポート", "水産EC", "自動化"]
readingTime: 7
---

## 問題：Q&Aが放置されると機会損失になる

気仙沼の業者さんから相談が来た。

「楽天のQ&A欄、週20件くらい来るんですが、正直後回しにしてます。レビュー返信はやり始めたけど、Q&Aはさらに優先度が下がってしまって…」

楽天市場では商品ページのQ&Aに店舗が回答すると、その内容がページに表示される。未回答が増えると次の購入候補者の疑問が解消されず、カゴ落ちの原因になる。Amazonも同様で、Q&Aは検索インデックスにも影響する。

よく来る質問のパターンはほぼ決まっている：
- 賞味期限・消費期限
- 産地・漁場
- アレルギー対応
- 配送日・着日指定
- 贈答用の熨斗・包装

この5パターンで週20件の8割は占まる。毎回ゼロから文章を書いているのが非効率だった。

Claude APIに商品情報と質問文を渡して、回答下書きを自動生成させたら解決した。

## 作ったもの

商品情報（商品名・産地・原材料・スペック）と質問文を入れると：

- 質問意図を分類（賞味期限・産地・アレルギー・配送・包装・その他）
- 分類に合わせたトーンの回答下書き
- 楽天Q&A（500字）・Amazon（1000字）の文字数制限を守った文章

を生成するスクリプト。

## 実装コード

### 1. Q&A回答を生成するコア関数

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface ProductInfo {
  name: string;           // 商品名
  origin: string;         // 産地・漁場
  ingredients?: string;   // 原材料・アレルゲン情報
  shelfLife?: string;     // 賞味期限
  weight?: string;        // 内容量・重量
  storageMethod?: string; // 保存方法
  shippingNote?: string;  // 配送に関する注意事項
  giftOptions?: string;   // 熨斗・包装対応
}

type QuestionCategory =
  | 'shelf_life'
  | 'origin'
  | 'allergy'
  | 'shipping'
  | 'gift'
  | 'other';

interface QAResult {
  category: QuestionCategory;
  replyText: string;
  charCount: number;
  confidence: 'high' | 'medium' | 'low'; // 情報が揃っているか
}

const CHAR_LIMITS: Record<'rakuten' | 'amazon', number> = {
  rakuten: 500,
  amazon: 1000,
};

async function generateQAReply(
  question: string,
  product: ProductInfo,
  platform: 'rakuten' | 'amazon',
  shopName: string
): Promise<QAResult> {
  const charLimit = CHAR_LIMITS[platform];

  const productContext = [
    `商品名: ${product.name}`,
    `産地・漁場: ${product.origin}`,
    product.ingredients ? `原材料・アレルゲン: ${product.ingredients}` : null,
    product.shelfLife ? `賞味期限: ${product.shelfLife}` : null,
    product.weight ? `内容量: ${product.weight}` : null,
    product.storageMethod ? `保存方法: ${product.storageMethod}` : null,
    product.shippingNote ? `配送情報: ${product.shippingNote}` : null,
    product.giftOptions ? `ギフト対応: ${product.giftOptions}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `あなたは${shopName}（三陸・気仙沼の水産EC）のカスタマーサポート担当です。
以下のお客様からの商品Q&Aに回答してください。

【商品情報】
${productContext}

【お客様の質問】
${question}

【回答ルール】
- 文字数: ${charLimit}字以内
- 丁寧語・敬語を使う
- 商品情報に記載のない事項は「詳しくはお問い合わせください」と案内し、憶測で回答しない
- 「お問い合わせ」の誘導は最後の1行に限定する
- 回答の冒頭は「お問い合わせありがとうございます」などの定型句でなく、質問の核心から入る

【出力フォーマット（JSONのみ、説明不要）】
{
  "category": "shelf_life|origin|allergy|shipping|gift|other",
  "replyText": "回答文",
  "confidence": "high|medium|low"
}

confidenceの基準：
- high: 商品情報に明記されており、そのまま回答できる
- medium: 商品情報から推定できるが、確認が望ましい
- low: 商品情報に記載がなく、担当者確認が必要`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON parse failed');

  const result = JSON.parse(jsonMatch[0]) as Omit<QAResult, 'charCount'>;
  return { ...result, charCount: result.replyText.length };
}
```

### 2. 商品マスタと一括処理

複数商品のQ&Aをまとめて処理するため、商品マスタをJSONで持って引き当てる：

```typescript
import * as fs from 'fs';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

// 商品マスタ（事前に作成しておく）
const productMaster: Record<string, ProductInfo> = {
  'saury-dried-001': {
    name: '三陸産 干しさんま 5尾入り',
    origin: '三陸沖・気仙沼港水揚げ',
    ingredients: 'さんま（三陸産）、食塩 ／ （アレルゲン：さかな）',
    shelfLife: '製造日より冷蔵14日、冷凍90日',
    weight: '約400g（5尾）',
    storageMethod: '要冷蔵（0〜5℃）、または冷凍保存',
    shippingNote: 'クール（冷蔵）配送。お届け日指定可（注文翌日から3日後以降）',
    giftOptions: '熨斗対応あり。包装紙・手提げ袋は別途300円',
  },
  'oyster-frozen-002': {
    name: '気仙沼産 むき牡蠣 500g（冷凍）',
    origin: '宮城県気仙沼湾・筏養殖',
    ingredients:
      '牡蠣（宮城県産）、次亜塩素酸Na（洗浄用）／（アレルゲン：かき）',
    shelfLife: '冷凍で製造日より180日',
    weight: '500g（解凍後の歩留まり：約350g）',
    storageMethod: '冷凍保存（−18℃以下）。解凍後は当日中に使用',
    shippingNote: 'クール（冷凍）配送。沖縄・離島は別途送料が発生する場合あり',
    giftOptions: '熨斗対応あり（内のし・外のし選択可）',
  },
};

interface QAInputRow {
  '商品管理番号': string;
  '質問内容': string;
  '質問日': string;
  '回答済み': string;
}

interface QAOutputRow extends QAInputRow {
  '回答下書き': string;
  '文字数': string;
  '分類': string;
  '要確認': string;
}

async function bulkGenerateQAReplies(
  csvPath: string,
  shopName: string,
  platform: 'rakuten' | 'amazon',
  outputPath: string
): Promise<void> {
  const raw = fs.readFileSync(csvPath, 'utf-8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true }) as QAInputRow[];

  const unreplied = rows.filter((r) => r['回答済み'] !== '済');
  console.log(`未回答Q&A: ${unreplied.length}件`);

  const outputRows: QAOutputRow[] = rows.map((r) => ({
    ...r,
    '回答下書き': r['回答済み'] === '済' ? '（回答済み）' : '',
    '文字数': '',
    '分類': '',
    '要確認': '',
  }));

  const rowMap = new Map(rows.map((r, i) => [r, i]));

  // 3件並列で処理
  const CONCURRENCY = 3;
  for (let i = 0; i < unreplied.length; i += CONCURRENCY) {
    const batch = unreplied.slice(i, i + CONCURRENCY);

    await Promise.all(
      batch.map(async (row) => {
        const product = productMaster[row['商品管理番号']];
        if (!product) {
          console.warn(`⚠️ 商品マスタ未登録: ${row['商品管理番号']}`);
          return;
        }

        const result = await generateQAReply(
          row['質問内容'],
          product,
          platform,
          shopName
        );

        const idx = rowMap.get(row);
        if (idx !== undefined) {
          outputRows[idx]['回答下書き'] = result.replyText;
          outputRows[idx]['文字数'] = String(result.charCount);
          outputRows[idx]['分類'] = result.category;
          outputRows[idx]['要確認'] = result.confidence === 'low' ? '⚠️要確認' : '';
        }

        console.log(
          `✅ ${product.name.slice(0, 15)}… [${result.category}] ${result.charCount}字 (${result.confidence})`
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

await bulkGenerateQAReplies(
  'rakuten-qa-export.csv',
  'まるみや海産',
  'rakuten',
  'rakuten-qa-with-reply.csv'
);
```

### 3. 実際の出力例

**賞味期限の質問（confidence: high）：**

```
質問:
「冷蔵と冷凍で保存した場合、それぞれ何日くらい持ちますか？」

生成された回答:
冷蔵保存では製造日より14日以内にお召し上がりください。
冷凍保存の場合は90日間保存可能です。
なお、解凍後は冷蔵保存に切り替え、
できるだけお早めにお召し上がりください。
ご不明な点は店舗までご連絡ください。

文字数: 108字 / 分類: shelf_life / confidence: high
```

**アレルゲンの質問（confidence: high）：**

```
質問:
「魚アレルギーの家族がいます。
 アレルゲン情報を教えてください。」

生成された回答:
干しさんまのアレルゲンは「さかな（さんま）」のみです。
製造は水産加工専用の施設で行っており、
えび・かに・小麦・乳製品等との混在ラインはございません。
ただし、同一施設でほかの魚種も加工しております。
重篤なアレルギーをお持ちの方は、
念のため医師にご相談の上ご注文ください。

文字数: 142字 / 分類: allergy / confidence: high
```

**配送の質問（confidence: medium）：**

```
質問:
「金曜日に注文したら、週末に届きますか？
 土曜配達は対応していますか？」

生成された回答:
土曜日のお届けは対応しております（一部地域を除く）。
金曜日のご注文は、当日14時までのご注文で
翌土曜日着の指定が可能です（14時以降は翌週月曜日着以降）。
お届け日は注文画面でご指定いただけます。
なお、北海道・沖縄・離島へのお届けは
翌々日以降になる場合がございますので、
ご注文前にお問い合わせください。

文字数: 171字 / 分類: shipping / confidence: medium
```

### 4. 情報が不足している質問の扱い（confidence: low）

商品マスタにない情報を聞かれた場合は自動で「⚠️要確認」フラグを立て、担当者に通知する：

```typescript
async function notifyLowConfidenceItems(
  outputCsvPath: string
): Promise<void> {
  const raw = fs.readFileSync(outputCsvPath, 'utf-8');
  const rows = parse(raw, { columns: true }) as QAOutputRow[];
  const flagged = rows.filter((r) => r['要確認'] === '⚠️要確認');

  if (flagged.length === 0) return;

  const lines = flagged.map(
    (r) =>
      `商品: ${r['商品管理番号']}\n質問: ${r['質問内容']}\n下書き: ${r['回答下書き']}`
  );

  // Slack通知
  await fetch(process.env.SLACK_WEBHOOK_URL ?? '', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: `⚠️ Q&A要確認: ${flagged.length}件（担当者が情報を補完してください）`,
      attachments: lines.map((text) => ({ text })),
    }),
  });

  console.log(`Slack通知送信: ${flagged.length}件`);
}
```

## コストと効果

**APIコスト試算（1件あたり）**

| 項目 | 数値 |
|------|------|
| 平均入力トークン | 約450 |
| 平均出力トークン | 約200 |
| 1件あたりのコスト | 約0.2円 |
| 週20件処理時 | 約4円 |
| 月80件換算 | 約16円 |

**作業時間の変化**

| 指標 | Before | After |
|------|--------|-------|
| 1件の回答作成時間 | 3〜5分 | 確認+送信30秒 |
| 週20件の合計時間 | 約1.5時間 | 約10分 |
| 回答率 | 約40%（優先順位付き） | 約95%（全件） |
| APIコスト | — | 週4円 |

**業者さんの感想：**「Q&Aに全部答えてるようになったら、同じ質問でのお問い合わせメールが減った。ページに答えがあれば問い合わせしなくていいんだなと改めて気づいた」

## ポイントと注意点

**うまくいった点**

- `confidence` フラグで「確認が必要な回答」を自動仕分けできるため、全件人間が読む時間を削減できた
- 商品マスタさえ整備すれば、よくある質問パターン（賞味期限・産地・アレルゲン）は高精度で回答できる
- Q&A分類（category）が副産物として残るので、「どの質問が多いか」の傾向分析にも使える

**注意点**

- 商品マスタの精度が回答品質に直結する。アレルゲン情報や賞味期限の記載が古いと誤った回答が生成されるため、マスタ管理は厳密に
- `confidence: low` の案件を放置すると「情報不足のまま回答してしまう」事故につながる。Slack通知と組み合わせて担当者が補完するフローを必ず入れる
- 楽天Q&Aは購入者・非購入者どちらからも来るため、購入前の不安（初めての注文・贈答目的）には特に丁寧なトーンを心がける。プロンプトの `shopName` にショップの特徴（「三陸の漁師と直接取引する産直EC」など）を入れるとトーンが変わる

## まとめ

週20件・1.5時間かかっていたQ&A対応が、確認+送信だけの10分に変わった。コストは週4円。

レビュー返信と同様に「やった方がいいとわかっているが後回し」になりやすい作業で、自動生成と人間の確認を分業することで品質を落とさずに対応件数を増やせた。

Q&Aへの回答率が上がると、同じ疑問を持つ見込み客がページ内で解決できるようになり、問い合わせメールの件数そのものも減る。SEO的にもQ&Aコンテンツの充実は検索露出に貢献する。

実装・カスタマイズの相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
