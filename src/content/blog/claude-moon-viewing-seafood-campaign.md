---
title: "Claude APIでお月見シーズンの海鮮ギフトセットと販促コンテンツを自動生成した話【三陸水産EC】"
description: "9月中旬のお月見に向けて、「どんなセットを作ればいい？」「商品名と説明文は？」「メールは何を送る？」をClaude APIに任せたら、企画から文面まで1時間で揃った話。"
pubDate: 2026-08-28
author: sam
category: "Claude活用"
tags: ["Claude", "EC自動化", "メールマーケティング", "お月見", "季節キャンペーン", "商品企画", "水産業", "Shopify"]
readingTime: 9
---

## 「お月見、なんか商品出したいんだけど何が売れると思う？」

8月末、業者さんから連絡が来た。

「敬老の日の次は十五夜でしょ。でもお月見って海鮮と結びつくイメージないよね。どう攻めればいいか全然わからなくて」

今年の中秋の名月は9月17日。お月見は「月見バーガー」「月見そば」などで食品業界は毎年盛り上がるが、水産ECで打ち出せているところはまだ少ない。

**差別化できるチャンスでもある。**

「月と海。三陸から何が出せるか考えてみます」と伝えて、Claude APIに商品企画から始めてもらった。

## 作ったもの

3つのフェーズをまとめてClaude APIに任せた。

1. **お月見向け商品セットの企画提案**（既存在庫からの組み合わせ提案＋セット名）
2. **商品説明文の自動生成**（Shopify用の商品ページ本文）
3. **キャンペーンメールの自動生成**（告知メール＋購入後フォロー文面）

## 実装コード

### 1. 型定義と在庫商品マスタ

```typescript
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';

const client = new Anthropic();

interface InventoryItem {
  id: string;
  name: string;
  unitPrice: number;
  category: string;   // 例: '鮮魚', '加工品', '珍味', '貝類'
  tags: string[];
  stock: number;
  marginRate: number; // 利益率（0〜1）
}

// 現在の在庫商品
const INVENTORY: InventoryItem[] = [
  {
    id: 'F001',
    name: '三陸産 活ホタテ（10枚）',
    unitPrice: 3800,
    category: '貝類',
    tags: ['人気', '鮮度抜群', '焼きやすい'],
    stock: 150,
    marginRate: 0.38,
  },
  {
    id: 'F002',
    name: '気仙沼産 真イカ一夜干し（3枚）',
    unitPrice: 1800,
    category: '干物',
    tags: ['おつまみ', '日持ちする', 'お月見向き'],
    stock: 200,
    marginRate: 0.42,
  },
  {
    id: 'F003',
    name: '宮城県産 殻付き牡蠣（20個）',
    unitPrice: 4200,
    category: '貝類',
    tags: ['豪華感', '焼き牡蠣', 'BBQ'],
    stock: 80,
    marginRate: 0.35,
  },
  {
    id: 'F004',
    name: '三陸産 塩蔵わかめ（200g）',
    unitPrice: 980,
    category: '海藻',
    tags: ['健康志向', '定番', '汎用性高い'],
    stock: 300,
    marginRate: 0.55,
  },
  {
    id: 'F005',
    name: '気仙沼産 サンマ開き（6枚）',
    unitPrice: 2400,
    category: '干物',
    tags: ['旬', '秋', '定番'],
    stock: 120,
    marginRate: 0.40,
  },
  {
    id: 'F006',
    name: '三陸産 いくら醤油漬け（100g）',
    unitPrice: 3200,
    category: '珍味',
    tags: ['高級感', 'ご飯のお供', 'ギフト向き'],
    stock: 60,
    marginRate: 0.33,
  },
  {
    id: 'F007',
    name: '宮城県産 めかぶ（5パック）',
    unitPrice: 1200,
    category: '海藻',
    tags: ['健康志向', 'とろみ', '朝食向き'],
    stock: 250,
    marginRate: 0.50,
  },
];
```

### 2. お月見向けセット商品を企画させる

