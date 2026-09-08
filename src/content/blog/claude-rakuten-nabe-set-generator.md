---
title: "Claude APIで秋の鍋シーズン向け海鮮セットを企画して楽天市場の商品ページを自動生成した話【三陸水産EC】"
description: "「鍋シーズン前に楽天を整備したい」という依頼に、在庫データと楽天の商品ページ規約を渡したら、セット商品の企画からキャッチコピー・商品説明・スペック表まで一気に生成できた話。"
pubDate: 2026-09-08
author: sam
category: "Claude活用"
tags: ["Claude", "EC自動化", "楽天市場", "商品ページ", "鍋シーズン", "海鮮鍋", "秋", "水産業"]
readingTime: 9
---

## 「10月になる前に楽天の商品ページを揃えたい」

9月の頭、業者さんからメッセージが来た。

「そろそろ鍋の季節でしょ。去年は10月になってから慌てて商品ページ作ったら間に合わなくて。今年は早めに楽天の海鮮鍋セットを出したいんだけど、商品ページを書くのが一番しんどい」

三陸の水産物は鍋に映える素材が多い。ホタテ・牡蠣・タラ・タコ・鮭——秋冬は鍋素材としての需要が一気に上がる。楽天市場でも「海鮮鍋セット」の検索数は10月から急増する。

問題は**商品ページの量**だ。セット構成を3〜4パターン作って、それぞれにキャッチコピー・商品説明・スペック・検索キーワードを揃えると、手作業では丸2日かかる。

在庫データと楽天の商品ページ構成をClaude APIに渡して、企画から商品説明まで一気に出してもらった。

## 作ったもの

1. **鍋セットの商品企画**（在庫から最適な組み合わせを提案）
2. **楽天市場の商品ページコンテンツ生成**（商品名・キャッチコピー・商品説明・スペック・検索キーワード）
3. **楽天のSEOを意識したキーワード最適化**

## 実装コード

### 1. 型定義と在庫マスタ

```typescript
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';

const client = new Anthropic();

interface InventoryItem {
  id: string;
  name: string;
  unitPrice: number;
  category: string;
  freezeMethod: '冷蔵' | '冷凍';
  shelfLife: string;       // 例: '到着後2日以内', '冷凍で1ヶ月'
  origin: string;          // 例: '三陸産', '宮城県産', '気仙沼産'
  nabeCompatibility: number; // 鍋との相性スコア（1〜5）
  stock: number;
  unitWeight: string;      // 例: '500g', '10枚'
  marginRate: number;
}

const INVENTORY: InventoryItem[] = [
  {
    id: 'N001',
    name: '三陸産 生ホタテ',
    unitPrice: 3800,
    category: '貝類',
    freezeMethod: '冷蔵',
    shelfLife: '到着後2日以内',
    origin: '三陸産',
    nabeCompatibility: 5,
    stock: 140,
    unitWeight: '10枚（約500g）',
    marginRate: 0.38,
  },
  {
    id: 'N002',
    name: '宮城県産 殻付き牡蠣',
    unitPrice: 4200,
    category: '貝類',
    freezeMethod: '冷蔵',
    shelfLife: '到着後2日以内',
    origin: '宮城県産',
    nabeCompatibility: 5,
    stock: 75,
    unitWeight: '20個（約600g）',
    marginRate: 0.35,
  },
  {
    id: 'N003',
    name: '三陸産 生タコ足',
    unitPrice: 2800,
    category: '軟体類',
    freezeMethod: '冷凍',
    shelfLife: '冷凍で1ヶ月',
    origin: '三陸産',
    nabeCompatibility: 4,
    stock: 200,
    unitWeight: '300g',
    marginRate: 0.42,
  },
  {
    id: 'N004',
    name: '気仙沼産 メカジキの切り身',
    unitPrice: 2200,
    category: '白身魚',
    freezeMethod: '冷凍',
    shelfLife: '冷凍で1ヶ月',
    origin: '気仙沼産',
    nabeCompatibility: 4,
    stock: 180,
    unitWeight: '4切れ（約300g）',
    marginRate: 0.44,
  },
  {
    id: 'N005',
    name: '三陸産 銀鮭の切り身',
    unitPrice: 2600,
    category: '鮭',
    freezeMethod: '冷凍',
    shelfLife: '冷凍で1ヶ月',
    origin: '三陸産',
    nabeCompatibility: 5,
    stock: 160,
    unitWeight: '4切れ（約300g）',
    marginRate: 0.40,
  },
  {
    id: 'N006',
    name: '三陸産 むきエビ（ブラックタイガー）',
    unitPrice: 1800,
    category: 'エビ',
    freezeMethod: '冷凍',
    shelfLife: '冷凍で2ヶ月',
    origin: '三陸産',
    nabeCompatibility: 4,
    stock: 300,
    unitWeight: '200g',
    marginRate: 0.48,
  },
  {
    id: 'N007',
    name: '気仙沼産 真タラの切り身',
    unitPrice: 2400,
    category: '白身魚',
    freezeMethod: '冷凍',
    shelfLife: '冷凍で1ヶ月',
    origin: '気仙沼産',
    nabeCompatibility: 5,
    stock: 120,
    unitWeight: '4切れ（約350g）',
    marginRate: 0.41,
  },
];
```

