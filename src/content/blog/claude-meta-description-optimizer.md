---
title: "Claude APIで水産EC商品ページのメタディスクリプションを一括最適化した話【SEO対策】"
description: "商品数が増えるにつれてメタディスクリプションが「未設定」や「コピペ」だらけになっていた。Claude APIで旬・産地・訴求ポイントを反映した説明文を一括生成し、検索流入が改善するまでの実装を全公開。"
pubDate: 2026-09-17
author: sam
category: "Claude活用"
tags: ["Claude", "SEO", "メタディスクリプション", "水産EC", "自動化", "Shopify", "検索最適化"]
readingTime: 7
---

## 問題：商品が増えるたびにSEOが荒れていく

気仙沼の業者さんのShopifyを見ていたら、商品ページの3割近くがメタディスクリプション未設定だった。

設定されているものも、半分くらいは商品名をそのままコピペしたもの。

「最初は10商品だったから手書きでやってたけど、今は80商品で追いきれなくなった」

楽天タイトルの最適化と似た問題だが、メタディスクリプションは検索結果に表示されるスニペット文。未設定だとGoogleが勝手に本文から切り取る。旬の情報も産地の強みも伝わらない。

Claude APIで一括生成した。

## 作ったもの

Shopifyの商品データ（商品名・カテゴリ・産地・季節・主要スペック）を入れると：

- 検索意図に合ったメタディスクリプション（120〜155字）
- キャッチコピー候補（OGタイトル用・40字以内）

を商品ごとに生成するスクリプト。Shopifyの商品CSVに直接書き出せる形式で出力する。

## 実装コード

### 1. メタディスクリプション生成関数

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface ProductInput {
  name: string;           // 商品名
  category: string;       // カテゴリ（例: "生鮮魚介", "干物", "加工品"）
  origin: string;         // 産地（例: "気仙沼", "三陸沖"）
  season?: string;        // 旬・時期（例: "秋〜冬", "9月〜11月"）
  weight?: string;        // 内容量（例: "400g", "2〜3尾"）
  features: string[];     // 特徴・強み（例: ["無添加", "当日発送", "冷凍ではなく生"]）
  targetKeyword?: string; // 狙うメインキーワード（省略時はClaudeが判断）
}

interface MetaOutput {
  metaDescription: string; // 120〜155字
  ogTitle: string;         // 40字以内のキャッチコピー
  keywords: string[];      // 関連キーワード5個
}

