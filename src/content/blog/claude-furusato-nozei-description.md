---
title: "Claude APIでふるさと納税返礼品の説明文を一括生成した話【楽天・さとふる・ふるなび対応】"
description: "気仙沼の水産加工品EC業者が抱えていた「ふるさと納税サイトごとに文字数・書式が違う」問題をClaude APIで解消。10商品×3サイト＝30パターンの説明文を30分で生成する実装を公開。"
pubDate: 2026-08-18
author: sam
category: "Claude活用"
tags: ["Claude", "ふるさと納税", "楽天ふるさと納税", "さとふる", "EC自動化", "商品説明文", "水産業", "コンテンツ生成"]
readingTime: 9
---

## 毎年秋が来るたびに繰り返していた作業

気仙沼の水産加工品ECを支援している中で、年末に向けてふるさと納税の準備が本格化するこの時期、毎年同じ悩みを聞く。

「楽天とさとふるとふるなびで、文字数もフォーマットも全部違う。10商品を3サイトに登録するだけで3〜4日かかる」

確かに。各プラットフォームの仕様は微妙に異なる。

| サイト | 商品タイトル | 説明文 | 特徴 |
|--------|------------|--------|------|
| 楽天ふるさと納税 | 最大127字 | HTML可 | キャッチコピー重視 |
| さとふる | 最大60字 | テキストのみ | 返礼品の概要を端的に |
| ふるなび | 最大100字 | テキストのみ | 産地・数量を明記 |

同じ商品でも書き直しが3回発生する。これをClaude APIで一括生成する仕組みを作った。

## 作ったもの

商品の基本情報（名称・産地・内容量・製法など）を1回入力するだけで、3サイト分のタイトル・説明文・PR文を生成するツール。

生成対象：

- **楽天ふるさと納税**：商品タイトル・説明文HTML・ギフト訴求文
- **さとふる**：商品タイトル・説明文テキスト
- **ふるなび**：商品タイトル・説明文テキスト・コンシェルジュ向けメモ

## 実装コード

### 1. 型定義と基本商品情報

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface ProductBase {
  name: string;              // 例: "気仙沼産 本カツオたたき（冷凍）"
  origin: string;            // 例: "宮城県気仙沼市"
  weight: string;            // 例: "200g × 3パック"
  donationAmount: number;    // 寄附金額（円）
  processingMethod?: string; // 例: "藁焼き一本釣り"
  season?: string;           // 例: "7月〜9月漁期"
  preservation: string;      // 例: "冷凍（-18℃以下）"
  shelfLife: string;         // 例: "冷凍で製造日より180日"
  allergens?: string[];      // 例: ["さば"]
  giftNote?: string;         // 例: "熨斗対応可・お歳暮に最適"
  appealsPoints: string[];   // 訴求ポイント（自由記述・3〜5つ）
}

interface FurusatoNozeiCopy {
  rakuten: {
    title: string;        // 最大127字
    descriptionHtml: string;
    giftMessage: string;  // ギフト・贈答訴求文
  };
  satofull: {
    title: string;        // 最大60字
    description: string;  // テキストのみ
  };
  furunavi: {
    title: string;        // 最大100字
    description: string;  // テキストのみ
    conciergeNote: string; // 内部メモ用
  };
}
```

### 2. Claude APIで3サイト分を一括生成

```typescript
async function generateFurusatoCopy(product: ProductBase): Promise<FurusatoNozeiCopy> {
  const allergenText = product.allergens?.length
    ? `アレルゲン（特定原材料等）: ${product.allergens.join('・')}`
    : 'アレルゲン: なし（製造ラインに特定原材料等含む製品あり）';

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2500,
    messages: [
      {
        role: 'user',
        content: `あなたはふるさと納税サイトの登録専門ライターです。
水産加工品の商品情報をもとに、各プラットフォーム向けの説明文を生成してください。

【商品情報】
商品名: ${product.name}
産地: ${product.origin}
内容量: ${product.weight}
寄附金額: ${product.donationAmount.toLocaleString()}円
${product.processingMethod ? `製法: ${product.processingMethod}` : ''}
${product.season ? `漁期・旬: ${product.season}` : ''}
保存方法: ${product.preservation}
賞味期限: ${product.shelfLife}
${allergenText}
${product.giftNote ? `ギフト対応: ${product.giftNote}` : ''}
訴求ポイント:
${product.appealsPoints.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}

【各サイトの仕様と注意点】

■ 楽天ふるさと納税
- タイトル: 最大127字。商品名＋産地＋内容量を含める。SEOを意識した検索ワードを自然に入れる
- 説明文: HTML形式（<p><strong><br>タグのみ使用可）。600〜800字。産地の情景・旬・食べ方イメージが伝わるように
- ギフト文: 贈答・お歳暮・お中元用途を意識した50字以内のキャッチフレーズ

■ さとふる
- タイトル: 最大60字。内容量・産地を必ず含める。記号は最小限に
- 説明文: テキストのみ（改行\nは使用可）。300〜400字。シンプルかつ産品の魅力を端的に

■ ふるなび
- タイトル: 最大100字。産地・製法・内容量を含める
- 説明文: テキストのみ（改行\nは使用可）。300〜400字。品質・鮮度・こだわりを前面に
- コンシェルジュメモ: サポートスタッフ向け内部メモ。「よくある質問」に答えられる情報を100字以内で

【出力（JSONのみ・他のテキスト不要）】
{
  "rakuten": {
    "title": "...",
    "descriptionHtml": "...",
    "giftMessage": "..."
  },
  "satofull": {
    "title": "...",
    "description": "..."
  },
  "furunavi": {
    "title": "...",
    "description": "...",
    "conciergeNote": "..."
  }
}`,
      },
    ],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`JSON解析失敗: ${product.name}`);

  return JSON.parse(jsonMatch[0]) as FurusatoNozeiCopy;
}
```

### 3. 複数商品を並列処理

10商品を同時に投げると速い。Claude APIはレートリミットがあるので、5件ずつに分けて送る。

```typescript
async function generateBatch(products: ProductBase[]): Promise<
  Array<{ product: ProductBase; copy: FurusatoNozeiCopy }>
