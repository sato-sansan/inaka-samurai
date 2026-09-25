---
title: "Claude APIで鍋物シーズン向け水産セット商品ページのコピーを一括生成した話【三陸水産EC】"
description: "10月になると『鍋セット』の問い合わせが増える。毎年10種類以上の鍋セットの商品ページを1から書き直していた作業を、Claude APIで一括生成したら40分で終わった話。"
pubDate: 2026-09-25
author: sam
category: "Claude活用"
tags: ["Claude", "EC自動化", "商品ページ", "鍋物", "水産業", "Shopify", "コピーライティング"]
readingTime: 8
---

## 「鍋のページ、今年も全部書き直しですか？」

9月末、クライアントから毎年来るこのメッセージ。

「10月から鍋セットをプッシュしたい。去年のページは価格と写真だけ差し替えたんですが、文章がずっと一緒で…今年こそちゃんとしたいんですよね」

気持ちはわかる。でも「ちゃんとした」商品ページを10種類以上書くのは丸1日の仕事だ。しかも毎年やることになる。

カニ鍋セット、牡蠣鍋セット、サーモン鍋セット、海鮮ちゃんこセット……三陸の水産ECは鍋物シーズンに強い。この時期の売上がEC全体の3割を占める。だからこそ商品ページに手を抜けない。

Claude APIに商品の基本情報（素材・重量・産地）を渡したら、商品タイトル・キャッチコピー・詳細説明文・レシピ提案を一発で出してくれた。

## 作ったもの

入力：
- 商品名（内部管理用の素っ気ないやつ）
- 素材リスト（品目・重量・産地）
- 対象人数・価格帯
- 禁止ワード・ブランドトーン（一度設定すれば全商品に適用）

出力：
- Shopify用商品タイトル（60文字以内）
- キャッチコピー（2案）
- 商品説明文（300〜400文字）
- 素材の特徴を伝えるブレットポイント（3〜5点）
- おすすめレシピ名（2〜3案）

## 実装コード

### 1. 商品情報の型定義とコア生成関数

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface NabeProductInput {
  internalName: string;     // 内部管理名（例: "kani-nabe-set-L"）
  ingredients: {
    name: string;           // 素材名
    weight: string;         // 重量（例: "400g"）
    origin: string;         // 産地
  }[];
  servings: string;         // 対象人数（例: "2〜3人前"）
  priceRange: string;       // 価格帯（例: "6,800円〜"）
  mainItem: string;         // 看板食材（例: "ズワイガニ"）
}

interface NabeProductCopy {
  title: string;            // 商品タイトル
  catchCopies: string[];    // キャッチコピー2案
  description: string;      // 商品説明文
  bulletPoints: string[];   // 素材ブレットポイント
  recipeNames: string[];    // レシピ提案
}

const BRAND_TONE = `
三陸・気仙沼の水産ECサイトの文体ルール：
- 産地・鮮度・漁師との関係性に誇りを持った書き方
- 押しつけがましい売り込みは避ける
- 「旬」「水揚げ」「漁師」などのキーワードを自然に使う
- 家族の食卓・食べる人の笑顔をイメージさせる
- 禁止表現：「最高」「激安」「爆売れ」「絶対」
`.trim();

