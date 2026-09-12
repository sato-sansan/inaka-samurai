---
title: "Claude APIでハロウィンの海鮮ギフトキャンペーンを自動生成した話【三陸水産EC】"
description: "「ハロウィンって海鮮と関係ない」から始まった企画。10月31日に向けてギフトセット名・商品説明文・メール文面・X投稿をClaudeに任せたら、三陸らしさを残しつつ非日常感のあるコンテンツが1時間で揃った話。"
pubDate: 2026-09-12
author: sam
category: "Claude活用"
tags: ["Claude", "EC自動化", "メールマーケティング", "ハロウィン", "季節キャンペーン", "水産業", "SNS", "Shopify"]
readingTime: 9
---

## 「ハロウィンって、魚屋には関係ないよね？」

9月に入ったころ、業者さんから相談が来た。

「お月見や敬老の日はやったんですよ。次何しようかなって考えてたら10月末にハロウィンがあるじゃないですか。でも海鮮屋がハロウィンやるってどう考えてもピンとこなくて」

確かに、ハロウィンといえばカボチャ・お菓子・仮装。海鮮とは縁遠い印象がある。

でも、[お月見キャンペーン](/blog/claude-moon-viewing-seafood-campaign)のときも最初は「お月見と海鮮？」だった。やってみたら「三陸の月見肴」という世界観が成立して、告知から3日で完売したセットが出た。

**「ハロウィン✕海鮮」もClaudeが角度を見つけてくれるはず**、という前提でやってみた。

## 作ったもの

4フェーズをClaude APIに任せた。

1. **ハロウィン向けセット商品の企画**（「怖さ」「神秘」「仮装」などのテーマで在庫から組み合わせ）
2. **商品名・説明文の生成**（ハロウィン感がありつつ産地の信頼感を維持）
3. **キャンペーンメールの生成**（告知メール・締め切り前アラート）
4. **X（Twitter）投稿文の生成**（視覚的なフック＋ハッシュタグ付き）

## 実装コード

### 1. 型定義と在庫データ

```typescript
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';

const client = new Anthropic();

interface InventoryItem {
  id: string;
  name: string;
  unitPrice: number;
  category: string;
  tags: string[];
  stock: number;
  color: string;    // 見た目の色（演出の参考に）
  texture: string;  // 食感・見た目の特徴
}

const INVENTORY: InventoryItem[] = [
  {
    id: 'F001',
    name: '三陸産 活タコ（1kg）',
    unitPrice: 3600,
    category: '鮮魚',
    tags: ['グロテスク感', 'インパクト', '見た目が強い'],
    stock: 40,
    color: '赤紫',
    texture: '吸盤付き・ぬめり',
  },
  {
    id: 'F002',
    name: '気仙沼産 真イカ一夜干し（3枚）',
    unitPrice: 1800,
    category: '干物',
    tags: ['白い', '乾燥', 'おつまみ向き'],
    stock: 200,
    color: '白〜茶',
    texture: 'かさかさ・透明感',
  },
  {
    id: 'F003',
    name: '宮城県産 殻付き牡蠣（20個）',
    unitPrice: 4200,
    category: '貝類',
    tags: ['ゴツゴツ', '神秘的', '高級感'],
    stock: 80,
    color: 'グレー',
    texture: 'ごつごつした殻・光沢',
  },
  {
    id: 'F004',
    name: '三陸産 いくら醤油漬け（100g）',
    unitPrice: 3200,
    category: '珍味',
    tags: ['オレンジ色', '宝石のよう', 'ハレの日向き'],
    stock: 60,
    color: 'オレンジ〜赤',
    texture: 'つぶつぶ・はじける',
  },
  {
    id: 'F005',
    name: '気仙沼産 フカヒレ（姿煮用・50g）',
    unitPrice: 5800,
    category: '高級食材',
    tags: ['高級', 'レア感', 'サメ由来'],
    stock: 25,
    color: '黄金色',
    texture: 'とろっと繊維状',
  },
  {
    id: 'F006',
    name: '三陸産 塩ウニ（100g）',
    unitPrice: 4800,
    category: '珍味',
    tags: ['濃厚', '黄色', 'トゲのイメージ'],
    stock: 35,
    color: '黄〜オレンジ',
    texture: 'とろとろ・濃厚',
  },
  {
    id: 'F007',
    name: '宮城県産 ホヤ珍味セット（3種）',
    unitPrice: 2400,
    category: '珍味',
    tags: ['独特の見た目', 'コアな人気', 'チャレンジ向き'],
    stock: 50,
    color: '赤〜オレンジ',
    texture: 'ぷにぷに・独特の風味',
  },
];
```