```typescript
interface SetProductProposal {
  setName: string;
  tagline: string;
  items: Array<{ id: string; quantity: number }>;
  setPrice: number;
  targetCustomer: string;
  moonViewingConcept: string;
}

async function proposeSetProducts(
  inventory: InventoryItem[],
  targetPriceRanges: string[],
  proposalCount: number
): Promise<SetProductProposal[]> {
  const itemList = inventory
    .filter((item) => item.stock > 10)
    .map(
      (item) =>
        `ID:${item.id} / ${item.name} / ¥${item.unitPrice.toLocaleString()} / ` +
        `カテゴリ:${item.category} / タグ:${item.tags.join('・')} / 在庫:${item.stock}`
    )
    .join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 3000,
    messages: [
      {
        role: 'user',
        content: `あなたは三陸水産ECのプロデューサーです。
お月見（中秋の名月：9月17日）に向けた海鮮ギフトセットを${proposalCount}種類提案してください。

【現在の在庫商品一覧】
${itemList}

【価格帯の目標】
${targetPriceRanges.join('・')}

【条件】
- 在庫10個以下の商品は使わない
- セット価格は含まれる商品の単品合計より10〜15%お得に設定
- 「お月見」「月」「秋の夜長」など、季節感のある名前をつける
- 三陸・宮城・気仙沼など産地の言葉をセット名かタグラインに入れる
- 在庫が豊富で利益率の高い商品を優先して組み合わせる

【出力（JSONの配列）】
[
  {
    "setName": "セット名（〜15文字）",
    "tagline": "キャッチコピー（〜30文字）",
    "items": [{ "id": "商品ID", "quantity": 数量 }],
    "setPrice": セット価格（税込）,
    "targetCustomer": "どんな顧客向けか（〜50文字）",
    "moonViewingConcept": "お月見とのつながりを説明するコンセプト（〜80文字）"
  }
]`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '[]';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('セット企画のJSON解析失敗');

  return JSON.parse(jsonMatch[0]) as SetProductProposal[];
}
```

### 3. Shopify用商品説明文を生成する

```typescript
interface ShopifyProductContent {
  title: string;
  bodyHtml: string;    // Shopifyのbody_htmlフィールド用
  metaDescription: string;
  tags: string;
}

async function generateShopifyDescription(
  proposal: SetProductProposal,
  items: InventoryItem[]
): Promise<ShopifyProductContent> {
  const itemDetails = proposal.items
    .map(({ id, quantity }) => {
      const item = items.find((i) => i.id === id);
      return item ? `・${item.name}（${quantity}点）` : '';
    })
    .filter(Boolean)
    .join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: `三陸水産ECのShopify商品ページ用のコンテンツを作成してください。

【セット情報】
セット名: ${proposal.setName}
タグライン: ${proposal.tagline}
セット価格: ¥${proposal.setPrice.toLocaleString()}（税込）
コンセプト: ${proposal.moonViewingConcept}
対象顧客: ${proposal.targetCustomer}

【内容物】
${itemDetails}

【出力（JSONのみ）】
{
  "title": "Shopifyの商品タイトル（セット名＋サブタイトル、〜60文字）",
  "bodyHtml": "商品ページ本文HTML（h2・p・ulタグを使用、400〜600文字相当）。お月見のシーン・産地のストーリー・内容物説明・保存方法の順で構成",
  "metaDescription": "SEO用メタディスクリプション（〜120文字）",
  "tags": "Shopifyタグのカンマ区切り（お月見,季節限定,ギフト,三陸 など）"
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('商品説明文のJSON解析失敗');

  return JSON.parse(jsonMatch[0]) as ShopifyProductContent;
}
```

### 4. キャンペーンメールを生成する

```typescript
interface CampaignEmails {
  announcement: { subject: string; body: string };   // 告知メール
  lastCall: { subject: string; body: string };        // 締め切り前アラート
  postPurchase: { subject: string; body: string };    // 購入後フォロー
}