async function generateNabeCopy(
  product: NabeProductInput
): Promise<NabeProductCopy> {
  const ingredientList = product.ingredients
    .map((i) => `・${i.name}（${i.weight}、${i.origin}産）`)
    .join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: `あなたは水産ECサイトのコピーライターです。
鍋物シーズン向け商品ページのコピーを作成してください。

【ブランドトーン】
${BRAND_TONE}

【商品情報】
管理名：${product.internalName}
看板食材：${product.mainItem}
対象人数：${product.servings}
価格帯：${product.priceRange}

【素材一覧】
${ingredientList}

【依頼内容】
以下をJSONで出力してください。説明文は不要です。

{
  "title": "Shopify商品タイトル（60文字以内、看板食材と人数・産地を含む）",
  "catchCopies": [
    "キャッチコピー案1（20〜30文字、食欲をそそる表現）",
    "キャッチコピー案2（20〜30文字、産地・鮮度訴求）"
  ],
  "description": "商品説明文（300〜400文字。看板食材の特徴→素材の組み合わせの良さ→食卓イメージの順で展開）",
  "bulletPoints": [
    "素材ブレットポイント1（看板食材の産地・特徴）",
    "素材ブレットポイント2",
    "素材ブレットポイント3",
    "ブレットポイント4（保存・解凍方法）",
    "ブレットポイント5（配送・鮮度保持）"
  ],
  "recipeNames": [
    "おすすめレシピ名1",
    "おすすめレシピ名2",
    "おすすめレシピ名3"
  ]
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON パース失敗');

  return JSON.parse(jsonMatch[0]) as NabeProductCopy;
}
```

### 2. 複数商品を一括処理してShopify用CSVに出力

```typescript
import * as fs from 'fs';

interface ShopifyRow {
  Handle: string;
  Title: string;
  'Body (HTML)': string;
  Tags: string;
}

function buildHtmlBody(copy: NabeProductCopy): string {
  const bullets = copy.bulletPoints
    .map((b) => `<li>${b}</li>`)
    .join('\n');

  const recipes = copy.recipeNames
    .map((r) => `<li>${r}</li>`)
    .join('\n');

  return `
<p><em>${copy.catchCopies[0]}</em></p>
<p>${copy.description}</p>
<ul>
${bullets}
</ul>
<p><strong>おすすめレシピ</strong></p>
<ul>
${recipes}
</ul>
`.trim();
}

async function generateBulkNabeCopies(
  products: NabeProductInput[],
  outputPath: string
): Promise<void> {
  const rows: ShopifyRow[] = [];
  let processed = 0;

  for (const product of products) {
    try {
      console.log(`📝 生成中: ${product.internalName}`);
      const copy = await generateNabeCopy(product);

      rows.push({
        Handle: product.internalName,
        Title: copy.title,
        'Body (HTML)': buildHtmlBody(copy),
        Tags: `鍋物,${product.mainItem},三陸,海鮮鍋`,
      });

      processed++;
      console.log(`✅ ${processed}/${products.length} 完了: ${copy.title}`);

      // レート制限対策
      await new Promise((r) => setTimeout(r, 1200));
    } catch (err) {
      console.error(`❌ ${product.internalName} の生成に失敗:`, err);
    }
  }

  // CSV出力
  const headers = Object.keys(rows[0]) as (keyof ShopifyRow)[];
  const headerLine = headers.join(',');
  const dataLines = rows.map((row) =>
    headers
      .map((h) => `"${String(row[h]).replace(/"/g, '""')}"`)
      .join(',')
  );

  fs.writeFileSync(outputPath, [headerLine, ...dataLines].join('\n'), 'utf-8');
  console.log(`\n📄 ${outputPath} に出力しました（${rows.length}件）`);
}
```

### 3. 実行スクリプト

```typescript
async function main() {
  const products: NabeProductInput[] = [
    {
      internalName: 'kani-nabe-set-M',
      mainItem: 'ズワイガニ',
      servings: '2〜3人前',
      priceRange: '8,500円',
      ingredients: [
        { name: 'ズワイガニ（半割り）', weight: '600g', origin: '三陸沖' },
        { name: '生牡蠣', weight: '200g', origin: '気仙沼' },
        { name: '真鱈の切り身', weight: '200g', origin: '三陸沖' },
        { name: '帆立貝柱', weight: '100g', origin: '三陸' },
        { name: '長ねぎ・白菜・春雨', weight: '一式', origin: '国産野菜' },
      ],
    },
    {
      internalName: 'oyster-nabe-set-L',
      mainItem: '気仙沼産牡蠣',
      servings: '3〜4人前',
      priceRange: '5,800円',
      ingredients: [
        { name: '殻付き牡蠣', weight: '1kg（約12個）', origin: '気仙沼' },
        { name: '生食用むき牡蠣', weight: '200g', origin: '気仙沼' },
        { name: 'タラの切り身', weight: '300g', origin: '三陸沖' },
        { name: '豆腐・白菜・えのき', weight: '一式', origin: '国産' },
      ],
    },
    {
      internalName: 'chanko-seafood-set',
      mainItem: '三陸海鮮ちゃんこ',
      servings: '4〜5人前',
      priceRange: '7,200円',
      ingredients: [
        { name: 'ズワイガニ（ポーション）', weight: '300g', origin: '三陸沖' },
        { name: '殻付き帆立', weight: '4枚', origin: '三陸' },
        { name: '生牡蠣', weight: '200g', origin: '気仙沼' },
        { name: 'サーモン切り落とし', weight: '200g', origin: '三陸沖' },
        { name: 'タラ・野菜・こんにゃく', weight: '一式', origin: '国産' },
      ],
    },
  ];

  await generateBulkNabeCopies(products, 'nabe-shopify-import.csv');
}