### 2. ハロウィン向けセット商品を企画させる

ハロウィンらしい「テーマ」を軸に在庫の組み合わせを考えさせる。

```typescript
interface HalloweenSetProposal {
  setName: string;
  tagline: string;
  halloweenConcept: string;  // なぜハロウィンと結びつくか
  items: Array<{ id: string; quantity: number }>;
  setPrice: number;
  targetCustomer: string;
}

async function proposeHalloweenSets(
  inventory: InventoryItem[],
  proposalCount: number
): Promise<HalloweenSetProposal[]> {
  const itemList = inventory
    .filter((item) => item.stock > 10)
    .map(
      (item) =>
        `ID:${item.id} / ${item.name} / ¥${item.unitPrice.toLocaleString()} / ` +
        `色:${item.color} / 特徴:${item.texture} / タグ:${item.tags.join('・')} / 在庫:${item.stock}`
    )
    .join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 3000,
    messages: [
      {
        role: 'user',
        content: `あなたは三陸水産ECのプロデューサーです。
ハロウィン（10月31日）に向けた海鮮ギフトセットを${proposalCount}種類提案してください。

【現在の在庫商品一覧】（色や見た目・食感の情報付き）
${itemList}

【条件】
- ハロウィンの「怖さ」「神秘」「非日常」「変身」などのテーマと商品の見た目・特徴を結びつけて命名する
- 無理に「怖い」にする必要はない。「神秘的」「深海の宝」「海の魔法」など肯定的な演出も可
- セット名は日本語で15文字以内。英語混じりも可（例：Dark Sea、Witch's Catch など）
- セット価格は単品合計より10〜15%お得に設定
- 三陸・気仙沼・宮城など産地の信頼感は維持すること
- 在庫が豊富で利益率の高い商品を優先して組み合わせる

【出力（JSONの配列のみ）】
[
  {
    "setName": "セット名",
    "tagline": "キャッチコピー（〜30文字）",
    "halloweenConcept": "ハロウィンとの結びつきの説明（〜60文字）",
    "items": [{ "id": "商品ID", "quantity": 数量 }],
    "setPrice": セット価格（税込）,
    "targetCustomer": "対象顧客（〜50文字）"
  }
]`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '[]';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('ハロウィンセット企画のJSON解析失敗');

  return JSON.parse(jsonMatch[0]) as HalloweenSetProposal[];
}
```

### 3. 商品説明文・SNS向けコピーを生成する

```typescript
interface HalloweenProductContent {
  shopifyTitle: string;
  bodyHtml: string;
  metaDescription: string;
  shopifyTags: string;
  xPost: string;    // X（Twitter）投稿文（140文字以内）
  xHashtags: string;
}

async function generateHalloweenContent(
  proposal: HalloweenSetProposal,
  items: InventoryItem[]
): Promise<HalloweenProductContent> {
  const itemDetails = proposal.items
    .map(({ id, quantity }) => {
      const item = items.find((i) => i.id === id);
      return item
        ? `・${item.name}（${quantity}点）— ${item.color}・${item.texture}`
        : '';
    })
    .filter(Boolean)
    .join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2500,
    messages: [
      {
        role: 'user',
        content: `三陸水産ECのハロウィンキャンペーン用コンテンツを作成してください。

