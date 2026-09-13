---
title: "Claude APIでクリスマス限定シーフードギフトを1時間で企画した話【三陸水産EC】"
description: "「クリスマスといえば洋風」という常識を崩すため、在庫データを渡してClaudeにギフトセット名・商品説明・メール文面・SNS投稿を一括生成させた。産地の信頼感を残しながらクリスマスらしい世界観を作る、3つのプロンプト設計のコツ。"
pubDate: 2026-09-13
author: sam
category: "Claude活用"
tags: ["Claude", "EC自動化", "メールマーケティング", "クリスマス", "季節キャンペーン", "水産業", "SNS", "Shopify"]
readingTime: 10
---

## 「クリスマスって、海鮮屋には関係ないよね？」

9月の半ばに、業者さんから電話がきた。

「お月見もハロウィンもやってみたら意外と反応あったじゃないですか。で、次はクリスマスかなと思ってるんですよ。でもクリスマスってケンタッキーとかケーキとか、そっちのイメージが強くて……海鮮を贈るって発想、お客さんに伝わるか不安で」

気持ちはわかる。クリスマスのギフトといえば赤と緑、ワインとチーズ、ケーキとチキン。三陸産の魚介はどこにも出てこない。

でも、[ハロウィンキャンペーン](/blog/claude-halloween-seafood-campaign)のときも同じ「接点がない」から始まった。やってみたら「深海の宝箱」「魔女のおつまみ」という名前が生まれて、10月末に向けて予約が入り始めている。

**クリスマス✕海鮮の角度をClaudeに見つけてもらえばいい**、という前提でやってみた。

## 作ったもの

4フェーズをClaude APIに任せた。

1. **クリスマス向けギフトセットの企画**（「豪華」「冬の食卓」「贈答」などのテーマで在庫から組み合わせ）
2. **セット名・商品説明文の生成**（クリスマス感がありつつ産地の信頼感を維持）
3. **キャンペーンメールの生成**（告知メール・締め切り前アラート）
4. **X（Twitter）・Instagram投稿文の生成**

## 実装コード

### 1. 型定義と冬の在庫データ

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
  season: string;     // 旬の時期
  giftability: 'A' | 'B' | 'C';  // ギフト向き度
}

const WINTER_INVENTORY: InventoryItem[] = [
  {
    id: 'W001',
    name: '三陸産 牡蠣むき身（500g）',
    unitPrice: 2800,
    category: '貝類',
    tags: ['冬が旬', '濃厚', 'クリーミー', 'フランス料理にも使われる'],
    stock: 150,
    season: '10〜3月',
    giftability: 'A',
  },
  {
    id: 'W002',
    name: '気仙沼産 生タラ（1尾・約1.5kg）',
    unitPrice: 3200,
    category: '鮮魚',
    tags: ['冬が旬', '鍋に最適', '白身', '淡白でクセなし'],
    stock: 80,
    season: '12〜2月',
    giftability: 'B',
  },
  {
    id: 'W003',
    name: '三陸産 真ダラの白子（200g）',
    unitPrice: 4500,
    category: '珍味',
    tags: ['冬限定', '希少', 'とろける食感', 'クリーミー'],
    stock: 40,
    season: '1〜2月',
    giftability: 'A',
  },
  {
    id: 'W004',
    name: '宮城県産 金華サバ（2尾）',
    unitPrice: 3600,
    category: '鮮魚',
    tags: ['ブランド魚', '脂がのる', '高級感', '贈答向き'],
    stock: 60,
    season: '秋〜冬',
    giftability: 'A',
  },
  {
    id: 'W005',
    name: '三陸産 活ホタテ（10枚）',
    unitPrice: 4200,
    category: '貝類',
    tags: ['甘い', '大ぶり', 'BBQ・グリル向き', 'インパクトある'],
    stock: 100,
    season: '通年（冬が特に美味）',
    giftability: 'A',
  },
  {
    id: 'W006',
    name: '三陸産 いくら醤油漬け（200g）',
    unitPrice: 5600,
    category: '珍味',
    tags: ['オレンジ色', '宝石のよう', 'ハレの日向き', '見た目豪華'],
    stock: 70,
    season: '秋〜冬',
    giftability: 'A',
  },
  {
    id: 'W007',
    name: '気仙沼産 フカヒレ姿煮セット（2枚）',
    unitPrice: 8800,
    category: '高級食材',
    tags: ['最高級', 'レア', '中華料理の定番', 'サメ由来'],
    stock: 20,
    season: '通年',
    giftability: 'A',
  },
  {
    id: 'W008',
    name: '三陸産 さけ切り身（冷凍・8切）',
    unitPrice: 2400,
    category: '鮮魚',
    tags: ['定番', '使いやすい', 'ソテー・ムニエル向き', '赤色がきれい'],
    stock: 200,
    season: '秋〜冬',
    giftability: 'B',
  },
];
```

### 2. クリスマス向けギフトセットを企画させる

```typescript
interface ChristmasSetProposal {
  setName: string;
  tagline: string;
  christmasConcept: string;  // クリスマスとの結びつき
  items: Array<{ id: string; quantity: number }>;
  setPrice: number;
  targetCustomer: string;
  priceTier: 'プレミアム' | 'スタンダード' | 'カジュアル';
}