async function generateCampaignEmails(
  proposals: SetProductProposal[],
  eventDate: string,
  closingDate: string
): Promise<CampaignEmails> {
  const setsSummary = proposals
    .map(
      (p) =>
        `・${p.setName}（¥${p.setPrice.toLocaleString()}）：${p.tagline}`
    )
    .join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 3000,
    messages: [
      {
        role: 'user',
        content: `三陸水産ECのお月見キャンペーンメールを3種類作成してください。

【キャンペーン概要】
- お月見（中秋の名月）：${eventDate}
- 注文締め切り（当日着保証）：${closingDate}
- 今年の新セット商品：
${setsSummary}

【3種類のメール】
1. 告知メール（2週間前に送る）：期待感を高め、セット商品を紹介
2. 締め切り前アラート（3日前）：緊急性を伝え、在庫残り少を示唆
3. 購入後フォロー（届いた翌日想定）：お礼と活用レシピ案内

【共通ルール】
- 件名は30文字以内
- 本文は300〜400文字（購入後フォローは200〜300文字）
- 「お月見」は1〜2回まで（くどくならないよう）
- 産地（三陸・気仙沼・宮城）の言葉を必ず入れる
- URLプレースホルダーは {{shop_url}} を使用

【出力（JSONのみ）】
{
  "announcement": { "subject": "件名", "body": "本文" },
  "lastCall": { "subject": "件名", "body": "本文" },
  "postPurchase": { "subject": "件名", "body": "本文" }
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('キャンペーンメールのJSON解析失敗');

  return JSON.parse(jsonMatch[0]) as CampaignEmails;
}
```

### 5. 実行スクリプト

```typescript
async function main() {
  console.log('🌕 お月見キャンペーン自動生成開始...\n');

  // セット商品を3種類企画
  console.log('📦 セット商品を企画中...');
  const proposals = await proposeSetProducts(
    INVENTORY,
    ['3,000〜5,000円', '6,000〜8,000円', '10,000円前後'],
    3
  );

  proposals.forEach((p, i) => {
    console.log(`\n【案${i + 1}】${p.setName}`);
    console.log(`  タグライン: ${p.tagline}`);
    console.log(`  セット価格: ¥${p.setPrice.toLocaleString()}`);
    console.log(`  対象: ${p.targetCustomer}`);
  });

  // 最初のセット（メイン商品）の商品説明を生成
  console.log('\n📝 Shopify商品説明文を生成中...');
  const shopifyContent = await generateShopifyDescription(proposals[0], INVENTORY);
  console.log(`\nタイトル: ${shopifyContent.title}`);
  console.log(`メタディスクリプション: ${shopifyContent.metaDescription}`);
  console.log(`タグ: ${shopifyContent.tags}`);

  // キャンペーンメール生成
  console.log('\n✉️ キャンペーンメールを生成中...');
  const emails = await generateCampaignEmails(
    proposals,
    '2026年9月17日（木）',
    '2026年9月15日（火）正午'
  );

  console.log('\n--- 告知メール ---');
  console.log(`件名: ${emails.announcement.subject}`);
  console.log(`本文:\n${emails.announcement.body}`);

  console.log('\n--- 締め切り前アラート ---');
  console.log(`件名: ${emails.lastCall.subject}`);
  console.log(`本文:\n${emails.lastCall.body}`);

  // JSONで保存
  const output = { proposals, shopifyContent, emails };
  fs.writeFileSync(
    'moon-viewing-campaign-2026.json',
    JSON.stringify(output, null, 2),
    'utf-8'
  );
  console.log('\n✅ moon-viewing-campaign-2026.json に保存完了');
}

main().catch(console.error);
```

## 実際に生成された内容

### セット商品の企画案（出力例）

```
【案1】三陸の月見肴セット
  タグライン: 秋の夜、三陸の海をそのまま食卓へ
  セット価格: ¥4,800
  対象: 自宅でゆっくりお月見を楽しみたい一人〜二人世帯

【案2】気仙沼 十五夜贅沢セット
  タグライン: 月明かりに映える、三陸の恵み
  セット価格: ¥7,200
  対象: 家族や友人と囲む豪華なお月見の席向け

【案3】三陸の月 プレミアム海鮮ギフト
  タグライン: この秋だけの、特別な贈り物
  セット価格: ¥10,500
  対象: 大切な方への手土産・ギフト用途
```

### 商品説明文（生成例）

```html
<h2>秋の夜長を、三陸の海と一緒に</h2>
<p>中秋の名月を眺めながら、宮城・気仙沼から届いた海の幸でゆっくりとした夜を。
「三陸の月見肴セット」は、その日に食べたくなる干物と珍味を厳選しました。</p>

<h2>セット内容</h2>
<ul>
  <li>三陸産 活ホタテ（10枚）</li>
  <li>気仙沼産 真イカ一夜干し（3枚）</li>
  <li>三陸産 いくら醤油漬け（100g）</li>
</ul>

<h2>おすすめの食べ方</h2>
<p>ホタテは七輪やグリルで豪快に焼いて。イカ一夜干しはトースターで2〜3分、
醤油ひと垂らしで風味が増します。いくらは白いごはんに乗せてお月見飯に。</p>

<h2>保存・お届けについて</h2>
<p>活ホタテは冷蔵便でお届け（到着後2日以内にお召し上がりください）。
干物・いくらは冷凍便。解凍後は当日中に。</p>
```

### キャンペーンメール（生成例）

**告知メール（2週間前）:**

```
件名: 今年の十五夜は三陸の海で迎えませんか

気仙沼・三陸の秋の恵みが、今年もそろいました。

9月17日の中秋の名月に向けて、今年だけの「お月見セット」を用意しました。
ホタテを七輪で焼きながら、イカ一夜干しをつまみながら、秋の夜長をゆっくり過ごす——
そんなひとときのお供に、三陸の海の幸を届けます。

3種類のセットをご用意。¥4,800の少人数向けから、ギフトにも使える¥10,500の
プレミアムセットまで。9月15日正午が当日着保証の締め切りです。

▶ セット商品を見る: {{shop_url}}
```

**締め切り前アラート（3日前）:**

```
件名: 【残3日】三陸のお月見セット、締め切りが近づいています

9月17日（木）の中秋の名月まであと3日。
当日着保証でのご注文受付は9月15日（火）正午が締め切りです。

特に「気仙沼 十五夜贅沢セット」は残りわずかの状況です。
今年の夜長のお供に、三陸から直送の海の幸をぜひ。

▶ まだ間に合います: {{shop_url}}
```

## コストと効果

**APIコスト（一連の生成処理）**

| 処理 | トークン数（概算） | コスト |
|------|------------------|--------|
| セット企画3案 | 入力1,500＋出力2,000 | 約1.5円 |
| Shopify商品説明文 | 入力1,000＋出力1,200 | 約0.9円 |
| キャンペーンメール3種 | 入力1,200＋出力2,000 | 約1.4円 |
| 合計 | | **約3.8円** |

**工数削減**

| 作業 | Before（手動） | After（Claude API） |
|------|--------------|-------------------|
| セット商品の組み合わせ案出し | 1〜2時間 | 0分（自動） |
| Shopify商品説明文作成 | 約1時間 | 5分（確認のみ） |
| メール文面3種作成 | 約2時間 | 5分（確認のみ） |
| 合計 | 約4時間 | **約10分** |

**業者さんの一言：**
「正直お月見と水産を結びつけるイメージが全然なかったけど、三陸の月見肴って言われると確かにそれっぽい。セット名をClaude任せにしたら自分じゃ出てこない感じのやつが来て助かった」

## ポイントと注意点

**うまくいった点**
- 在庫の多い商品・利益率の高い商品を優先してセットを組むよう指示できる
- セット名・タグラインで産地の世界観が一貫しているため、Shopifyのページにそのまま使える
- 「お月見」というテーマが決まっていると、Claude がストーリー付きのコンテンツを作りやすい

**注意点**
- 在庫数はリアルタイムで変わるため、実行直前に最新値で再取得すること
- 生成された商品説明HTMLはShopifyの `body_html` フィールドに入れる前に表示確認を忘れずに
- セット価格は自動計算されるが、Shopify側の設定（税込・税別）と合わせて手動で最終確認を

## まとめ

「水産ECでお月見はどう攻めるか」という問いに対して、Claude APIを使えば商品企画・説明文・メール文面の3点セットを1時間以内に揃えられた。

特に「どんなセットを組めばいいか」という企画部分は、在庫情報と条件を渡すだけで三陸らしい世界観の名前まで出てきたのが想定外に良かった。

お月見に限らず、**ひな祭り・端午の節句・年末年始など「行事×食の組み合わせ」**は毎年ある。今年の実装をテンプレート化しておけば、来年は行事名と締め切り日を変えるだけでそのまま動く。

コード・カスタマイズ相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
