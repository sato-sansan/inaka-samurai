---
title: "Claude API × Notion DBで在庫切れ直前に配信を自動ストップ・差し替えた話【水産EC】"
description: "配信スケジュールを自動化したら今度は「在庫ゼロなのにLINEが届いた」問題が起きた。Notion DBの在庫情報をClaudeに渡して、在庫切れ直前に配信を止めるか別商品に差し替える仕組みを作った。"
pubDate: 2026-08-19
author: sam
category: "Claude活用"
tags: ["Claude", "Notion", "在庫管理", "LINE", "メルマガ", "自動化", "水産業", "EC"]
readingTime: 9
---

## 「在庫ゼロの商品のLINEが届いた」問題

[配信スケジュール自動化](/blog/claude-auto-schedule-delivery)を動かし始めて2週間で、さっそく問題が起きた。

「カツオの在庫が昨日切れたのに、今朝のLINEで『本カツオ入荷中』って配信が出てしまった…」

自動化のあるあるだ。配信スケジュールは旬カレンダー基準で組まれているが、実際の在庫は天候・漁の状況・注文集中で急変する。**スケジュールと在庫が噛み合わなくなる**。

対策として「在庫が一定数を下回ったら配信を止めるか、在庫がある別商品の配信に差し替える」仕組みをNotion DB連携で実装した。

## 作ったもの

Notionの在庫管理DBを5分ごとにポーリングして：

1. **配信5日前チェック**：予定配信の主役商品が在庫切れ（または残り5個以下）のとき、Claudeが代替商品を提案
2. **自動差し替え**：代替商品があればプランを更新して配信コンテンツを再生成
3. **アラートメール**：代替商品もない場合は業者さんにメールして配信をスキップ

## Notion DB の設計

既存の在庫管理DBに「配信連携用」フィールドを2つ追加するだけ。

| フィールド名 | 種類 | 用途 |
|-----------|-----|------|
| 商品名 | タイトル | 既存 |
| カテゴリ | セレクト | 既存（例：カツオ、サケ、牡蠣） |
| 在庫数 | 数値 | 既存 |
| 配信優先度 | セレクト | **追加**（高・中・低） |
| 配信停止しきい値 | 数値 | **追加**（何個以下で停止するか） |

業者さんが「配信停止しきい値」を商品ごとに設定しておけば、しきい値の調整は自分でできる。

## 実装コード

### 1. Notion DBから在庫情報を取得

```typescript
import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_API_KEY });

interface StockItem {
  productName: string;
  category: string;
  stock: number;
  deliveryPriority: '高' | '中' | '低';
  stopThreshold: number;
  isAvailable: boolean; // stock > stopThreshold
}

async function getStockList(): Promise<StockItem[]> {
  const response = await notion.databases.query({
    database_id: process.env.NOTION_STOCK_DB_ID!,
    filter: {
      property: '在庫数',
      number: { greater_than: 0 },
    },
    sorts: [{ property: '配信優先度', direction: 'ascending' }],
  });

  return response.results
    .filter((p) => p.object === 'page')
    .map((p: any) => {
      const stock = p.properties['在庫数']?.number ?? 0;
      const stopThreshold = p.properties['配信停止しきい値']?.number ?? 5;
      return {
        productName: p.properties['商品名']?.title?.[0]?.text?.content ?? '',
        category: p.properties['カテゴリ']?.select?.name ?? '',
        stock,
        deliveryPriority: p.properties['配信優先度']?.select?.name ?? '低',
        stopThreshold,
        isAvailable: stock > stopThreshold,
      };
    })
    .filter((item) => item.productName !== '');
}
```

### 2. Claudeで代替商品を提案

在庫が少ない商品が配信予定に入っていたとき、Claudeにコンテキストを渡して差し替え案を出してもらう。

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface SubstituteResult {
  canSubstitute: boolean;
  substituteProduct?: string;
  substituteCategory?: string;
  reason: string;
  newTheme?: string;
  newKeyMessage?: string;
}

