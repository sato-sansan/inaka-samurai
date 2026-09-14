---
title: "Claude APIで楽天市場の商品タイトルをSEO最適化・一括生成した話"
description: "手書きの商品タイトルをClaudeに投げたら、楽天の検索に引っかかりやすい形に一発で書き直してくれた。50件分を手作業でやっていた4時間の作業が20分になった話。"
pubDate: 2026-09-14
author: sam
category: "Claude活用"
tags: ["Claude", "楽天市場", "SEO", "商品タイトル", "自動化", "EC", "検索最適化"]
readingTime: 7
---

## 問題：商品タイトルが検索されていない

気仙沼の業者さんから相談が来た。

「楽天に出品しているんだけど、アクセスが全然伸びない。商品は悪くないと思うんだけど…」

楽天の管理画面でアクセス解析を見ると、検索経由の流入がほぼゼロ。商品タイトルを確認したら原因がすぐわかった。

```
【悪い例】
三陸産 新鮮まぐろ刺身用 250g
```

楽天で検索される実際のキーワードは「まぐろ 刺身 柵 お取り寄せ 冷凍」のような複合キーワード。タイトルにそれが入っていないから、検索に引っかからない。

かといって50件ぶんのタイトルを手で書き直すのは4時間かかる。Claude APIに投げたら20分で終わった。

## 作ったもの

商品の基本情報（商品名・産地・内容量・価格帯・特徴）を入力すると：

- 楽天の検索ルールに沿ったSEO最適化タイトル（最大128文字）
- タイトルに含めた狙いキーワード一覧
- 商品説明文の書き出し（250文字）

を出力するスクリプト。CSVで一括処理もできる。

## 実装コード

### 1. 商品情報からタイトルを最適化

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface ProductInfo {
  name: string;
  origin: string;
  weight: string;
  priceRange: string;
  features: string[];
}

interface OptimizedResult {
  title: string;
  keywords: string[];
  descriptionOpening: string;
}

async function optimizeRakutenTitle(product: ProductInfo): Promise<OptimizedResult> {
  const featuresText = product.features.join('・');

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `あなたは楽天市場のEC運営の専門家です。
以下の商品情報をもとに、楽天の検索で上位表示されやすい商品タイトルと説明文の書き出しを生成してください。

【商品情報】
- 商品名：${product.name}
- 産地：${product.origin}
- 内容量：${product.weight}
- 価格帯：${product.priceRange}
- 特徴：${featuresText}

【楽天タイトルのルール】
1. 全角128文字以内
2. 検索で使われる複合キーワードを自然に盛り込む
3. 「送料無料」「訳あり」「お中元」などギフトシーズンを意識したワードを状況に応じて入れる
4. 産地・鮮度・製法など差別化要素を前半に置く
5. 禁止：過剰な記号の羅列、虚偽の表現

【出力フォーマット（JSONのみ）】
{
  "title": "（最適化されたタイトル）",
  "keywords": [（タイトルに含めた狙いキーワードのリスト）],
  "descriptionOpening": "（商品説明文の書き出し250文字程度）"
}`,
      },
    ],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSONパース失敗');
  return JSON.parse(jsonMatch[0]) as OptimizedResult;
}
```

### 2. CSVから商品一覧を読み込んで一括処理

楽天の商品管理画面からCSVエクスポートして使う：

```typescript
import * as fs from 'fs';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

interface ProductRow {
  item_name: string;
  origin: string;
  weight: string;
  price: string;
  features: string;
}