### 2. 鍋セットの商品企画を生成する

```typescript
interface NabeSetProposal {
  setName: string;
  tagline: string;
  items: Array<{ id: string; quantity: number }>;
  setPrice: number;
  targetCustomer: string;
  nabeConcept: string;        // どんな鍋に合うか
  suggestedSoupBase: string;  // おすすめの出汁・スープ
}

async function proposeNabeSets(
  inventory: InventoryItem[],
  priceRanges: string[],
  count: number
): Promise<NabeSetProposal[]> {
  const availableItems = inventory
    .filter((item) => item.stock > 20 && item.nabeCompatibility >= 4)
    .map(
      (item) =>
        `ID:${item.id} / ${item.name}（${item.origin}） / ¥${item.unitPrice.toLocaleString()} / ` +
        `${item.unitWeight} / 鍋相性:${item.nabeCompatibility}/5 / 在庫:${item.stock} / ${item.freezeMethod}`
    )
    .join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 3000,
    messages: [
      {
        role: 'user',
        content: `あなたは三陸水産ECの商品プロデューサーです。
秋冬の鍋シーズン（10〜12月）に向けた海鮮鍋セット商品を${count}種類提案してください。

【現在の在庫商品（鍋向け厳選）】
${availableItems}

【価格帯の目標】
${priceRanges.join('・')}

【条件】
- 在庫20個以上の商品のみ使用
- セット価格は単品合計の10〜15%引き
- 鍋の種類（寄せ鍋・しゃぶしゃぶ・石狩鍋など）に合わせたセット構成にする
- 三陸・宮城・気仙沼などの産地を強調した名前をつける
- 利益率の高い商品（冷凍品）を優先して組み合わせる

【出力（JSONの配列のみ）】
[
  {
    "setName": "セット名（〜20文字）",
    "tagline": "キャッチコピー（〜35文字）",
    "items": [{ "id": "商品ID", "quantity": 数量 }],
    "setPrice": セット価格（税込・整数）,
    "targetCustomer": "どんな顧客向けか（〜60文字）",
    "nabeConcept": "おすすめの鍋の種類と食べ方（〜80文字）",
    "suggestedSoupBase": "おすすめの出汁・スープベース（〜40文字）"
  }
]`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '[]';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('セット企画のJSON解析失敗');

  return JSON.parse(jsonMatch[0]) as NabeSetProposal[];
}
```

### 3. 楽天市場の商品ページコンテンツを生成する

```typescript
interface RakutenProductPage {
  productName: string;         // 商品名（最大127文字）
  catchCopy: string;           // キャッチコピー（最大85文字）
  productDescription: string;  // 商品説明（HTML可）
  specTable: Array<{           // スペック表
    label: string;
    value: string;
  }>;
  searchKeywords: string;      // 検索キーワード（スペース区切り）
  priceDisplay: string;        // 価格表示文言
  giftWrappingNote: string;    // ギフト対応説明
}

async function generateRakutenPage(
  proposal: NabeSetProposal,
  items: InventoryItem[]
): Promise<RakutenProductPage> {
  const itemDetails = proposal.items
    .map(({ id, quantity }) => {
      const item = items.find((i) => i.id === id);
      return item
        ? `・${item.name}（${item.origin}）${item.unitWeight} × ${quantity}パック`
        : '';
    })
    .filter(Boolean)
    .join('\n');

  // 冷蔵・冷凍が混在するか確認
  const hasFresh = proposal.items.some(({ id }) => {
    const item = items.find((i) => i.id === id);
    return item?.freezeMethod === '冷蔵';
  });
  const hasFrozen = proposal.items.some(({ id }) => {
    const item = items.find((i) => i.id === id);
    return item?.freezeMethod === '冷凍';
  });
  const deliveryNote =
    hasFresh && hasFrozen
      ? '冷蔵便と冷凍便の2便でお届け'
      : hasFresh
      ? '冷蔵便でお届け'
      : '冷凍便でお届け';

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 3000,
    messages: [
      {
        role: 'user',
        content: `楽天市場の海鮮鍋セット商品ページのコンテンツを作成してください。