【セット情報】
セット名: ${proposal.setName}
タグライン: ${proposal.tagline}
価格: ¥${proposal.setPrice.toLocaleString()}（税込）
ハロウィンコンセプト: ${proposal.halloweenConcept}
対象顧客: ${proposal.targetCustomer}

【内容物】（色・見た目の情報付き）
${itemDetails}

【生成ルール】
- Shopify商品説明はHTMLで400〜600文字相当。ハロウィンの演出と産地のストーリーを両立させる
- SNS（X）投稿は130文字以内。ハロウィン感と「三陸産」の安心感を入れる
- ハッシュタグは日本語4〜5個（#ハロウィン #三陸 など）

【出力（JSONのみ）】
{
  "shopifyTitle": "Shopify商品タイトル（〜60文字）",
  "bodyHtml": "商品説明HTML（h2/p/ulタグ使用）",
  "metaDescription": "SEOメタディスクリプション（〜120文字）",
  "shopifyTags": "Shopifyタグ（カンマ区切り）",
  "xPost": "X投稿本文（130文字以内、URLなし）",
  "xHashtags": "ハッシュタグ（スペース区切り）"
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('ハロウィンコンテンツのJSON解析失敗');

  return JSON.parse(jsonMatch[0]) as HalloweenProductContent;
}
```

### 4. ハロウィンキャンペーンメールを生成する

```typescript
interface HalloweenEmails {
  announcement: { subject: string; body: string };
  lastCall: { subject: string; body: string };
}