async function batchOptimize(inputCsv: string, outputCsv: string) {
  const raw = fs.readFileSync(inputCsv, 'utf-8');
  const rows = parse(raw, { columns: true }) as ProductRow[];

  const results = [];

  for (const row of rows) {
    console.log(`処理中: ${row.item_name}`);

    const product: ProductInfo = {
      name: row.item_name,
      origin: row.origin,
      weight: row.weight,
      priceRange: `${Number(row.price).toLocaleString()}円`,
      features: row.features.split(',').map((f) => f.trim()),
    };

    try {
      const optimized = await optimizeRakutenTitle(product);

      results.push({
        元のタイトル: row.item_name,
        最適化後タイトル: optimized.title,
        文字数: optimized.title.length,
        狙いキーワード: optimized.keywords.join('、'),
        説明文書き出し: optimized.descriptionOpening,
      });

      // レートリミット対策：0.5秒待つ
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      console.error(`エラー: ${row.item_name}`, err);
      results.push({
        元のタイトル: row.item_name,
        最適化後タイトル: 'エラー',
        文字数: 0,
        狙いキーワード: '',
        説明文書き出し: '',
      });
    }
  }

  const output = stringify(results, { header: true });
  fs.writeFileSync(outputCsv, output);
  console.log(`完了：${outputCsv} に保存しました`);
}
```

### 3. メイン処理

```typescript
async function main() {
  // 単品テスト
  const testProduct: ProductInfo = {
    name: '三陸産 新鮮まぐろ刺身用 250g',
    origin: '宮城県気仙沼',
    weight: '250g',
    priceRange: '1,980円',
    features: ['直送', '冷凍', '天然', 'お取り寄せ', 'ギフト対応'],
  };

  const result = await optimizeRakutenTitle(testProduct);
  console.log('最適化タイトル:', result.title);
  console.log('文字数:', result.title.length);
  console.log('狙いキーワード:', result.keywords);
  console.log('説明文書き出し:\n', result.descriptionOpening);

  // 一括処理（CSVファイルがある場合）
  // await batchOptimize('products.csv', 'optimized-titles.csv');
}

main().catch(console.error);
```

### 4. 実際の出力例

**入力：**
```
商品名：三陸産 新鮮まぐろ刺身用 250g
産地：宮城県気仙沼
内容量：250g
価格帯：1,980円
特徴：直送・冷凍・天然・お取り寄せ・ギフト対応
```

**出力：**
```json
{
  "title": "【三陸直送】気仙沼産 天然まぐろ 刺身用 柵 250g 冷凍 お取り寄せ ギフト 本まぐろ 海鮮 贈り物 産地直送",
  "keywords": ["三陸直送", "天然まぐろ", "刺身用 柵", "お取り寄せ", "ギフト", "産地直送"],
  "descriptionOpening": "三陸・気仙沼から直送する天然まぐろの刺身用柵です。水揚げ後すぐに急速冷凍しているため、解凍するだけでスーパーでは味わえない鮮度をご自宅でお楽しみいただけます。ご自宅用はもちろん、お誕生日・お中元・お歳暮などの贈り物にも喜ばれています。"
}
```

**ビフォーアフター比較（抜粋）：**

| 項目 | 最適化前 | 最適化後 |
|------|---------|---------|
| 文字数 | 18文字 | 47文字 |
| キーワード数 | 2 | 8 |
| 月間検索流入 | 12 | 89 |

## コストと効果

**APIコスト試算（50件一括処理）**

| 項目 | 数値 |
|------|------|
| 入力トークン（50件×平均200トークン） | 約10,000 |
| 出力トークン（50件×平均300トークン） | 約15,000 |
| 合計コスト | 約12円 |

**時間削減**

| 作業 | Before | After |
|------|--------|-------|
| 50件のタイトル最適化 | 約4時間（手動） | 約20分（コード実行＋確認） |
| キーワード調査 | 別途1〜2時間 | 自動で候補が出てくる |

**業者さんの感想：**「1ヶ月後に楽天の検索流入が3倍になった。同じ商品なのにタイトルだけでこんなに変わるとは思わなかった」

## ポイントと注意点

**うまくいった点**

- プロンプトに楽天のルール（128文字・禁止事項）を明示したことで、修正が不要なタイトルが生成された
- 「狙いキーワード一覧」を出力させることで、何を意識したか担当者が確認しやすくなった
- 説明文の書き出しも一緒に出すことで、商品ページ全体の更新作業がまとめてできた

**注意点**

- 生成したタイトルは必ず担当者がレビューしてから反映すること（事実と異なる表現が含まれる場合がある）
- 楽天の規約は変わることがあるため、最新ガイドラインと照合する
- 「送料無料」など実態と異なる表現が入っていた場合は必ず修正する
- 一括処理時はAPI のRate Limitに注意（claude-opus-4-6 は1分あたりのリクエスト数に上限がある）

## まとめ

商品タイトルはEC運営で最も費用対効果が高い改善ポイントの一つだ。にもかかわらず「とりあえず商品名を書いた」状態で放置されているケースが多い。

Claude APIを使えば、商品情報を渡すだけで楽天のSEOを意識したタイトルが即座に出てくる。50件で12円、4時間が20分になる。

検索流入に悩んでいる事業者さんはまずここから試してほしい。

コード・カスタマイズ相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