【セット情報】
セット名: ${proposal.setName}
キャッチコピー案: ${proposal.tagline}
セット価格: ¥${proposal.setPrice.toLocaleString()}（税込）
コンセプト: ${proposal.nabeConcept}
おすすめスープ: ${proposal.suggestedSoupBase}
対象顧客: ${proposal.targetCustomer}

【セット内容物】
${itemDetails}

【配送情報】
${deliveryNote}

【楽天のルール】
- 商品名は127文字以内（スペース区切りでSEOキーワードを含める）
- キャッチコピーは85文字以内
- 「最高品質」「業界No.1」などの最上級表現は禁止
- 送料・保証に関する記載はページ本文に含めない（別途設定）

【出力（JSONのみ）】
{
  "productName": "楽天商品名（〜127文字。産地・素材・鍋の種類など検索キーワードを含む）",
  "catchCopy": "キャッチコピー（〜85文字。購入意欲を高める一文）",
  "productDescription": "商品説明HTML（h3・p・ulタグ使用。産地のストーリー→内容物→食べ方→保存方法の順で500〜700文字相当）",
  "specTable": [
    { "label": "内容", "value": "内容の説明" },
    { "label": "産地", "value": "産地情報" },
    { "label": "配送方法", "value": "配送の説明" },
    { "label": "賞味期限", "value": "賞味期限の説明" },
    { "label": "アレルギー", "value": "アレルギー情報" }
  ],
  "searchKeywords": "楽天の検索キーワード（スペース区切りで10〜15語）",
  "priceDisplay": "価格表示の補足文言（例：送料込み・税込表示）",
  "giftWrappingNote": "ギフト利用者向けの一言（〜60文字）"
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('楽天ページのJSON解析失敗');

  return JSON.parse(jsonMatch[0]) as RakutenProductPage;
}
```

### 4. 実行スクリプト

```typescript
async function main() {
  console.log('🍲 海鮮鍋セット商品ページ自動生成開始...\n');

  // セット商品を3種類企画
  console.log('📦 セット商品を企画中...');
  const proposals = await proposeNabeSets(
    INVENTORY,
    ['4,000〜6,000円', '7,000〜9,000円', '12,000円前後'],
    3
  );

  proposals.forEach((p, i) => {
    console.log(`\n【案${i + 1}】${p.setName}`);
    console.log(`  タグライン: ${p.tagline}`);
    console.log(`  セット価格: ¥${p.setPrice.toLocaleString()}`);
    console.log(`  鍋コンセプト: ${p.nabeConcept}`);
    console.log(`  おすすめスープ: ${p.suggestedSoupBase}`);
  });

  // 各セットの楽天ページを生成
  const results: Array<{
    proposal: NabeSetProposal;
    page: RakutenProductPage;
  }> = [];

  for (const proposal of proposals) {
    console.log(`\n📝 「${proposal.setName}」の楽天ページ生成中...`);
    const page = await generateRakutenPage(proposal, INVENTORY);

    console.log(`商品名: ${page.productName}`);
    console.log(`キャッチコピー: ${page.catchCopy}`);
    console.log(`検索キーワード: ${page.searchKeywords}`);

    results.push({ proposal, page });
  }

  // JSON保存
  fs.writeFileSync(
    'rakuten-nabe-sets-2026.json',
    JSON.stringify(results, null, 2),
    'utf-8'
  );
  console.log('\n✅ rakuten-nabe-sets-2026.json に保存しました');
}

main().catch(console.error);
```

## 実際に生成された内容

### セット企画案（出力例）

```
【案1】三陸の寄せ鍋セット
  タグライン: 三陸の恵みをひとつの鍋に、秋の食卓へ
  セット価格: ¥5,400
  鍋コンセプト: 醤油ベースの寄せ鍋で、ホタテとタラのうまみが際立つ定番構成
  おすすめスープ: 昆布だし×醤油ベースの寄せ鍋スープ

【案2】気仙沼 海鮮しゃぶしゃぶセット
  タグライン: 薄造りで食べる、三陸の海の旨さをそのままに
  セット価格: ¥7,800
  鍋コンセプト: 鮭・タコ・エビをしゃぶしゃぶで。昆布だしで素材の味を引き出す
  おすすめスープ: 昆布だし（ポン酢・ごまだれ添え）

【案3】三陸の石狩鍋プレミアムセット
  タグライン: 鮭と貝の贅沢な旨みが溶け合う、三陸の石狩鍋
  セット価格: ¥12,300
  鍋コンセプト: 銀鮭・牡蠣・ホタテが揃う豪華な石狩鍋セット。味噌仕立てで体が温まる
  おすすめスープ: 白味噌×バター仕立ての石狩鍋スープ