main().catch(console.error);
```

### 4. 実際の出力例（カニ鍋セット）

```
📝 生成中: kani-nabe-set-M
✅ 1/3 完了: 三陸産ズワイガニの海鮮鍋セット M（2〜3人前）気仙沼直送
```

**生成されたコピー：**

```json
{
  "title": "三陸産ズワイガニの海鮮鍋セット M（2〜3人前）気仙沼直送",
  "catchCopies": [
    "今宵の鍋に、三陸の海ごと届けます",
    "水揚げ翌日出荷、ズワイガニの甘みを鍋で"
  ],
  "description": "三陸沖で獲れたズワイガニを主役に、気仙沼の生牡蠣・真鱈・帆立貝柱を合わせた贅沢な海鮮鍋セットです。ズワイガニの出汁が鍋全体に広がり、野菜にまでしみ込む旨味は产直ならではの味わい。産地から直送することで、スーパーでは出せない鮮度のまま食卓にお届けします。寒い夜に家族で囲む一鍋として、また大切な方への贈り物としても喜ばれています。昆布出汁の鍋つゆとの相性は抜群。〆は雑炊で、カニと牡蠣の旨味を余すところなく味わってください。",
  "bulletPoints": [
    "三陸沖産ズワイガニ（半割り600g）：甘みと旨味が凝縮、鍋全体に出汁が広がる",
    "気仙沼産生牡蠣（200g）：濃厚なミルク牡蠣、火を通しすぎず半生で食べるのがおすすめ",
    "三陸産真鱈・帆立貝柱：淡泊なタラがカニ出汁を吸い、帆立の甘みが全体をまとめる",
    "冷凍真空パックでお届け：冷蔵庫で一晩解凍後すぐ使用可。賞味期限は冷凍で製造から90日",
    "クール便で産地直送：水揚げ翌日に加工・出荷。到着後は冷蔵保存で当日中にお召し上がりください"
  ],
  "recipeNames": [
    "昆布だしのあっさりカニ鍋（〆は雑炊）",
    "味噌仕立て三陸海鮮ちゃんこ",
    "カニと牡蠣のクリームシチュー鍋"
  ]
}
```

## コストと効果

**APIコスト（10商品一括処理）**

| 処理 | トークン数（概算） | コスト |
|------|------------------|--------|
| 1商品あたり入力 | 約800トークン | — |
| 1商品あたり出力 | 約700トークン | — |
| 10商品合計 | 入力8,000＋出力7,000 | **約7円** |

**工数削減**

| 作業 | Before（手動） | After（Claude API） |
|------|--------------|-------------------|
| 10商品のコピーライティング | 丸1日（約7〜8時間） | 40分（実行20分＋確認20分） |
| Shopifyへの入稿作業 | 2〜3時間 | CSVインポートで10分 |
| 毎年の更新コスト | 同上 | 同上（ほぼ再実行だけ） |

**クライアントの反応：**

「昨年は文章を使い回してたので、商品ページに行ったお客さんが『前と同じだ』って感じてたと思う。今年は全部新しくなってるし、牡蠣の説明文を読んだお客さんが問い合わせフォームで『半生ってどういう火加減ですか？』って聞いてきた。ちゃんと読まれてる実感があった」

## ポイントと注意点

**うまくいった点**
- ブランドトーンを1箇所で管理するので、全商品のトーンが統一される
- `bulletPoints` の5点目を「配送・鮮度保持」に固定することで、毎回同じ安心訴求が入る
- Shopify CSVフォーマットで直接出力するので、確認後すぐインポートできる

**注意点**
- 生成後は必ず人間が「重量・価格・産地」の事実確認をする。Claudeは入力情報をそのまま使うが、入力ミスは見抜けない
- `catchCopies` は2案出るので、A/Bテストや媒体によって使い分けると効果的
- 毎年「昨年のコピーの評価」をプロンプトに追加情報として入れると、改善が積み上がる

## まとめ

10月の鍋物シーズンに間に合わせるために、毎年9月末にコピーライティングの時間を取っていた。それが7円・40分で終わる。

「産地への誇り」「鮮度の説明」「家族の食卓イメージ」——水産ECで響くコピーの要素は毎年変わらない。だからこそ型化してClaude APIに任せられる。

来年は「昨年のSEO検索キーワード順位」もプロンプトに追加して、検索流入も意識したコピーに進化させる予定。

コード・カスタマイズ相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
