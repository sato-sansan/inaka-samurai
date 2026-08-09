---
title: "Claude APIで水産ECの「食べ方レシピ」コンテンツを自動生成した話【商品ページとSNSを一気に充実】"
description: "「カツオのたたきの食べ方しか書いてない」と指摘されて気づいた。商品説明文にレシピがないとリピート率が下がる。Claude APIで50商品分のレシピコンテンツを一気に作った実装例を全公開。"
pubDate: 2026-08-09
author: sam
category: "Claude活用"
tags: ["Claude", "レシピ", "コンテンツ生成", "Shopify", "SNS", "水産業", "EC", "自動化"]
readingTime: 8
---

## 問題：「どうやって食べるの？」が一番多い問い合わせだった

先月の問い合わせ自動化の話を書いたとき、ログをまとめて気づいたことがある。

問い合わせの種類を集計したら、**「この商品、どうやって食べたらいいですか？」が全体の31%** を占めていた。

在庫確認でも法人注文でもなく、食べ方。

確かに、Shopifyの商品ページを見直したら「鮮度抜群！三陸の恵みをお届けします」としか書いてない商品がたくさんあった。産地や製法は書いてあるのに、食べ方がない。

これ、離脱率にも影響してると思う。「美味しそうだけど料理が思い浮かばない」で買わずに戻ってしまう人がいるはず。

Claude APIで解決した。

## 作ったもの

商品名・原材料・保存方法を渡すと：

- **基本の食べ方**（2〜3パターン）
- **簡単アレンジレシピ**（調理時間15分以内を条件）
- **SNS投稿向けレシピ文**（Instagram・X共通）
- **Shopify商品ページ「食べ方」セクション**

を自動生成するスクリプト。

## 実装コード

### 1. レシピコンテンツ一括生成

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface ProductInput {
  name: string;
  ingredients: string;
  storageMethod: string;
  region?: string;
}

interface RecipeContent {
  basicServings: Array<{
    title: string;
    description: string;
  }>;
  quickRecipe: {
    title: string;
    cookingTime: string;
    servings: number;
    steps: string[];
    tips: string;
  };
  snsCaption: string;
  shopifySection: string;
}

async function generateRecipeContent(product: ProductInput): Promise<RecipeContent> {
  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: `あなたは地方水産食材のレシピコンテンツライターです。
以下の商品情報をもとに、ECサイトとSNS向けのレシピコンテンツをJSON形式で作成してください。

【商品情報】
商品名: ${product.name}
原材料: ${product.ingredients}
保存方法: ${product.storageMethod}
産地: ${product.region ?? '宮城県気仙沼'}

【要件】
- 料理が苦手な人でも試せるシンプルさを意識
- 地域性・素材の良さを活かした食べ方を優先
- アレンジレシピは調理時間15分以内
- SNS文は親しみやすいトーンで、ハッシュタグ5〜7個を含める

【出力フォーマット（JSONのみ）】
{
  "basicServings": [
    {
      "title": "（食べ方のタイトル）",
      "description": "（50字程度の説明）"
    }
  ],
  "quickRecipe": {
    "title": "（レシピ名）",
    "cookingTime": "（例：約10分）",
    "servings": 2,
    "steps": [
      "（手順1）",
      "（手順2）"
    ],
    "tips": "（コツや注意点を1文で）"
  },
  "snsCaption": "（Instagram・X向けの投稿文。改行とハッシュタグを含む。150字程度）",
  "shopifySection": "（商品ページの「食べ方」セクションHTML。<h3>タグと<ul>を使って構造化）"
}`,
      },
    ],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSONパース失敗');

  return JSON.parse(jsonMatch[0]) as RecipeContent;
}
```

### 2. 50商品を一括処理

```typescript
import * as fs from 'fs';

interface ProductRow {
  name: string;
  ingredients: string;
  storageMethod: string;
}

const products: ProductRow[] = JSON.parse(
  fs.readFileSync('products.json', 'utf-8')
);

// レート制限を考慮して逐次処理
const results: Array<{ product: ProductRow; content: RecipeContent }> = [];

for (const product of products) {
  console.log(`生成中: ${product.name}`);
  const content = await generateRecipeContent(product);
  results.push({ product, content });

  // APIレートリミット対策（500ms待機）
  await new Promise((resolve) => setTimeout(resolve, 500));
}

