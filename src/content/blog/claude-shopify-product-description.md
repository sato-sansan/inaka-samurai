---
title: "Claude APIでShopify商品説明文を10秒で生成した話【水産加工業者での実装例】"
description: "気仙沼の水産加工業者さんと取り組んだ事例。商品名と原材料を入れるだけで、SEOを意識した商品説明文をClaudeが自動生成。EC立ち上げのボトルネックが消えました。"
pubDate: 2026-07-31
author: sam
category: "Claude活用"
tags: ["Claude", "Shopify", "商品説明", "自動化", "EC", "水産業"]
readingTime: 7
---

## きっかけ

気仙沼でカツオの加工品をネット販売しようとしている事業者さんから相談を受けた。

「商品は50種類あるんだけど、説明文を全部書くのが大変で…ECサイトを立ち上げられずにいる」

あるある。商品数が多い業者ほど、説明文の量に圧倒されて止まってしまう。

これ、Claude APIで解決できると思った。

## 作ったもの

商品名・原材料・特徴メモを入力すると、ShopifyのECサイト向けに最適化された商品説明文（日本語）を自動生成するツール。

**出力フォーマット：**
- キャッチコピー（1行）
- 商品説明（150〜200字）
- おすすめの食べ方（3点）
- SEOキーワードを自然に含んだ詳細説明

## 実装コード

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface ProductInfo {
  name: string;
  ingredients: string;
  notes?: string;
  region?: string;
}

async function generateProductDescription(product: ProductInfo): Promise<string> {
  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `あなたは地方産品のECコピーライターです。
以下の情報をもとに、Shopify向けの商品説明文を日本語で作成してください。

【商品情報】
商品名: ${product.name}
原材料: ${product.ingredients}
特徴メモ: ${product.notes ?? 'なし'}
産地: ${product.region ?? '宮城県気仙沼'}

【出力フォーマット】
## キャッチコピー
（20字以内、地域性と品質感を出す）

## 商品説明
（150〜200字。産地の魅力と食べ方の想像を広げる内容）

## おすすめの食べ方
- （1）
- （2）
- （3）

## 詳細説明
（300字程度。素材・製法・地域の背景を入れてSEOを意識する）`,
      },
    ],
  });

  return message.content[0].type === 'text' ? message.content[0].text : '';
}

// 使用例
const result = await generateProductDescription({
  name: '気仙沼産 本カツオ たたき（冷凍）200g',
  ingredients: 'かつお（宮城県気仙沼産）、食塩',
  notes: '藁焼き、無添加、個別急速冷凍',
  region: '宮城県気仙沼市',
});

console.log(result);
```

## 実際の出力例

```
## キャッチコピー
三陸の海が育てた、藁焼き本カツオ

## 商品説明
宮城県気仙沼港に水揚げされた本カツオを、伝統の藁焼きで豪快に仕上げました。
化学調味料・保存料は一切不使用。個別急速冷凍なので、食べたい分だけ解凍してすぐお使いいただけます。

## おすすめの食べ方
- 薬味（生姜・ネギ・にんにく）をたっぷりのせてポン酢で
- 薄切りにして海鮮丼のトッピングに
- 刻んでカツオの漬け丼として

## 詳細説明
気仙沼は三陸沖の豊かな海流が交わる日本屈指のカツオの水揚げ港です。
（以下300字...）
```

ほぼそのまま使える。手直しは固有名詞の確認だけで済む。

## バッチ処理で50商品を一気に

```typescript
import * as fs from 'fs';

const products: ProductInfo[] = JSON.parse(
  fs.readFileSync('products.json', 'utf-8')
);

const results = await Promise.all(
  products.map(async (p) => ({
    name: p.name,
    description: await generateProductDescription(p),
  }))
);

fs.writeFileSync('descriptions.json', JSON.stringify(results, null, 2));
```

`products.json` にCSVから変換した商品リストを入れて実行するだけ。50商品で**約2分、コスト80円程度**（Claude APIの従量課金）。

## 結果

| 作業 | Before | After |
|------|--------|-------|
| 商品説明1件の作成時間 | 30〜45分 | 10秒（確認含め5分） |
| 50商品の合計時間 | 約25時間 | 約4時間（確認・修正） |
| ECサイト立ち上げまでの期間 | 未着手 | 2週間で公開 |

事業者さんの感想：「もう説明文が怖くない」

## まとめ・次のステップ

商品説明文の自動生成は、地方のEC事業者にとってもっとも即効性のあるAI活用の一つだと思っています。

次は多言語対応（英語・中国語）の自動生成を試す予定。インバウンド需要を狙う業者さんへの展開を考えています。

コードをそのまま使いたい方はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）に声かけてください。