async function generateHalloweenEmails(
  proposals: HalloweenSetProposal[],
  eventDate: string,
  closingDate: string
): Promise<HalloweenEmails> {
  const setsSummary = proposals
    .map(
      (p) =>
        `・${p.setName}（¥${p.setPrice.toLocaleString()}）：${p.tagline}`
    )
    .join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2500,
    messages: [
      {
        role: 'user',
        content: `三陸水産ECのハロウィンキャンペーンメールを2種類作成してください。

【キャンペーン概要】
- ハロウィン：${eventDate}
- 注文締め切り（当日着保証）：${closingDate}
- セット商品：
${setsSummary}

【2種類のメール】
1. 告知メール（3週間前）：ハロウィン×海鮮という意外な組み合わせへの興味を引く
2. 締め切り前アラート（5日前）：在庫の残り少を示唆して購買を促す

【共通ルール】
- 件名は30文字以内
- 本文は300〜400文字
- 「ハロウィン」という言葉は件名か本文のどちらかのみに入れる（くどくならないよう）
- 産地（三陸・気仙沼・宮城）の言葉を必ず入れる
- URLプレースホルダーは {{shop_url}} を使用
- 怖い雰囲気を出しすぎず、食欲をそそる表現を心がける

【出力（JSONのみ）】
{
  "announcement": { "subject": "件名", "body": "本文" },
  "lastCall": { "subject": "件名", "body": "本文" }
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('ハロウィンメールのJSON解析失敗');

  return JSON.parse(jsonMatch[0]) as HalloweenEmails;
}
```

### 5. 実行スクリプト

```typescript
async function main() {
  console.log('🎃 ハロウィン海鮮キャンペーン自動生成開始...\n');

  // セット商品を3案企画
  console.log('📦 ハロウィン向けセットを企画中...');
  const proposals = await proposeHalloweenSets(INVENTORY, 3);

  proposals.forEach((p, i) => {
    console.log(`\n【案${i + 1}】${p.setName}`);
    console.log(`  タグライン: ${p.tagline}`);
    console.log(`  コンセプト: ${p.halloweenConcept}`);
    console.log(`  セット価格: ¥${p.setPrice.toLocaleString()}`);
  });

  // メインセットのShopify用コンテンツとX投稿を生成
  console.log('\n📝 コンテンツを生成中...');
  const content = await generateHalloweenContent(proposals[0], INVENTORY);
  console.log(`\nShopifyタイトル: ${content.shopifyTitle}`);
  console.log(`X投稿: ${content.xPost}`);
  console.log(`ハッシュタグ: ${content.xHashtags}`);

  // キャンペーンメール生成
  console.log('\n✉️ キャンペーンメールを生成中...');
  const emails = await generateHalloweenEmails(
    proposals,
    '2026年10月31日（土）',
    '2026年10月29日（木）正午'
  );

  console.log('\n--- 告知メール ---');
  console.log(`件名: ${emails.announcement.subject}`);
  console.log(`本文:\n${emails.announcement.body}`);

  console.log('\n--- 締め切り前アラート ---');
  console.log(`件名: ${emails.lastCall.subject}`);
  console.log(`本文:\n${emails.lastCall.body}`);

  // JSON保存
  const output = { proposals, content, emails };
  fs.writeFileSync(
    'halloween-campaign-2026.json',
    JSON.stringify(output, null, 2),
    'utf-8'
  );
  console.log('\n✅ halloween-campaign-2026.json に保存完了');
}

main().catch(console.error);
```

## 実際に生成された内容

### セット商品の企画案（出力例）

```
【案1】深海の宝箱セット
  タグライン: 三陸の深みから届く、神秘の海の幸
  コンセプト: 深海・暗闇・神秘というハロウィンのダークな世界観を、
             深い海から揚がる宝石のような海産物で表現

【案2】魔女のおつまみセット
  タグライン: 気仙沼の魔法にかけられた、禁断の珍味たち
  コンセプト: 見た目が個性的なタコ・ホヤ・フカヒレを「魔女の材料」に見立てた
             チャレンジングなセット。コアなファン向け

【案3】三陸 Monster Night Set
  タグライン: The night the ocean shows its true face.
  コンセプト: 英語名でハロウィンらしさを演出しつつ、
             産地・鮮度の安心感は日本語でしっかり訴求
```

### 商品説明文（生成例）

```html
<h2>深海から届く、ハロウィンの夜の贈り物</h2>
<p>三陸の海は、光の届かない深みに豊かな生態系を持っています。
「深海の宝箱セット」は、その底から丁寧に引き揚げた海の幸を、
特別な夜のために詰め合わせた秋限定の一品です。</p>

<h2>セット内容</h2>
<ul>
  <li>三陸産 活タコ（1kg）—吸盤まで鮮度抜群の迫力ある一匹</li>
  <li>宮城県産 殻付き牡蠣（20個）—ごつごつした殻に守られた濃厚な旨み</li>
  <li>三陸産 いくら醤油漬け（100g）—オレンジ色に輝く海の宝石</li>
</ul>

<h2>ハロウィンの夜の食卓に</h2>
<p>タコは丸ごとボイルしてテーブルに登場させても。
牡蠣は焚き火やグリルで豪快に焼くと磯の香りが立ち上ります。
いくらはご飯に乗せた「海の宝石丼」として締めくくりに。
仮装した仲間と囲む食卓に、三陸の深海をそのまま届けます。</p>

<h2>お届けについて</h2>
<p>活タコ・牡蠣は冷蔵便（到着後2日以内にお召し上がりください）。
いくらは冷凍便で同梱。10月29日（木）正午が当日着保証の締め切りです。</p>
```

### X（Twitter）投稿文（生成例）

```
三陸の海の底、光の届かない深みから届けます——

今年のハロウィンは「深海の宝箱セット」を食卓に。
吸盤付きのタコ、ゴツゴツ牡蠣、オレンジに輝くいくら。
ぜんぶ、気仙沼・三陸産の本物の旬です。

#ハロウィン #三陸海鮮 #気仙沼 #ハロウィンパーティー #旬のうまいもの
```

### キャンペーンメール（生成例）

**告知メール（3週間前）:**

```
件名: 三陸の「深海」、今年のハロウィンに解禁

10月になると、海の表情が変わります。
三陸の水温が下がり、深みに棲む生き物たちが最も旨くなる季節です。

今年のハロウィンに向けて、その深海から特別なセットをご用意しました。
赤紫に輝く活タコ、光沢のある殻付き牡蠣、宝石のようないくら——
三陸が誇る「見た目もインパクトのある」海の幸を、ギフトとして届けます。

家族で囲む食卓にも、パーティーの主役にも。
10月29日正午が当日着保証の締め切りです。

▶ セットを確認する: {{shop_url}}
```

**締め切り前アラート（5日前）:**

```
件名: 【残5日】三陸の深海便、締め切りが迫っています

10月31日まであと5日。
ハロウィン当日の食卓に間に合う最後の便の締め切りは、
10月29日（木）正午です。

特に「深海の宝箱セット」と「魔女のおつまみセット」は残りわずかの状況です。
気仙沼・三陸から直送で届く、この時期ならではの旬の海の幸をぜひ。

▶ まだ間に合います: {{shop_url}}
```

## コストと効果

**APIコスト（一連の生成処理）**

| 処理 | トークン数（概算） | コスト |
|------|------------------|--------|
| セット企画3案 | 入力1,600＋出力2,500 | 約1.7円 |
| Shopify説明文＋X投稿 | 入力1,200＋出力1,500 | 約1.2円 |
| キャンペーンメール2種 | 入力1,000＋出力1,500 | 約1.1円 |
| 合計 | | **約4.0円** |

**工数削減**

| 作業 | Before（手動） | After（Claude API） |
|------|--------------|-------------------|
| ハロウィン向けセット案出し | 2〜3時間 | 0分（自動） |
| Shopify商品説明文作成 | 約1時間 | 5分（確認のみ） |
| X投稿文作成 | 約30分 | 即時 |
| メール文面2種作成 | 約1.5時間 | 5分（確認のみ） |
| 合計 | 約5時間 | **約10分** |

**業者さんの一言：**
「"深海の宝箱"って名前、自分じゃ絶対考えないんだけど言われてみれば確かにそれっぽい。タコをメインにしたセットは避けてたんだけど、こういうコンセプトなら出しやすいかも、ってなった」

## ポイントと注意点

**うまくいった点**
- 商品の「色」「食感・見た目」の情報を渡したことで、ハロウィンとの結びつきを自分で発見してくれた
- セット名に英語混じり（Monster Night Set など）を提案してくれたのは指示していない。季節のブランド感が出る
- 「ハロウィンという言葉を多用しすぎない」という制約が、くどくない自然な文面につながった

**注意点**
- 「怖い」演出を求めすぎると食欲を削ぐ文面になりやすい。`肯定的な演出も可` と明記するのが重要
- タコ・ホヤなど見た目が強い食材をギフトにする場合は、受け取り手の好みを想定した顧客向けにセグメントすること
- X投稿はそのままでは文字数がオーバーする場合がある（生成後に130文字以内か確認）
- Halloween関連のキャンペーンは欧米向け表現になりすぎないよう確認する

## まとめ

「ハロウィンと海鮮は関係ない」という出発点から始まって、「深海の宝箱」「魔女のおつまみ」というセット名が1時間以内に出てきた。

ポイントは**在庫商品の「見た目・色・食感」という視覚的な情報をClaudeに渡したこと**だった。在庫名と価格だけ渡していたお月見のときより、ハロウィンのイメージとの紐づけが自然になった。

お月見・敬老の日・お彼岸に続いてハロウィンも「意外な×海鮮」の組み合わせで成立することが分かった。**行事と食のかけ合わせは毎年ある**。今年のテンプレートを保存しておけば、来年はイベント名と締め切り日を変えるだけで動く。

年間の季節イベントをひと通り自動化してしまえば、判断が必要な部分（価格・送り先セグメント・在庫量の最終確認）だけに集中できる。

コード・カスタマイズ相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