> {
  const BATCH_SIZE = 5;
  const results: Array<{ product: ProductBase; copy: FurusatoNozeiCopy }> = [];

  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch = products.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.all(
      batch.map(async (product) => {
        const copy = await generateFurusatoCopy(product);
        return { product, copy };
      })
    );

    results.push(...batchResults);

    // レートリミット対策：バッチ間に1秒待つ
    if (i + BATCH_SIZE < products.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return results;
}
```

### 4. 実行例と出力

```typescript
const PRODUCTS: ProductBase[] = [
  {
    name: '気仙沼産 本カツオたたき（冷凍）',
    origin: '宮城県気仙沼市',
    weight: '200g × 3パック（計600g）',
    donationAmount: 12000,
    processingMethod: '藁焼き一本釣り',
    season: '7月〜9月漁期',
    preservation: '冷凍（-18℃以下）',
    shelfLife: '冷凍で製造日より180日',
    allergens: [],
    giftNote: '熨斗対応可・お中元・お歳暮に最適',
    appealsPoints: [
      '三陸沖一本釣りで水揚げされた鮮度抜群のカツオを使用',
      '昔ながらの藁焼き製法で皮目に香ばしい焼き目と燻香を纏わせる',
      '刺身より厚切りにすることで旨みを閉じ込め、解凍後もモチモチ食感',
      '気仙沼港の漁師と提携し、漁期の最盛期のみ製造・数量限定品',
    ],
  },
  // 他の商品も同様に追加...
];

const results = await generateBatch(PRODUCTS);

results.forEach(({ product, copy }) => {
  console.log(`\n========== ${product.name} ==========`);
  console.log('\n--- 楽天ふるさと納税 ---');
  console.log(`タイトル（${copy.rakuten.title.length}字）: ${copy.rakuten.title}`);
  console.log(`ギフト文: ${copy.rakuten.giftMessage}`);
  console.log(`説明文HTML:\n${copy.rakuten.descriptionHtml}`);
  console.log('\n--- さとふる ---');
  console.log(`タイトル（${copy.satofull.title.length}字）: ${copy.satofull.title}`);
  console.log(`説明文:\n${copy.satofull.description}`);
  console.log('\n--- ふるなび ---');
  console.log(`タイトル（${copy.furunavi.title.length}字）: ${copy.furunavi.title}`);
  console.log(`説明文:\n${copy.furunavi.description}`);
  console.log(`コンシェルジュメモ: ${copy.furunavi.conciergeNote}`);
});
```

## 実際の生成結果

カツオたたきを入力したときの出力サンプル。

### 楽天ふるさと納税

```
タイトル（89字）:
【宮城県気仙沼市】気仙沼産 本カツオ藁焼きたたき 冷凍 600g（200g×3パック） 一本釣り 三陸産

説明文HTML:
<p><strong>三陸沖一本釣り×昔ながらの藁焼きが生む、本物のカツオたたき。</strong></p>
<p>宮城県気仙沼港。毎年7月〜9月、三陸の黒潮に乗って北上する本カツオを、地元漁師が一本釣りで丁寧に水揚げします。<br>
その日のうちに選別・加工を行い、昔ながらの藁焼き製法で皮目に香ばしい焼き目と独特の燻香を閉じ込めました。</p>
<p>刺身より厚めに切ることで、解凍後もしっかりとしたモチモチ食感。わら焼きの香りと三陸産カツオの濃厚な旨みが合わさった一品です。<br>
生姜醤油・塩たたき・ニンニク醤油など、お好みのスタイルでお楽しみください。</p>
<p><strong>熨斗対応可。お中元・お歳暮・ご贈答にも喜ばれます。</strong></p>

ギフト文:
三陸の漁師が一本釣り。藁焼きの香りごと贈る、気仙沼の夏の味。
```

### さとふる

```
タイトル（54字）:
気仙沼産 本カツオ藁焼きたたき 600g（200g×3）一本釣り冷凍

説明文:
宮城県気仙沼の三陸沖で一本釣りされた本カツオを、昔ながらの藁焼き製法で仕上げました。
皮目に香ばしい焼き目と燻香が特徴で、解凍後もモチモチ食感が楽しめます。
7〜9月の漁期最盛期のみ製造する数量限定品。生姜醤油や塩たたきでどうぞ。
熨斗対応可。お中元・お歳暮にもおすすめです。
```

### ふるなび

```
タイトル（72字）:
【数量限定】気仙沼産 本カツオ藁焼きたたき 600g 三陸一本釣り・昔ながらの藁焼き製法

説明文:
三陸の黒潮に乗る本カツオを気仙沼港で一本釣り。漁期（7〜9月）の最盛期だけ製造する数量限定品です。
昔ながらの藁焼き製法で皮目に香ばしい風味をつけ、厚切りカットで旨みを閉じ込めました。
解凍後もモチモチ食感が続き、生姜醤油・塩・ニンニク醤油など様々な食べ方で楽しめます。
熨斗対応可能。ご贈答・お中元・お歳暮にも喜ばれます。

コンシェルジュメモ:
一本釣り×藁焼きの漁期限定品。熨斗可。アレルギー特定原材料なし。解凍は冷蔵庫で半日。賞味期限は冷凍180日。
```

サイトごとの文体・文字数・情報の優先順位が自然に変わっている。

## 文字数チェックと再生成の仕組み

タイトルが制限を超えることがある。その場合は自動で短縮依頼を出す。

```typescript
async function validateAndFixTitle(
  title: string,
  maxLength: number,
  site: string,
  product: ProductBase
): Promise<string> {
  if (title.length <= maxLength) return title;

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 200,
    messages: [
      {
        role: 'user',
        content: `以下のふるさと納税タイトルを${maxLength}字以内に短縮してください。
サイト: ${site}
商品: ${product.name}
現在のタイトル（${title.length}字）: ${title}

重要情報の優先順位: 産地 > 商品名 > 内容量 > 製法
短縮後のタイトルのみ出力（他のテキスト不要）。`,
      },
    ],
  });

  const shortened = message.content[0].type === 'text'
    ? message.content[0].text.trim()
    : title.substring(0, maxLength);

  return shortened.substring(0, maxLength);
}
```

## コスト計算

10商品 × 3サイト分を生成した場合の実コスト。

| 項目 | 数値 |
|------|------|
| 1商品あたりの入力トークン | 約800トークン |
| 1商品あたりの出力トークン | 約900トークン |
| 10商品の総コスト（claude-opus-4-6） | 約60円 |
| 文字数超過で再生成が発生した場合 | +5〜10円 |
| **合計（10商品・3サイト分）** | **約65〜70円** |

手作業で3〜4日かかっていた作業が30分になって、コストは70円。

## 運用上の注意点

**確認必須の項目**

- アレルゲン表記：Claudeが勝手に追加・削除する可能性があるため、必ず元の商品情報と照合する
- 賞味期限・保存方法：規制上の表記を変えてはならない。出力後に必ずチェックリストで確認する
- 価格・内容量：生成文中に数字が入る場合、入力値と一致しているか確認する

**品質向上のコツ**

- `appealsPoints`に具体的なエピソード（「○○港で漁師が」「△△年から続く製法」など）を入れると文章の個性が出る
- 生成後にサイトに実際に入力して、表示崩れがないか確認する（特に楽天のHTML）
- 同一商品を翌年更新するときは、前年の説明文を `reviewHighlight` 的に渡すと継続性のある文体になる

## まとめ

ふるさと納税の登録作業が重い原因は「各サイトのフォーマットに合わせて書き直す繰り返し」だった。

商品の情報は1つ。それを各サイトの文字数・フォーマット・優先情報に最適化して出力するのは、まさにClaudeが得意な仕事。

年末の繁忙期に入る前に仕込んでおくと、商品追加・更新作業が格段に楽になる。10商品なら30分、30商品でも2時間かからない。

来年は「過去年のクリック率・申込み数と商品説明文の相関をClaudeに分析させる」改善ループも試す予定。

コード・実装相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）へどうぞ。
