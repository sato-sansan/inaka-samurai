---
title: "Claude APIで秋の定期便コースの中身を自動最適化した話【三陸水産EC】"
description: "毎月の定期便、何を入れるか決めるのが地味に大変だった。秋は秋鮭・さんま・ホタテが重なる旬ピーク。Claudeに漁獲データと在庫情報を渡したら、顧客の好みに合わせた定期便コンテンツ案が5分で揃った話。"
pubDate: 2026-09-01
author: sam
category: "Claude活用"
tags: ["Claude", "定期便", "EC自動化", "サブスクリプション", "水産業", "秋", "三陸", "Shopify"]
readingTime: 8
---

## 「今月の定期便、何を入れる？」の決定が毎月の悩みだった

[定期便プランの案内メール](/blog/claude-subscription-plan-email)を整備してから加入者が増えた。それはよかった。

ただ新しい悩みが生まれた。**毎月の「コンテンツ決め」が思った以上に手間がかかる**のだ。

秋になると特にそれが顕著になる。9月は秋鮭の初物・さんまの本番・ホタテの身入りピークが重なる。全部が「旬の頂点」になるから、どれを定期便に入れるかが難しい。加入者によって好みも違う（「白身魚好き」「貝類が好き」「切り身じゃなく姿で欲しい」）し、前月何を入れたかも把握しなきゃいけない。

スプレッドシートで管理していたが、加入者が50人を超えたあたりで限界を感じた。

そこでClaudeに「今月の漁獲データ・在庫・各加入者の購買履歴」を渡して、コース別の最適なコンテンツ案を自動生成する仕組みを組んだ。

## 作ったもの

Shopifyの定期便受注データ・在庫情報・漁獲状況をまとめてClaudeに投げると：

1. **コース別セット内容案**（スタンダード・プレミアム・お試しの3種）
2. **各加入者への同梱メッセージ文**（前月との違いや旬の説明を含む）
3. **翌月のプレビュー文**（次回への期待感を持たせる1段落）

を一括生成。担当者の最終確認を経てShopifyの定期便バリアントに反映する。

## 実装コード

### 1. 月次データの型定義

```typescript
interface SeasonalFish {
  name: string;         // "秋鮭（知床産）"
  availability: 'peak' | 'good' | 'limited';
  stockKg: number;      // 在庫量（kg）
  note: string;         // "今年は脂のりが特に良い"
}

interface Subscriber {
  id: string;
  name: string;
  plan: 'standard' | 'premium' | 'trial';
  preferences: string[];     // ["白身魚好き", "姿希望", "辛子明太子NG"]
  lastMonthContents: string; // 前月セット内容の概要
}

interface MonthlyOptimizationInput {
  targetMonth: string;       // "2026年9月"
  seasonalFish: SeasonalFish[];
  subscribers: Subscriber[];
  budgetPerBox: Record<'standard' | 'premium' | 'trial', number>;
}
```

### 2. Claude APIでコンテンツを最適化

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface BoxContent {
  mainFish: string;
  sides: string[];
  quantity: string;
  estimatedWeight: string;
}

interface OptimizationResult {
  standardBox: BoxContent;
  premiumBox: BoxContent;
  trialBox: BoxContent;
  subscriberMessages: Record<string, string>;
  nextMonthPreview: string;
}

async function optimizeMonthlyBox(
  input: MonthlyOptimizationInput
): Promise<OptimizationResult> {
  const fishSummary = input.seasonalFish
    .map(f => `・${f.name}（状態: ${f.availability}、在庫${f.stockKg}kg、${f.note}）`)
    .join('\n');

  const subscriberSummary = input.subscribers
    .map(s =>
      `[${s.id}] ${s.name}（${s.plan}）好み: ${s.preferences.join('、')} / 前月: ${s.lastMonthContents}`
    )
    .join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `あなたは三陸水産ECの定期便コーディネーターです。
今月の旬素材と加入者の情報をもとに、最適なセット内容と同梱メッセージを提案してください。

【対象月】
${input.targetMonth}

【今月の旬素材】
${fishSummary}

【加入者一覧と好み】
${subscriberSummary}

【コース別予算（1箱あたり食材原価）】
・スタンダード: ${input.budgetPerBox.standard}円
・プレミアム: ${input.budgetPerBox.premium}円
・お試し: ${input.budgetPerBox.trial}円

【制作方針】
- 同じ魚が前月と連続しないよう考慮する
- 加入者の好みに反する食材は除外する
- peakの食材を優先して入れ、limitedは高単価プランのみに配分する
- 同梱メッセージは「なぜこれを入れたか」の旬の理由を50字以内で伝える
- 翌月プレビューは期待感を持たせる1段落（80字以内）

【出力形式（JSONのみ）】
{
  "standardBox": {
    "mainFish": "メイン魚介の説明",
    "sides": ["副素材1", "副素材2"],
    "quantity": "内容量の概要",
    "estimatedWeight": "約X kg"
  },
  "premiumBox": { ... },
  "trialBox": { ... },
  "subscriberMessages": {
    "加入者ID": "同梱メッセージ（50字以内）",
    ...
  },
  "nextMonthPreview": "翌月への期待感を込めた1段落"
}`,
      },
    ],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON解析失敗');
  return JSON.parse(jsonMatch[0]) as OptimizationResult;
}
```

### 3. 実際の生成結果（2026年9月分）

**今月の旬素材インプット**

| 魚介 | 状態 | 在庫 | メモ |
|------|------|------|------|
| 秋鮭（知床産） | peak | 80kg | 今年は脂のりが特に良い |
| さんま（大船渡産） | peak | 60kg | 脂のりMAX、今が本番 |
| ホタテ（陸前高田産） | good | 40kg | 身入り良好 |
| 牡蠣（気仙沼産） | limited | 15kg | 今季最初の入荷 |

**Claudeが出力したコース別セット**

```
【スタンダードコース（5,000円帯）】
メイン: さんま姿3尾（大船渡産）
副素材: 秋鮭切り身2切れ
内容量: 約1.2kg
---
【プレミアムコース（10,000円帯）】
メイン: 秋鮭半身（知床産）
副素材: 気仙沼産牡蠣500g、ホタテ貝柱6個
内容量: 約1.8kg
---
【お試しコース（3,000円帯）】
メイン: さんま姿2尾
副素材: ホタテ貝柱3個
内容量: 約0.8kg
```

**加入者別同梱メッセージ例**

```
[SUB_012] 田中さん（スタンダード / 白身魚好き）
→「今月は例外的に！大船渡のさんまが今年最高の脂のりで、
   白身派の方にもぜひ食べていただきたい旬の一品です」