async function proposeChristmasSets(
  inventory: InventoryItem[],
  proposalCount: number
): Promise<ChristmasSetProposal[]> {
  const itemList = inventory
    .filter((item) => item.stock > 15)
    .map(
      (item) =>
        `ID:${item.id} / ${item.name} / ¥${item.unitPrice.toLocaleString()} / ` +
        `旬:${item.season} / ギフト向き:${item.giftability} / タグ:${item.tags.join('・')} / 在庫:${item.stock}`
    )
    .join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 3500,
    messages: [
      {
        role: 'user',
        content: `あなたは三陸水産ECのプロデューサーです。
クリスマス（12月25日）に向けた海鮮ギフトセットを${proposalCount}種類提案してください。

【現在の冬の在庫商品一覧】
${itemList}

【条件】
- クリスマスの「豪華さ」「冬の食卓」「大切な人への贈り物」というテーマと商品の特徴を結びつける
- 「クリスマスといえば洋風」という先入観を崩す角度を探す
  （例：牡蠣はフランスのクリスマスの定番 / フカヒレは「海のごちそう」として中華圏でもお祝い料理）
- セット名は日本語または英日混じりで15文字以内
- プレミアム（1万円超）・スタンダード（5千〜1万円）・カジュアル（5千円以下）の価格帯を網羅する
- セット価格は単品合計より10〜15%お得に設定
- 三陸・気仙沼・宮城など産地の信頼感は維持すること

【出力（JSONの配列のみ）】
[
  {
    "setName": "セット名",
    "tagline": "キャッチコピー（〜35文字）",
    "christmasConcept": "クリスマスとの結びつきの説明（〜80文字）",
    "items": [{ "id": "商品ID", "quantity": 数量 }],
    "setPrice": セット価格（税込）,
    "targetCustomer": "対象顧客（〜60文字）",
    "priceTier": "プレミアム" or "スタンダード" or "カジュアル"
  }
]`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '[]';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('クリスマスセット企画のJSON解析失敗');

  return JSON.parse(jsonMatch[0]) as ChristmasSetProposal[];
}
```

### 3. 商品説明・SNS投稿を生成する

```typescript
interface ChristmasProductContent {
  shopifyTitle: string;
  bodyHtml: string;
  metaDescription: string;
  shopifyTags: string;
  xPost: string;
  xHashtags: string;
  instagramCaption: string;
  instagramHashtags: string;
}

async function generateChristmasContent(
  proposal: ChristmasSetProposal,
  items: InventoryItem[]
): Promise<ChristmasProductContent> {
  const itemDetails = proposal.items
    .map(({ id, quantity }) => {
      const item = items.find((i) => i.id === id);
      return item
        ? `・${item.name}（${quantity}点）— ${item.tags.slice(0, 2).join('・')}`
        : '';
    })
    .filter(Boolean)
    .join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 3000,
    messages: [
      {
        role: 'user',
        content: `三陸水産ECのクリスマスキャンペーン用コンテンツを作成してください。

【セット情報】
セット名: ${proposal.setName}
タグライン: ${proposal.tagline}
価格帯: ${proposal.priceTier}（¥${proposal.setPrice.toLocaleString()}・税込）
コンセプト: ${proposal.christmasConcept}
対象顧客: ${proposal.targetCustomer}

【内容物】
${itemDetails}

【生成ルール】
- Shopify商品説明はHTMLで500〜700文字相当
  - 「クリスマスらしい豪華さ」と「三陸産の本物感」を両立させる
  - ギフト用途（自宅用・贈答用・パーティー用）を具体的に描写する
- X投稿は120文字以内、ハッシュタグは別フィールドで4〜5個
- Instagram用キャプションは200文字以内（日本語のみ）
  - 食卓の情景を描写し、保存・シェアしたくなる内容に
- ハッシュタグ重複不可（X用とInstagram用を分けること）

【出力（JSONのみ）】
{
  "shopifyTitle": "Shopify商品タイトル（〜60文字）",
  "bodyHtml": "商品説明HTML（h2/p/ulタグ使用）",
  "metaDescription": "SEOメタディスクリプション（〜120文字）",
  "shopifyTags": "Shopifyタグ（カンマ区切り）",
  "xPost": "X投稿本文（120文字以内、URLなし）",
  "xHashtags": "X用ハッシュタグ（スペース区切り）",
  "instagramCaption": "Instagramキャプション（200文字以内）",
  "instagramHashtags": "Instagram用ハッシュタグ（スペース区切り）"
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('クリスマスコンテンツのJSON解析失敗');

  return JSON.parse(jsonMatch[0]) as ChristmasProductContent;
}
```

### 4. クリスマスキャンペーンメールを生成する

```typescript
interface ChristmasEmails {
  earlybird: { subject: string; body: string };   // 早期予約メール
  announcement: { subject: string; body: string }; // 通常告知
  lastCall: { subject: string; body: string };      // 締め切り前
}

async function generateChristmasEmails(
  proposals: ChristmasSetProposal[],
  closingDate: string
): Promise<ChristmasEmails> {
  const setsSummary = proposals
    .map(
      (p) =>
        `・${p.setName}（¥${p.setPrice.toLocaleString()}・${p.priceTier}）：${p.tagline}`
    )
    .join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 3000,
    messages: [
      {
        role: 'user',
        content: `三陸水産ECのクリスマスキャンペーンメールを3種類作成してください。

【キャンペーン概要】
- イベント：クリスマス（12月25日）
- 鮮度保証・当日着の注文締め切り：${closingDate}
- セット商品：
${setsSummary}

【3種類のメール】
1. 早期予約メール（10月下旬送信）：早期予約特典（送料無料）を告知。12月に向けて今から動く理由を作る
2. 通常告知メール（11月下旬送信）：クリスマスの食卓のイメージを描写して購買欲を喚起
3. 締め切り前アラート（12月22日送信）：残り3日の緊迫感と在庫状況を示唆

【共通ルール】
- 件名は30文字以内
- 本文は300〜400文字
- 「クリスマス」という言葉は件名・本文それぞれ1回まで（くどくならないよう）
- 産地（三陸・気仙沼・宮城）の言葉を必ず入れる
- URLプレースホルダーは {{shop_url}} を使用
- 「早期予約メール」のみ {{early_discount_code}} を割引コードとして含める

【出力（JSONのみ）】
{
  "earlybird":    { "subject": "件名", "body": "本文" },
  "announcement": { "subject": "件名", "body": "本文" },
  "lastCall":     { "subject": "件名", "body": "本文" }
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('クリスマスメールのJSON解析失敗');

  return JSON.parse(jsonMatch[0]) as ChristmasEmails;
}
```

### 5. 実行スクリプト

```typescript
async function main() {
  console.log('🎄 クリスマス海鮮キャンペーン自動生成開始...\n');

  console.log('📦 クリスマス向けセットを企画中...');
  const proposals = await proposeChristmasSets(WINTER_INVENTORY, 3);

  proposals.forEach((p, i) => {
    console.log(`\n【案${i + 1}】${p.setName}（${p.priceTier}）`);
    console.log(`  タグライン: ${p.tagline}`);
    console.log(`  コンセプト: ${p.christmasConcept}`);
    console.log(`  セット価格: ¥${p.setPrice.toLocaleString()}`);
    console.log(`  対象: ${p.targetCustomer}`);
  });

  console.log('\n📝 コンテンツを生成中...');
  const content = await generateChristmasContent(proposals[0], WINTER_INVENTORY);
  console.log(`\nShopifyタイトル: ${content.shopifyTitle}`);
  console.log(`X投稿: ${content.xPost}`);
  console.log(`Instagramキャプション: ${content.instagramCaption}`);

  console.log('\n✉️ キャンペーンメールを生成中...');
  const emails = await generateChristmasEmails(
    proposals,
    '2026年12月22日（火）正午'
  );

  console.log('\n--- 早期予約メール ---');
  console.log(`件名: ${emails.earlybird.subject}`);
  console.log(`本文:\n${emails.earlybird.body}`);

  console.log('\n--- 通常告知メール ---');
  console.log(`件名: ${emails.announcement.subject}`);
  console.log(`本文:\n${emails.announcement.body}`);

  console.log('\n--- 締め切り前アラート ---');
  console.log(`件名: ${emails.lastCall.subject}`);
  console.log(`本文:\n${emails.lastCall.body}`);

  const output = { proposals, content, emails };
  fs.writeFileSync(
    'christmas-campaign-2026.json',
    JSON.stringify(output, null, 2),
    'utf-8'
  );
  console.log('\n✅ christmas-campaign-2026.json に保存完了');
}

main().catch(console.error);
```

## 実際に生成された内容

### ギフトセットの企画案（出力例）

```
【案1】三陸 Noël Blanc（プレミアム）
  タグライン: 白い冬に輝く、最上の海の恵みを贈る
  コンセプト: 牡蠣はフランスのクリスマスの定番料理。
             フカヒレは「海の宝」として東西問わず
             お祝いの食卓に並ぶ。三陸の白い冬と重なる

【案2】冬の食卓セット（スタンダード）
  タグライン: ホタテ・いくら・金華サバ、三陸の冬が揃う
  コンセプト: クリスマスの豪華な食卓をイメージ。
             いくらの赤とホタテの白でクリスマスカラーを演出。
             調理不要で華やかな一皿が完成する

【案3】海鮮オードブルセット（カジュアル）
  タグライン: パーティーに出すだけで「すごい」と言わせる
  コンセプト: ホームパーティーのオードブルとして、
             ホタテのバター焼き・牡蠣のグラタンなど
             クリスマスらしい洋風料理に使い回せる
```

### 商品説明文（生成例）

```html
<h2>フランスのクリスマスは牡蠣から始まる</h2>
<p>三陸 Noël Blanc は、フランスで12月24日の夜に食べる
「ユイットール・ド・ノエル（クリスマスイブの牡蠣）」に着想を得たセットです。
三陸の冬の海が育てた牡蠣・タラの白子・フカヒレを詰め合わせた、
今年だけの限定ギフト。</p>

<h2>セット内容</h2>
<ul>
  <li>三陸産 牡蠣むき身（500g）— クリーミーで濃厚、グラタンや鍋に</li>
  <li>三陸産 真ダラの白子（200g）— 冬限定、とろける食感の最高級食材</li>
  <li>気仙沼産 フカヒレ姿煮セット（2枚）— 海の宝、お祝いの食卓に</li>
</ul>

<h2>贈り方・楽しみ方</h2>
<p>牡蠣は生食・グラタン・アヒージョと使い回せます。
白子はポン酢で食べるだけで絶品。
フカヒレは市販の姿煮用スープで30分煮込むだけで本格的な一皿に。
大切な人への贈り物に、あるいはご自宅の特別な夜の食卓に。</p>

<h2>お届けについて</h2>
<p>牡蠣・白子は冷蔵便、フカヒレは常温便で別送。
到着後は2日以内にお召し上がりください。
12月22日（火）正午が当日着保証の締め切りです。</p>
```

### X（Twitter）投稿文（生成例）

```
フランスのクリスマスイブは、牡蠣から始まるんです——

三陸産の牡蠣・白子・フカヒレを詰めた冬限定ギフトを作りました。
「海鮮でクリスマス」という選択肢、今年は試してみませんか。

#クリスマスギフト #三陸海鮮 #気仙沼 #冬のごちそう
```

### Instagramキャプション（生成例）

```
白い冬の食卓に、三陸の海をそのまま届けたい。

牡蠣のクリーミーな香り、タラ白子のとろける食感、
気仙沼のフカヒレが並ぶクリスマスの夜。

今年の特別な夜は、三陸から始まります。

#三陸海鮮 #クリスマスディナー #牡蠣 #フカヒレ #気仙沼 #冬の旬
```

### キャンペーンメール（生成例）

**早期予約メール（10月下旬）:**

```
件名: 三陸のクリスマスギフト、早めに動く理由

12月はギフトが集中します。
冷蔵便の予約は早い順に枠が埋まるため、
10月中に注文いただいたお客様は送料無料でお届けします。

今年のラインナップは3種類。フランスのクリスマスにも使われる
三陸の牡蠣を核にしたプレミアムセット、ホタテ・いくら入りのスタンダード、
ホームパーティー向けのカジュアルセットをご用意しました。

12月25日の食卓に、気仙沼・三陸から直送します。

割引コード: {{early_discount_code}}（送料無料・11月15日まで）
▶ セットを確認する: {{shop_url}}
```

**締め切り前アラート（12月22日）:**

```
件名: 【残3日】三陸直送、最終便の締め切りです

12月25日に間に合う最後の便の締め切りは、
本日22日（火）正午です。

プレミアムセット「三陸 Noël Blanc」は残りわずか。
牡蠣・白子・フカヒレという冬の三陸の最高峰を揃えたセットは、
今年の生産量がそのまま数に反映されています。

気仙沼から最短翌日でお届けします。
▶ 今すぐ注文する: {{shop_url}}
```

## コストと効果

**APIコスト（一連の生成処理）**

| 処理 | トークン数（概算） | コスト |
|------|------------------|--------|
| セット企画3案 | 入力1,800＋出力3,000 | 約2.0円 |
| Shopify説明文＋SNS投稿 | 入力1,400＋出力2,000 | 約1.7円 |
| キャンペーンメール3種 | 入力1,200＋出力2,000 | 約1.6円 |
| 合計 | | **約5.3円** |

**工数削減**

| 作業 | Before（手動） | After（Claude API） |
|------|--------------|-------------------|
| クリスマスギフトセット案出し | 3〜4時間 | 0分（自動） |
| Shopify商品説明文作成 | 約1.5時間 | 5分（確認のみ） |
| X・Instagram投稿文作成 | 約1時間 | 即時 |
| キャンペーンメール3種作成 | 約2時間 | 10分（確認のみ） |
| 合計 | 約7〜8時間 | **約15分** |

**業者さんの一言：**
「"フランスのクリスマスは牡蠣から始まる"って言い方、自分じゃ絶対思いつかない。牡蠣は冬の主力商品だから、こういう角度で打ち出せるなら嬉しい。早期予約の割引コードを10月中に案内するのもやったことなかったから試してみます」

## ポイントと注意点

**うまくいった点**
- 商品の「ギフト向き度（A/B/C）」を渡したことで、Aランク商品を中心にしたセット構成になった
- 「フランスのクリスマスは牡蠣から始まる」という文化的な切り口は指示していない。Claudeが在庫データと牡蠣の説明から自分で発見した
- 価格帯を「プレミアム・スタンダード・カジュアル」と明示したことで、顧客層ごとの訴求が自然にできた

**注意点**
- クリスマスの「洋風」演出が強くなりすぎると、三陸産の文脈から離れる。**産地名は必ず含める**という制約が重要
- 白子は1〜2月が旬のため、12月のクリスマスには在庫確認が必要。APIに渡す在庫データは季節ごとに更新すること
- 早期予約メールの割引コードはShopifyでの発行・管理が別途必要（このコードは生成しない）
- X投稿は140文字制限に引っかかることがあるので送信前に計測すること

## まとめ

「海鮮×クリスマス」という接点のなさそうな組み合わせから、「フランスのクリスマスは牡蠣から始まる」という説得力のある角度が出てきた。

ハロウィンのときと同じ構造だ。**「どうつなげるか」という発想はClaudeに任せて、人間は在庫データと制約条件を整えることに集中する**。

今回、メールを3種類に増やして「早期予約→通常告知→締め切り前」という導線を設計した。クリスマスは準備期間が長いイベントなので、3ヶ月かけて購買行動を誘導できる。このテンプレートを毎年再利用するときは、在庫商品とセット価格・締め切り日を差し替えるだけで動く。

次は年末のお歳暮第2弾か、正月向けのおせちの代替ギフトあたりを考えている。「海鮮×日本の行事」の組み合わせはまだいくつも残っている。

コード・カスタマイズ相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
