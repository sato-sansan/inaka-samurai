---
title: "Claude APIでAmazonの商品ページ・A+コンテンツを自動生成した話【水産EC多チャネル展開】"
description: "楽天とShopifyで売れていた水産加工品をAmazonにも出品したいが、Amazon独自のページ要件に手が回らないという相談。Claude APIで商品タイトル・箇条書き・A+コンテンツをまとめて自動生成したら、50商品の出品準備が1週間から半日になった。"
pubDate: 2026-09-19
author: sam
category: "Claude活用"
tags: ["Claude", "Amazon", "A+コンテンツ", "商品ページ", "水産EC", "自動化", "多チャネル展開"]
readingTime: 8
---

## きっかけ

気仙沼でカキ・タコ・ホヤなどの水産加工品を販売している業者さんから連絡が来た。

「楽天とShopifyは軌道に乗ってきたんですが、Amazonにも出品したくて。ただAmazonって商品ページの書き方が全然違うんですよね。しかも50商品あるんで、正直何から手をつければいいか…」

わかる。Amazonの商品ページは独自ルールが多い。

- タイトルは半角250文字以内、先頭にブランド名
- 商品の特長は5点の箇条書き（各200文字以内）
- A+コンテンツはHTML構造で見出し・段落・比較表をセットで作る

楽天用に書いた説明文をそのままコピペしても「規約違反」か「最適化不足」で弾かれるか、検索に引っかからない。

Claude APIで「楽天・Shopify用の商品情報」から「Amazon最適化フォーマット」を自動変換できると思った。

## 作ったもの

商品情報（商品名・原材料・特徴・産地）を入れると：

- **Amazonタイトル**（ブランド名・商品名・産地・容量を規約準拠の形式で）
- **箇条書き5点**（各180字以内、検索キーワードを自然に含む）
- **商品説明文**（Amazonの「商品説明」欄向け400字）
- **A+コンテンツ用テキスト**（見出し・本文・比較ポイント）

を自動生成するスクリプト。

## 実装コード

### 1. Amazon商品ページ生成のコア関数

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface ProductInput {
  brandName: string;
  productName: string;
  ingredients: string;
  features: string;
  region: string;
  weight: string;
  count?: string;
  shelfLife?: string;
  storageMethod?: string;
  certifications?: string[]; // 例: ['無添加', '国産', '産地直送']
}

interface AmazonPageContent {
  title: string;
  bulletPoints: string[];
  description: string;
  aplusContent: AplusContent;
}

interface AplusContent {
  headline: string;
  sections: Array<{
    heading: string;
    body: string;
  }>;
  comparisonPoints: string[];
}