async function findSubstituteProduct(
  originalPlan: DeliveryPlan,
  stockList: StockItem[]
): Promise<SubstituteResult> {
  const availableProducts = stockList
    .filter((s) => s.isAvailable)
    .map((s) => `${s.productName}（${s.category}、在庫${s.stock}個、優先度：${s.deliveryPriority}）`)
    .join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `水産ECの配信担当です。配信予定の商品が在庫切れのため、代替商品を選んでください。

【元の配信プラン】
- テーマ：${originalPlan.theme}
- キーメッセージ：${originalPlan.keyMessage}
- チャネル：${originalPlan.channel}
- 配信日：${originalPlan.date}

【在庫あり商品リスト】
${availableProducts || '（なし）'}

【判断基準】
- 元のテーマと季節感・食シーン的に近い商品を優先する
- 配信優先度「高」の商品を優先する
- 在庫が少ない（50個以下）商品は避ける
- 代替商品がない場合は canSubstitute: false を返す

【出力（JSONのみ）】
{
  "canSubstitute": true / false,
  "substituteProduct": "商品名（代替できる場合のみ）",
  "substituteCategory": "カテゴリ名",
  "reason": "なぜこの商品を選んだか（50字以内）",
  "newTheme": "差し替え後の配信テーマ（20字以内）",
  "newKeyMessage": "差し替え後のキーメッセージ（40字以内）"
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('代替商品提案のJSON解析失敗');
  return JSON.parse(jsonMatch[0]) as SubstituteResult;
}
```

### 3. 在庫チェック＆プラン自動更新（毎日実行）

```typescript
async function checkAndUpdateDeliveryPlans(): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const stockList = await getStockList();

  // 5日後の配信プランを対象
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + 5);
  const targetDateStr = targetDate.toISOString().split('T')[0];

  const plans = await getPlansForDate(targetDateStr);

  for (const plan of plans) {
    const mainProduct = stockList.find((s) =>
      plan.theme.includes(s.category) || plan.relatedEvents.some((e) => e.includes(s.category))
    );

    if (!mainProduct) continue;

    if (mainProduct.isAvailable) {
      console.log(`✅ ${plan.date} ${plan.theme}：在庫OK（${mainProduct.stock}個）`);
      continue;
    }

    console.log(`⚠️ ${plan.date} ${plan.theme}：在庫不足（${mainProduct.stock}個、しきい値${mainProduct.stopThreshold}個）`);

    const substitute = await findSubstituteProduct(plan, stockList);

    if (substitute.canSubstitute && substitute.substituteProduct) {
      // プランを差し替えてコンテンツを再生成
      const updatedPlan: DeliveryPlan = {
        ...plan,
        theme: substitute.newTheme ?? plan.theme,
        keyMessage: substitute.newKeyMessage ?? plan.keyMessage,
        relatedEvents: [substitute.substituteProduct],
      };

      await savePlan(updatedPlan);
      await regenerateContent(updatedPlan);

      await sendSubstituteNotification({
        to: process.env.OWNER_EMAIL!,
        original: plan,
        substitute,
        updatedPlan,
      });

      console.log(`🔄 差し替え完了：${substitute.substituteProduct}（${substitute.reason}）`);
    } else {
      // 代替商品なし → 配信をスキップ
      await markPlanAsSkipped(plan, '在庫なし・代替商品なし');
      await sendSkipAlert({
        to: process.env.OWNER_EMAIL!,
        plan,
        stockStatus: mainProduct,
      });

      console.log(`🚫 ${plan.date} の配信をスキップ：代替商品なし`);
    }
  }
}
```

### 4. 在庫回復時の自動復帰

スキップした配信日から3日以上先があれば、在庫が復帰したときに自動でプランを戻す。

```typescript
async function checkSkippedPlansForRecovery(): Promise<void> {
  const skippedPlans = await getSkippedPlans();
  const stockList = await getStockList();

  for (const plan of skippedPlans) {
    const deliveryDate = new Date(plan.date);
    const today = new Date();
    const daysUntil = Math.ceil(
      (deliveryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysUntil < 3) continue; // 直近3日はスキップのまま

    const relatedProduct = stockList.find((s) =>
      plan.relatedEvents.some((e) => e.includes(s.category))
    );

    if (relatedProduct?.isAvailable) {
      await restorePlan(plan);
      await regenerateContent(plan);
      console.log(`♻️ 在庫回復：${plan.date} の配信を復活（${relatedProduct.productName}：${relatedProduct.stock}個）`);
    }
  }
}
```

### 5. Vercel Cron で定期実行

```typescript
// vercel.json に追記
{
  "crons": [
    { "path": "/api/cron/monthly-plan",   "schedule": "0 9 1 * *" },
    { "path": "/api/cron/daily-content",  "schedule": "0 9 * * *" },
    { "path": "/api/cron/stock-check",    "schedule": "*/5 * * * *" }
  ]
}

// /api/cron/stock-check.ts
export async function GET(): Promise<Response> {
  await checkAndUpdateDeliveryPlans();
  await checkSkippedPlansForRecovery();
  return new Response('ok');
}
```

## 実際に起きたシナリオと動作

**8月15日（配信5日前の定期チェック）**

```
⚠️ 2026-08-20 カツオ漁期ラストスパート：在庫不足（3個、しきい値5個）
Claude提案：ホタテ（在庫87個、優先度高）に差し替え
理由：「お盆明けの食卓にホタテバター焼きも夏の定番として訴求できる」
🔄 差し替え完了：新テーマ「お盆明けはホタテで締める」
```

**8月16日（業者さんへの確認メール）**

```
件名：【自動変更】8/20 配信テーマを変更しました

カツオの在庫が残り3個（しきい値5個）のため、
ホタテに変更して配信コンテンツを再生成しました。

■ 変更前：カツオ漁期ラストスパート
■ 変更後：お盆明けはホタテで締める

コンテンツ確認・承認はこちら → [確認ボタン]
変更を戻す場合はこちら → [元に戻すボタン]
```

業者さんから「これ助かる。カツオが切れた翌日に配信が止まらずに済んだ」と言ってもらえた。

## コストと効果

**APIコスト（月間試算）**

| 処理 | 回数/月 | コスト |
|-----|---------|------|
| 月次プラン生成 | 1回 | 約5円 |
| 日次コンテンツ生成 | 5回 | 約20円 |
| 在庫チェック（代替提案） | 平均2回 | 約4円 |
| **合計** | | **約29円** |

**効果**

| 指標 | Before | After |
|-----|--------|-------|
| 在庫切れ商品の誤配信 | 月2〜3回 | 0回（2ヶ月連続） |
| 業者さんの配信確認時間 | 月3〜4時間 | 30分（差し替えアラート確認のみ） |
| 配信キャンセル率 | 月1〜2回 | 月0〜1回（代替配信に置き換わるため） |

## つまずきポイントと対策

**Notionの在庫更新タイムラグ問題**

業者さんが在庫を更新するタイミングにばらつきがあった（朝更新したり夜更新したり）。5分ポーリングで対応できてはいるが、「しきい値を少し高めに設定する」ことで安全マージンを確保。

**カテゴリのマッチング精度**

「本カツオ」「カツオのたたき」「カツオ角煮」がそれぞれ別商品として登録されていて、「カツオ漁期」に関連する商品を特定するのが難しかった。解決策としてNotion DBに「配信タグ」フィールドを追加して、`#カツオ` のようなタグを商品に付与。

```typescript
// 改善後のマッチング
const mainProduct = stockList.find((s) =>
  s.deliveryTags.some((tag) =>
    plan.relatedEvents.some((e) => e.includes(tag))
  )
);
```

**代替商品の選択をClaudeに任せすぎない**

初期は完全にClaudeに任せていたが、「秋サケをカツオの代替に提案してきた」ケースがあった（季節は合うが食シーンが違う）。プロンプトに「同じ食べ方（刺身、焼き、煮付けなど）の商品を優先する」と追加して改善。

## まとめ

配信を自動化したら次は在庫との連携が課題になった。よくある話だが、Notionとの組み合わせで意外と素直に解決できた。

肝はClaudeに「在庫状況＋利用可能な代替商品リスト」を渡して差し替え案を出させる部分。商品知識をプロンプトに込めれば、人間がやっていた「カツオがないならホタテで行こう」の判断をある程度自動化できる。

次は在庫の減りスピードを過去データから予測して、配信計画の段階から「8月末には在庫切れしそうだから早めに訴求する」という先読み戦略ができないか試す予定。

コード・相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