```

### 楽天商品ページ（生成例）

**案1「三陸の寄せ鍋セット」の楽天ページ:**

```
商品名:
三陸産 海鮮寄せ鍋セット 生ホタテ タラ タコ 鍋 海鮮 詰め合わせ
宮城 三陸 気仙沼 産地直送 冷凍 送料込み

キャッチコピー:
水揚げ翌日に急速冷凍。三陸の海の幸をそのままの旨みで食卓へお届けします。

検索キーワード:
海鮮鍋セット 三陸 寄せ鍋 ホタテ タラ タコ 産地直送 宮城
気仙沼 冷凍 送料込み ギフト 詰め合わせ 鍋の具 海鮮
```

**商品説明文（生成例）:**

```html
<h3>三陸の海をそのまま鍋に</h3>
<p>宮城県・三陸沖で獲れた海の幸を、水揚げ翌日に急速冷凍してお届けします。
生産者から直接仕入れているから、スーパーでは出会えない鮮度のまま食卓へ。
寒くなる季節、三陸の旨みが溶け出した一鍋で体の芯から温まってください。</p>

<h3>セット内容</h3>
<ul>
  <li>三陸産 生ホタテ 10枚（約500g）× 1パック</li>
  <li>気仙沼産 真タラの切り身 4切れ（約350g）× 1パック</li>
  <li>三陸産 生タコ足 300g × 1パック</li>
</ul>

<h3>おすすめの食べ方</h3>
<p>昆布だしに醤油をひと回し加えた「寄せ鍋」がおすすめです。ホタテは火を
通しすぎず、身がふっくらしたタイミングで引き上げると旨みが閉じ込められます。
タラはほぐれやすいので、汁の温度が下がったタイミングで入れると形が崩れません。</p>

<h3>保存・お届けについて</h3>
<p>全品冷凍便でお届けします。ご到着後はそのまま冷凍保存で1ヶ月以内にお召し上がりください。
解凍は冷蔵庫で一晩かけてゆっくりと。急ぐときは流水解凍でも大丈夫です。</p>
```

## コストと効果

**APIコスト（セット3案＋ページ3枚分）**

| 処理 | トークン数（概算） | コスト |
|------|------------------|--------|
| セット企画3案 | 入力1,200＋出力2,500 | 約1.8円 |
| 楽天ページ×3商品 | 入力3,000＋出力5,000 | 約3.9円 |
| 合計 | | **約5.7円** |

**工数削減**

| 作業 | Before（手動） | After（Claude API） |
|------|--------------|-------------------|
| セット構成案出し（3案） | 2〜3時間 | 0分（自動） |
| 楽天商品名・キャッチコピー（3商品） | 約2時間 | 10分（確認のみ） |
| 商品説明文（3商品×HTML） | 約4時間 | 10分（確認のみ） |
| 検索キーワード設定（3商品） | 約1時間 | 0分（自動） |
| 合計 | **約9〜10時間** | **約20分** |

**業者さんの一言：**
「楽天の商品ページって商品名にキーワードを詰め込まないといけないのが地味にしんどかった。Claudeに"楽天のSEOを意識して"って書くだけでちゃんと商品名にキーワードを入れてくれたのが助かった」

## ポイントと注意点

**うまくいった点**
- 楽天の文字数制限や禁止表現のルールをプロンプトに入れることで、そのまま使えるレベルの文章が出てくる
- 冷蔵・冷凍が混在するセットの場合、配送方法の自動判定ロジックを入れたことで説明文のズレが起きない
- 「おすすめの出汁・スープ」をセット企画の段階で出力させると、商品説明文に食べ方のストーリーが自然に入る

**注意点**
- 楽天の禁止表現は定期的に更新されるため、プロンプトの禁止リストを年に1〜2回見直すこと
- 生成されたHTMLは楽天のRMSエディタで実際に表示確認してから登録する
- 冷蔵品（生ホタテ・牡蠣）は到着後の賞味期限が短いため、商品説明に保存方法を必ず明記する

## まとめ

「楽天のページを揃えるのが億劫でシーズン前の対応がいつも遅れる」という問題を、Claude APIで解消できた。

セット企画→商品名→説明文→検索キーワードを一気通貫で出してくれるので、業者さんが確認・微修正するだけで楽天への登録ができる状態になる。

今回の実装をテンプレートにして、来年は「鍋シーズン用の商品情報を渡すだけ」で動く仕組みにしておく予定だ。

コード・カスタマイズ相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