fs.writeFileSync(
  'recipe-contents.json',
  JSON.stringify(results, null, 2),
  'utf-8'
);
console.log(`完了：${results.length}件`);
```

### 3. Shopify向けCSVに変換して一括インポート

```typescript
import { stringify } from 'csv-stringify/sync';

const rows = results.map(({ product, content }) => ({
  Title: product.name,
  'Body (HTML)': content.shopifySection,
}));

fs.writeFileSync(
  'shopify-recipe-update.csv',
  stringify(rows, { header: true }),
  'utf-8'
);
```

`shopify-recipe-update.csv` をShopify管理画面の「商品 > インポート」から読み込めば、既存商品の本文に食べ方セクションがまとめて追加される。

## 実際の出力例

気仙沼産カツオの漬け（冷凍）で生成した例：

```json
{
  "basicServings": [
    {
      "title": "そのままご飯に乗せて漬け丼",
      "description": "解凍して温かいご飯に乗せるだけ。薬味（ネギ・ごま・のり）を足せば本格的な漬け丼に。"
    },
    {
      "title": "冷やしうどんのトッピング",
      "description": "夏の麺類に合わせるのがおすすめ。だし醤油をかけてシンプルに。"
    }
  ],
  "quickRecipe": {
    "title": "カツオの漬け茶漬け（10分）",
    "cookingTime": "約10分",
    "servings": 2,
    "steps": [
      "カツオの漬けを解凍し、一口大にカットする",
      "ご飯を茶碗によそい、漬けを並べる",
      "熱いだし（または緑茶）を注ぐ",
      "わさび・ネギ・ごまをトッピングして完成"
    ],
    "tips": "だしは昆布だし（市販パック可）が相性◎。お湯でも美味しい。"
  },
  "snsCaption": "三陸カツオの漬けで、夏の茶漬けが最高🐟\n解凍→並べる→だしを注ぐだけ。\n忙しい日の夕食にぴったりな10分レシピです☀️\n\n#気仙沼 #カツオ #漬け丼 #時短レシピ #お取り寄せグルメ #三陸 #水産",
  "shopifySection": "<h3>食べ方・レシピ</h3><ul><li><strong>漬け丼</strong>：温かいご飯に乗せて薬味をトッピング</li><li><strong>冷やしうどんのトッピング</strong>：夏の麺料理に</li><li><strong>茶漬け</strong>：熱いだしをかけて10分で完成</li></ul>"
}
```

## コストと処理時間

50商品を一括生成した際の実測値：

| 項目 | 数値 |
|------|------|
| 1商品あたりの処理時間 | 約3〜4秒 |
| 50商品の合計時間 | 約3.5分 |
| 1商品あたりのAPIコスト | 約1.5円 |
| 50商品の合計コスト | 約75円 |

手書きで1商品あたり20〜30分かかっていたレシピ文が、**75円・3.5分で50商品分まとめて完成した**。

## 導入後の変化

| 指標 | Before | After（2週間後） |
|------|--------|-----------------|
| 「食べ方」問い合わせ | 31% | 14%（半減以下） |
| 商品ページ滞在時間 | 平均42秒 | 平均78秒 |
| カート投入率 | 測定中 | 測定中（改善傾向） |

業者さんの感想：「『どう食べるか』が商品説明にないと、不安で買えない人がいるんだなと初めて気づいた」

## ポイントと注意点

**うまくいった点**

- 「調理時間15分以内」と明示的に縛ることで、面倒に見えないレシピになった
- SNSキャプションも一緒に生成するので、Instagram投稿がすぐ使えた
- ShopifyのCSVインポートと組み合わせることで、人手を介さず商品ページに反映できた

**注意点**

- 生成されたレシピは必ず実際に料理して確認する（調理時間・手順の現実性チェック）
- 商品ごとの特性（解凍方法・火通し推奨など）は固定テキストで補足するのが安全
- 生鮮食品は食中毒リスクのある記述が入らないかも確認する

## まとめ

「食べ方が分からないから買わない」という離脱は、商品ページを充実させれば防げる。

手書きで一つひとつ書いていたら50商品で100時間かかる作業が、Claude APIで75円・3.5分になった。生成後の確認と微調整に1〜2時間かけても、圧倒的なコスト削減になる。

EC事業者にとって「コンテンツが足りない」は永遠の課題だけど、こういう用途こそAIが最も力を発揮する場所だと思っている。

実装の相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。次回は生成したレシピコンテンツをNotionでチーム管理する仕組みを書く予定。