[SUB_031] 佐藤さん（プレミアム / 貝類好き）
→「今季初の気仙沼牡蠣が入りました。プレミアム加入者の方だけへの
   今月限定のお届けです」
```

**翌月プレビュー**
```
10月は毛ガニと戻りガツオが重なる年に一度のチャンス。
プレミアムコースでは特大サイズの毛ガニをお届け予定です。
```

## 全体フロー

```typescript
async function runMonthlyOptimization(): Promise<void> {
  // 1. Shopifyから今月の定期便加入者と購買履歴を取得
  const subscribers = await fetchShopifySubscribers();

  // 2. 在庫管理システムから旬素材データを取得
  const seasonalFish = await fetchSeasonalInventory();

  // 3. Claudeで最適化
  const result = await optimizeMonthlyBox({
    targetMonth: '2026年9月',
    seasonalFish,
    subscribers,
    budgetPerBox: { standard: 2800, premium: 6000, trial: 1600 },
  });

  // 4. 結果をNotionのレビューページに書き出す（担当者が確認）
  await writeToNotionReviewPage(result);

  // 5. 承認後にShopifyバリアントを更新（手動トリガー）
  console.log('📋 Notionのレビューページを確認して承認してください');
}
```

承認後は別のスクリプトがShopifyのバリアントを更新し、各加入者へのメッセージカードを同梱物PDFとして生成する。

## コストと効率

**APIコスト（1回の最適化処理 / 加入者50人想定）**

| 項目 | 数値 |
|------|------|
| 入力トークン | 約2,400 |
| 出力トークン | 約1,200 |
| 1回のコスト | 約1.8円 |

**時間比較**

| 作業 | Before（手作業） | After（Claude） |
|------|----------------|----------------|
| コース内容の決定 | 2〜3時間 | 5分（確認含む） |
| 加入者別メッセージ作成 | 50人×5分＝4時間 | 同時生成 |
| 翌月プレビュー文 | 30分 | 含む |

月1回の作業が合計7時間以上かかっていたのが、30分（確認・承認含む）に短縮された。

## 工夫したポイント

**「前月との重複チェック」をプロンプトに含める**

`lastMonthContents` を各加入者のデータに持たせて渡すことで、「先月もさんまだった人には今月は鮭にする」という自然な配慮をClaudeが自動でやってくれる。手作業で50人分を追うのは現実的ではなかった。

**在庫の状態を3段階で渡す**

`peak / good / limited` の3段階にすることで「limitedな牡蠣は高単価プランだけに配分する」というロジックをプロンプトで自然に表現できる。数字だけ渡すより指示が明確になる。

**担当者の確認ステップを必ず挟む**

生成結果はNotionのレビューページに出力し、担当者が「承認」を押してからShopifyに反映する設計にした。Claudeの出力を直接Shopifyに流す自動化は、今のところやらない。魚の品質や入荷状況は現場判断が必要な部分が残るため。

## 副産物：加入者の好みデータが蓄積される

この仕組みを回すと「誰がどの食材を喜んでいるか」のデータが自然に集まる。同梱メッセージへの反応（SNSのメンション・レビュー投稿）と紐付けると、次回以降の精度が上がる。

現在は簡易的にNotionでログを取っているが、3ヶ月後には「この加入者は貝類のとき購入継続率が高い」という示唆が出てきた。

## まとめ

定期便の「中身決め」は、旬の把握・在庫確認・顧客ごとの好み調整が重なる複合的な作業だった。これをClaudeに旬素材データと加入者情報を渡すだけで、コース提案・個別メッセージ・翌月予告まで一括生成できるようになった。

コストは月1回1.8円。毎月7時間の作業が30分になり、加入者への「自分のために選んでくれた」感も高まった。

秋は旬の食材が重なる一番難しい季節だが、Claudeを使えば複雑な最適化も短時間で対応できる。

コード・カスタマイズ相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