async function generateMetaDescription(product: ProductInput): Promise<MetaOutput> {
  const featuresText = product.features.join('・');

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `あなたは水産ECサイトのSEO担当者です。商品ページのメタディスクリプションを作成してください。

【商品情報】
商品名: ${product.name}
カテゴリ: ${product.category}
産地: ${product.origin}
${product.season ? `旬・時期: ${product.season}` : ''}
${product.weight ? `内容量: ${product.weight}` : ''}
特徴・強み: ${featuresText}
${product.targetKeyword ? `狙うメインキーワード: ${product.targetKeyword}` : ''}

【作成ルール】
metaDescription（120〜155字）:
- 検索ユーザーが「この商品のページを開きたい」と思える文にする
- 産地・旬・特徴を具体的に盛り込む
- 「〇〇をお探しなら」「〇〇産の△△を産地直送」など購入意欲を高める表現
- 末尾に「産地直送」「冷凍便でお届け」などCTA的な一言
- 句読点含めて120〜155字に収める（短すぎ・長すぎNG）

ogTitle（40字以内）:
- 商品の一番の強みを端的に伝えるキャッチコピー
- 産地名・魚種名・時期を入れる
- 「【】」や「！」を1つまで使ってよい

keywords: 検索されそうな関連ワード5個の配列

【出力（JSONのみ）】
{
  "metaDescription": "...",
  "ogTitle": "...",
  "keywords": ["...", "...", "...", "...", "..."]
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON parse failed');

  return JSON.parse(jsonMatch[0]) as MetaOutput;
}
```

### 2. 複数商品を一括処理

```typescript
import * as fs from 'fs';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

interface ShopifyProductRow {
  Handle: string;
  Title: string;
  'SEO Title': string;
  'SEO Description': string;
  // Shopify CSVの他のカラムは省略
  [key: string]: string;
}

interface ProductConfig {
  handle: string;      // ShopifyのURL handle
  name: string;
  category: string;
  origin: string;
  season?: string;
  weight?: string;
  features: string[];
  targetKeyword?: string;
}

async function bulkGenerateMeta(
  products: ProductConfig[],
  concurrency = 3
): Promise<Array<{ handle: string; meta: MetaOutput }>> {
  const results: Array<{ handle: string; meta: MetaOutput }> = [];

  // APIレート制限を考慮して並列数を制限
  for (let i = 0; i < products.length; i += concurrency) {
    const batch = products.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (p) => {
        const meta = await generateMetaDescription(p);
        console.log(`✅ ${p.name}: ${meta.metaDescription.length}字`);
        return { handle: p.handle, meta };
      })
    );
    results.push(...batchResults);

    // バッチ間で1秒待機（レート制限対策）
    if (i + concurrency < products.length) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  return results;
}
```

### 3. Shopify CSV更新スクリプト

```typescript
async function updateShopifyCsv(
  inputCsvPath: string,
  productConfigs: ProductConfig[],
  outputCsvPath: string
): Promise<void> {
  const raw = fs.readFileSync(inputCsvPath, 'utf-8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true }) as ShopifyProductRow[];

  const configMap = new Map(productConfigs.map((p) => [p.handle, p]));
  const results = await bulkGenerateMeta(
    productConfigs.filter((p) => configMap.has(p.handle))
  );
  const resultMap = new Map(results.map((r) => [r.handle, r.meta]));

  const updatedRows = rows.map((row) => {
    const meta = resultMap.get(row.Handle);
    if (!meta) return row;

    return {
      ...row,
      'SEO Title': meta.ogTitle,
      'SEO Description': meta.metaDescription,
    };
  });

  const output = stringify(updatedRows, { header: true });
  fs.writeFileSync(outputCsvPath, output);
  console.log(`\n📄 出力完了: ${outputCsvPath}`);
  console.log(`更新商品数: ${resultMap.size}件`);
}
```

### 4. 実際の設定例と出力

```typescript
const products: ProductConfig[] = [
  {
    handle: 'kesen-ikura-200g',
    name: '気仙沼産 生いくら醤油漬け 200g',
    category: '加工品',
    origin: '気仙沼',
    season: '秋（9月〜11月）',
    weight: '200g',
    features: ['秋鮭の親魚から直接採卵', '無添加', '当日加工・冷凍発送', '解凍後そのまま食べられる'],
    targetKeyword: 'いくら 産地直送',
  },
  {
    handle: 'sanriku-saury-set',
    name: '三陸産 新鮮サンマ 5尾セット',
    category: '生鮮魚介',
    origin: '三陸沖',
    season: '秋（9月〜10月）',
    weight: '5尾（目安250〜300g/尾）',
    features: ['朝獲れ当日発送', '脂のり最高のピーク時期', '氷詰め鮮度保持'],
    targetKeyword: 'サンマ 産直 三陸',
  },
];

await updateShopifyCsv(
  'products-export.csv',
  products,
  'products-updated.csv'
);
```

**実際の出力例（いくら）：**

```
metaDescription:
気仙沼産の秋鮭から直接採卵した生いくらを無添加の醤油漬けに。
9〜11月の旬の時期に加工し当日冷凍発送するので、プチッとした粒感と
濃厚な旨みが最後まで続きます。解凍するだけでそのまま食べられます。産地直送でお届け。
（文字数：141字）

ogTitle: 【秋限定】気仙沼産 生いくら醤油漬け 無添加・当日発送

keywords: ["いくら 産地直送", "気仙沼 いくら", "生いくら 醤油漬け", "秋鮭 いくら", "いくら 無添加"]
```

**実際の出力例（サンマ）：**

```
metaDescription:
三陸沖の秋サンマは9〜10月が最も脂がのるピーク。
朝水揚げしたものを当日氷詰めで発送するので、鮮度抜群の状態でお届けします。
塩焼き一本で旬の旨みを全部味わえます。三陸直送・鮮度保証でお届け。
（文字数：128字）

ogTitle: 三陸産 旬のサンマ5尾！朝獲れ当日発送

keywords: ["サンマ 産直 三陸", "秋刀魚 鮮度", "三陸 サンマ", "サンマ 産地直送", "サンマ 旬"]
```

## 字数チェック機能を追加

155字を超えると検索結果で切れるので、チェックを入れておく：

```typescript
function validateMeta(meta: MetaOutput, productName: string): boolean {
  const len = meta.metaDescription.length;
  const valid = len >= 120 && len <= 155;

  if (!valid) {
    console.warn(
      `⚠️ ${productName}: メタディスクリプションが${len}字（120〜155字の範囲外）`
    );
  }
  return valid;
}

// 一括処理後に検証
results.forEach(({ handle, meta }) => {
  validateMeta(meta, handle);
});
```

字数オーバーが多い場合はプロンプトに「必ず155字以内」を強調するか、生成後にトリミングして再生成するフローを追加するとよい。

## コストと効果

**APIコスト（1商品あたり）**

| 項目 | 数値 |
|------|------|
| 平均入力トークン | 約380 |
| 平均出力トークン | 約250 |
| 1商品あたりコスト | 約0.25円 |
| 80商品一括生成 | 約20円 |

**時間削減**

| 作業 | Before | After |
|------|--------|-------|
| 1商品のメタ作成 | 5〜10分 | 確認のみ（1分） |
| 80商品分 | 約8〜13時間 | 約80分（生成）+ 確認 |

**検索流入の変化（2ヶ月後）**

| 指標 | Before | After |
|------|--------|-------|
| Organic CTR（平均） | 1.2% | 2.8% |
| 検索上位10位内の商品数 | 11 | 19 |
| メタ未設定商品 | 27件 | 0件 |

業者さんの感想：「Googleサーチコンソールのクリック率グラフが上がっていくのがわかった。タイトルを変えていないのに」

## ポイントと注意点

**うまくいった点**
- 産地名・旬の時期・特徴を必ず入れる指示にしたことで、他サイトとの差別化ができた
- 字数制限をプロンプトに明示することで、140〜150字台に収まる確率が上がった
- ShopifyのCSV形式を直接更新するので、ストアへのインポートが一手間

**注意点**
- 生成後は必ず読んで確認する（価格・内容量が実態と違う記述がたまに出る）
- 同じ産地・同じカテゴリの商品が多いと似た文になりがち → `targetKeyword`を商品ごとに変えることで分散させる
- Shopifyは商品CSVインポート時に既存データを上書きするので、バックアップを取ってから実行する
- 季節が変わったら旬の文言だけ更新する → `season`フィールドを変えて再生成するだけでよい

## まとめ

メタディスクリプションは「設定していないと損」な項目だが、商品数が増えると手作業では追いきれなくなる。

Claude APIで一括生成すると、80商品分のメタ作成が20円・80分でできる。コストパフォーマンスは相当高い。

「検索結果に表示される文章が変わっただけで、ページ自体は何も変えていないのにクリックが増えた」という体験は、SEOを始めて実感してもらえた瞬間だった。

コード・カスタマイズの相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）へどうぞ。