async function generateAmazonPage(
  product: ProductInput
): Promise<AmazonPageContent> {
  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: `あなたはAmazon出品の専門家です。以下の水産加工品情報から、Amazon商品ページのすべての要素をJSON形式で生成してください。

【商品情報】
ブランド名: ${product.brandName}
商品名: ${product.productName}
原材料: ${product.ingredients}
特徴: ${product.features}
産地: ${product.region}
内容量: ${product.weight}${product.count ? `・${product.count}` : ''}
賞味期限目安: ${product.shelfLife ?? '商品ページ参照'}
保存方法: ${product.storageMethod ?? '冷凍保存'}
認証・特徴: ${product.certifications?.join('、') ?? 'なし'}

【Amazonのルール】
- タイトル: ブランド名から始める、半角250文字以内、主要キーワードを含む
- 箇条書き: 必ず5点、各180文字以内、「・」で始めない、メリットを具体的に
- 商品説明: 400字以内、産地・製法・用途を含む
- A+コンテンツ: 見出し30字以内、本文各150字以内、比較ポイント3点

【出力フォーマット（JSONのみ、余分な説明不要）】
{
  "title": "Amazonタイトル（250文字以内）",
  "bulletPoints": [
    "箇条書き1（180文字以内）",
    "箇条書き2（180文字以内）",
    "箇条書き3（180文字以内）",
    "箇条書き4（180文字以内）",
    "箇条書き5（180文字以内）"
  ],
  "description": "商品説明文（400文字以内）",
  "aplusContent": {
    "headline": "A+コンテンツの大見出し（30文字以内）",
    "sections": [
      { "heading": "セクション見出し", "body": "本文（150文字以内）" },
      { "heading": "セクション見出し", "body": "本文（150文字以内）" },
      { "heading": "セクション見出し", "body": "本文（150文字以内）" }
    ],
    "comparisonPoints": [
      "他商品との差別化ポイント1",
      "他商品との差別化ポイント2",
      "他商品との差別化ポイント3"
    ]
  }
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON parse failed');

  return JSON.parse(jsonMatch[0]) as AmazonPageContent;
}
```

### 2. 文字数バリデーションと自動修正

Amazonは文字数オーバーで審査に引っかかる。生成後に確認して、超過していれば短縮リクエストを投げる：

```typescript
function validateAmazonContent(content: AmazonPageContent): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (content.title.length > 250) {
    errors.push(`タイトル超過: ${content.title.length}文字（上限250）`);
  }
  content.bulletPoints.forEach((bp, i) => {
    if (bp.length > 180) {
      errors.push(`箇条書き${i + 1}超過: ${bp.length}文字（上限180）`);
    }
  });
  if (content.bulletPoints.length !== 5) {
    errors.push(
      `箇条書き数が不正: ${content.bulletPoints.length}点（必須5点）`
    );
  }
  if (content.description.length > 400) {
    errors.push(`説明文超過: ${content.description.length}文字（上限400）`);
  }

  return { valid: errors.length === 0, errors };
}

async function generateWithValidation(
  product: ProductInput,
  maxRetry = 2
): Promise<AmazonPageContent> {
  let content = await generateAmazonPage(product);
  const { valid, errors } = validateAmazonContent(content);

  if (valid) return content;

  if (maxRetry <= 0) {
    console.warn('バリデーション修正の上限に達しました:', errors);
    return content;
  }

  // 超過箇所を伝えて再生成
  const fixMessage = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: `以下のAmazon商品ページ内容に規約違反があります。修正してJSONのみ返してください。

【現在の内容】
${JSON.stringify(content, null, 2)}

【修正が必要な箇所】
${errors.join('\n')}

修正後のJSONのみ出力してください。`,
      },
    ],
  });

  const fixText =
    fixMessage.content[0].type === 'text' ? fixMessage.content[0].text : '{}';
  const fixJson = fixText.match(/\{[\s\S]*\}/);
  if (!fixJson) return content;

  content = JSON.parse(fixJson[0]) as AmazonPageContent;
  return content;
}
```

### 3. バッチ処理とExcel出力

Amazonの場合、セラーセントラルへの一括登録にExcelテンプレートを使う：

```typescript
import * as fs from 'fs';
import ExcelJS from 'exceljs';

interface ProductRow extends ProductInput {
  asin?: string;
  sku: string;
  category: string;
}

async function bulkGenerateAmazonPages(
  products: ProductRow[],
  outputPath: string
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('商品データ');

  // Amazonセラーセントラルの一括登録テンプレート列
  sheet.columns = [
    { header: 'SKU', key: 'sku', width: 20 },
    { header: 'タイトル', key: 'title', width: 60 },
    { header: '箇条書き1', key: 'bp1', width: 40 },
    { header: '箇条書き2', key: 'bp2', width: 40 },
    { header: '箇条書き3', key: 'bp3', width: 40 },
    { header: '箇条書き4', key: 'bp4', width: 40 },
    { header: '箇条書き5', key: 'bp5', width: 40 },
    { header: '商品説明', key: 'description', width: 60 },
  ];

  // 2件並列で処理
  const CONCURRENCY = 2;
  for (let i = 0; i < products.length; i += CONCURRENCY) {
    const batch = products.slice(i, i + CONCURRENCY);

    const results = await Promise.all(
      batch.map(async (p) => {
        const content = await generateWithValidation(p);
        console.log(`✅ ${p.productName.slice(0, 20)}… 生成完了`);
        return { sku: p.sku, content };
      })
    );

    for (const { sku, content } of results) {
      sheet.addRow({
        sku,
        title: content.title,
        bp1: content.bulletPoints[0] ?? '',
        bp2: content.bulletPoints[1] ?? '',
        bp3: content.bulletPoints[2] ?? '',
        bp4: content.bulletPoints[3] ?? '',
        bp5: content.bulletPoints[4] ?? '',
        description: content.description,
      });
    }

    if (i + CONCURRENCY < products.length) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  await workbook.xlsx.writeFile(outputPath);
  console.log(`\n📊 Excel出力完了: ${outputPath} (${products.length}商品)`);
}

// 実行例
const products: ProductRow[] = JSON.parse(
  fs.readFileSync('products.json', 'utf-8')
);

await bulkGenerateAmazonPages(products, 'amazon-bulk-upload.xlsx');
```

## 実際の出力例

**入力：**
```json
{
  "brandName": "まるみや海産",
  "productName": "三陸産 活〆タコ 塩蔵（ボイル済み）500g",
  "ingredients": "真蛸（岩手県産）、食塩",
  "features": "岩手県山田湾で一本釣りした真蛸。活〆後すぐボイルし鮮度を閉じ込めた。吸盤のコリコリ食感が強い",
  "region": "岩手県山田湾",
  "weight": "500g",
  "shelfLife": "冷凍で6ヶ月",
  "storageMethod": "-18℃以下で冷凍保存",
  "certifications": ["無添加", "産地直送", "国産"]
}
```

**出力（抜粋）：**

```
【タイトル】
まるみや海産 三陸 岩手県山田湾産 活〆真蛸 塩蔵ボイル 500g 産地直送 無添加 冷凍

【箇条書き1】
岩手県山田湾で一本釣りした三陸産真蛸を使用。漁獲直後に活〆処理を施し、鮮度最高潮の状態でボイル・急速冷凍。解凍するだけでプロの一品に仕上がります。

【箇条書き2】
食塩のみ使用の無添加仕立て。化学調味料・保存料は一切不使用なので、ご家族みなさまに安心してお召し上がりいただけます。産地から直送のため中間業者を通らない鮮度でお届け。

【箇条書き3】
吸盤部分のコリコリ食感と、やわらかい足の対比が楽しめます。タコ刺し・たこ焼き・酢だこ・アヒージョなど多彩な料理に使え、解凍後すぐに切り分けて使えます。

【A+コンテンツ 見出し】
三陸の海が育てた、活〆真蛸の旨みをそのまま食卓へ

【A+セクション「山田湾という産地」】
岩手県山田湾は三陸海岸の中でも特に水温が安定した入り江。親潮の冷たい海水が藻場を育み、真蛸のエサとなる小魚・貝類が豊富なため、年間を通じて肉厚で旨みの濃いタコが育ちます。
```

## コストと効果

**APIコスト（1商品あたり）**

| 項目 | 数値 |
|------|------|
| 平均入力トークン | 約600 |
| 平均出力トークン | 約800 |
| 1商品あたりのコスト | 約0.5円 |
| 50商品の合計コスト | 約25円 |

**作業時間の変化**

| 指標 | Before | After |
|------|--------|-------|
| 1商品のページ作成時間 | 1〜2時間 | 確認+修正20分 |
| 50商品の合計時間 | 約1週間 | 約半日 |
| Amazon出品までのリードタイム | 3〜4週間 | 4日 |
| APIコスト | — | 25円（50商品） |

**業者さんの感想：** 「もうAmazonは別世界の話だと思ってたけど、出品できました。Shopifyと比べてもAmazonはやっぱり流入が全然違う」

## ポイントと注意点

**うまくいった点**

- Amazonのタイトルルール（ブランド名から始める・文字数・禁止ワード回避）をプロンプトに明示したことで、規約違反の自動補正がほぼ不要になった
- 箇条書きは「メリット訴求」を意識させるプロンプトにしたことで、仕様の羅列ではなく購買動機につながる文になった
- A+コンテンツの段落数と文字数制限を明示したことで、実際のA+エディタに貼り付けてほぼそのまま使える形で出力された

**注意点**

- Amazon独自の「禁止ワード」（「最高品質」「No.1」など根拠のない表現）はプロンプトで明示的に除外するよう指示する
- カテゴリによってタイトルの書き方ルールが異なる（食品・冷凍食品・生鮮など）。カテゴリをインプットに含めてプロンプトを分岐させると精度が上がる
- 生成されたA+コンテンツは画像とセットで使うのが前提。テキストのみでは効果が半減する。画像の制作・配置は別途人手で行う
- 楽天向けに書いた説明文をそのままAmazon用プロンプトに入れると楽天特有の表現が混入することがある（「SPU」「楽天スーパーポイント」など）。入力はできるだけ素の商品情報にする

## まとめ

AmazonへのEC展開を止めていた最大のボトルネックは「独自ルールに合ったページ作成の手間」だった。

Claude APIで商品情報→Amazonフォーマットの自動変換を挟むことで、50商品のページ準備が1週間から半日に短縮された。コストは25円。

多チャネル展開のハードルが下がると、新しい販路への挑戦が現実的になる。楽天・Shopify・Amazonで同じ商品情報を一元管理しつつ、各プラットフォームのルールに合わせて自動変換する仕組みは、今後の地方ECにとって標準装備になると思っている。

コードのカスタマイズや相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
