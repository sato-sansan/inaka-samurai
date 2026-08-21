---
title: "Claude API × Notion DBで在庫の減りスピードを予測して配信タイミングを先読みした話【水産EC】"
description: "在庫切れになってから対処するのではなく、「あと何日で在庫が尽きるか」をClaude APIで予測して配信計画を前倒しする仕組みを作った。Notion DBの在庫履歴データを渡すだけで、先読み型のキャンペーン提案が自動化できた。"
pubDate: 2026-08-21
author: sam
category: "Claude活用"
tags: ["Claude", "Notion", "在庫管理", "需要予測", "EC自動化", "水産業", "LINE", "メルマガ"]
readingTime: 10
---

## 「在庫切れ直前に気づく」では遅い

[在庫連動配信制御](/blog/claude-inventory-delivery-control)を入れてから「在庫ゼロで配信してしまう」問題はなくなった。

でも新しい問題が出てきた。

「ホタテが在庫5個になったアラートが来たんだけど、5日後の配信を変えてもお客さんへの告知が間に合わない…もっと前から動けたら」

確かに。在庫が**なくなってから対処**するのが後手だ。**「あと何日で在庫が尽きるか」が事前にわかれば**、配信を前倒しして「在庫があるうちに買ってもらう」動きができる。

Notion DBに蓄積してきた在庫履歴をClaude APIに渡して、商品ごとの消費ペースを予測し、配信プランを自動調整する仕組みを作った。

## 作ったもの

Notion DBの在庫履歴（毎日記録している在庫数の推移）を読み込んで：

1. **商品ごとの日次消費量を分析**（直近14日の平均・トレンド）
2. **在庫枯渇予測日を算出**（Claudeが「この商品はあと11日で切れる」と判定）
3. **配信プランを自動提案**（枯渇の7〜10日前に「ラストチャンス訴求」をスケジュール）
4. **業者さんへサマリーメールを週1回送信**（翌週の在庫危険リストと提案アクション）

## Notion DB の設計

在庫管理DBに加えて「在庫履歴DB」を新設。毎日夜11時にCronで在庫スナップショットを保存する。

**在庫管理DB（既存）**

| フィールド | 種類 | 備考 |
|-----------|-----|------|
| 商品名 | タイトル | |
| カテゴリ | セレクト | |
| 在庫数 | 数値 | 常時更新 |
| 配信優先度 | セレクト | 高・中・低 |
| 配信停止しきい値 | 数値 | |

**在庫履歴DB（新設）**

| フィールド | 種類 | 備考 |
|-----------|-----|------|
| 記録日 | 日付 | スナップショット日 |
| 商品（リレーション） | リレーション | 在庫管理DBと連携 |
| 在庫数 | 数値 | その日の在庫数 |
| 売上数 | 数値 | 前日比の減少数（自動計算） |
| メモ | テキスト | イベント・催事の影響など |

## 実装コード

### 1. 在庫履歴のスナップショットを毎日保存

```typescript
import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function saveStockSnapshot(): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const stockList = await getStockList(); // 既存の在庫取得関数

  for (const item of stockList) {
    // 前日のスナップショットを取得して売上数を計算
    const yesterday = await getLatestSnapshot(item.productId);
    const salesCount = yesterday ? Math.max(0, yesterday.stock - item.stock) : 0;

    await notion.pages.create({
      parent: { database_id: process.env.NOTION_HISTORY_DB_ID! },
      properties: {
        '記録日': { date: { start: today } },
        '商品': { relation: [{ id: item.pageId }] },
        '在庫数': { number: item.stock },
        '売上数': { number: salesCount },
      },
    });
  }
}

async function getLatestSnapshot(productId: string): Promise<{ stock: number } | null> {
  const response = await notion.databases.query({
    database_id: process.env.NOTION_HISTORY_DB_ID!,
    filter: {
      property: '商品',
      relation: { contains: productId },
    },
    sorts: [{ property: '記録日', direction: 'descending' }],
    page_size: 1,
  });

  if (response.results.length === 0) return null;
  const page = response.results[0] as any;
  return { stock: page.properties['在庫数']?.number ?? 0 };
}
```

### 2. 直近14日の在庫履歴を取得

```typescript
interface StockHistory {
  date: string;
  stock: number;
  salesCount: number;
}

async function getStockHistory(productId: string, days: number = 14): Promise<StockHistory[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const response = await notion.databases.query({
    database_id: process.env.NOTION_HISTORY_DB_ID!,
    filter: {
      and: [
        { property: '商品', relation: { contains: productId } },
        { property: '記録日', date: { on_or_after: since.toISOString().split('T')[0] } },
      ],
    },
    sorts: [{ property: '記録日', direction: 'ascending' }],
  });

  return response.results
    .filter((p) => p.object === 'page')
    .map((p: any) => ({
      date: p.properties['記録日']?.date?.start ?? '',
      stock: p.properties['在庫数']?.number ?? 0,
      salesCount: p.properties['売上数']?.number ?? 0,
    }));
}
```

### 3. Claude APIで在庫枯渇を予測

在庫履歴と現在の在庫数をClaudeに渡して、「何日後に在庫が尽きるか」と「配信タイミングの提案」を返してもらう。

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface StockForecast {
  productName: string;
  currentStock: number;
  avgDailySales: number;
  trend: '増加中' | '横ばい' | '減少中' | 'データ不足';
  estimatedDepletionDate: string | null; // "YYYY-MM-DD" or null（枯渇しない場合）
  daysUntilDepletion: number | null;
  riskLevel: 'high' | 'medium' | 'low' | 'none';
  campaignRecommendation: string | null; // 推奨配信アクション
  campaignTiming: string | null;         // 推奨配信日
  reason: string;
}

async function forecastStockDepletion(
  item: StockItem,
  history: StockHistory[]
): Promise<StockForecast> {
  const historyText = history
    .map((h) => `${h.date}: 在庫${h.stock}個（当日売上${h.salesCount}個）`)
    .join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `水産ECの在庫管理担当です。商品の在庫履歴を分析して枯渇予測をしてください。

【商品情報】
商品名: ${item.productName}
カテゴリ: ${item.category}
現在の在庫数: ${item.stock}個
配信停止しきい値: ${item.stopThreshold}個
配信優先度: ${item.deliveryPriority}

【直近14日の在庫履歴】
${historyText || '（履歴なし）'}

【分析・予測のポイント】
- 日次売上数から直近7日と14日の平均を計算する
- 直近7日の平均が14日平均より高ければ「増加中」、低ければ「減少中」
- 週末（土日）は売上が1.3〜1.5倍になる傾向があるため、週次パターンも考慮する
- 「在庫数 ÷ 日次平均売上数」で単純枯渇日を算出し、週末パターンを加味して補正する
- しきい値（${item.stopThreshold}個）を下回ると配信が自動停止されるため、しきい値到達日を枯渇日とする
- 「在庫切れ7〜10日前」にキャンペーン配信を打てるとラストチャンス訴求として最も効果的

【出力（JSONのみ）】
{
  "productName": "${item.productName}",
  "currentStock": ${item.stock},
  "avgDailySales": <直近7日の平均日次売上数>,
  "trend": "増加中" | "横ばい" | "減少中" | "データ不足",
  "estimatedDepletionDate": "YYYY-MM-DD" または null,
  "daysUntilDepletion": <日数> または null,
  "riskLevel": "high"（14日以内）| "medium"（15〜30日）| "low"（31日以上）| "none"（枯渇しない）,
  "campaignRecommendation": "配信アクションの提案文（50字以内）" または null,
  "campaignTiming": "YYYY-MM-DD" または null,
  "reason": "分析の根拠（100字以内）"
}`,
      },
    ],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`JSON解析失敗: ${item.productName}`);
  return JSON.parse(jsonMatch[0]) as StockForecast;
}
```

### 4. 全商品を一括予測して配信プランに反映

```typescript
interface WeeklyForecastReport {
  generatedAt: string;
  highRiskItems: StockForecast[];
  mediumRiskItems: StockForecast[];
  newCampaignSuggestions: Array<{
    productName: string;
    suggestedDate: string;
    action: string;
  }>;
  summary: string;
}

async function generateWeeklyForecast(): Promise<WeeklyForecastReport> {
  const stockList = await getStockList();
  const today = new Date().toISOString().split('T')[0];

  const forecasts = await Promise.all(
    stockList.map(async (item) => {
      const history = await getStockHistory(item.pageId);
      return forecastStockDepletion(item, history);
    })
  );

  const highRiskItems = forecasts.filter((f) => f.riskLevel === 'high');
  const mediumRiskItems = forecasts.filter((f) => f.riskLevel === 'medium');

  // 配信プランに存在しないキャンペーンを提案
  const existingPlans = await getUpcomingPlans(30);
  const newSuggestions = forecasts
    .filter((f) => f.campaignTiming && f.campaignRecommendation)
    .filter((f) => {
      // 既に同商品の配信が近い日程に入っていなければ提案
      return !existingPlans.some(
        (p) =>
          p.relatedEvents.some((e) => e.includes(f.productName)) &&
          Math.abs(new Date(p.date).getTime() - new Date(f.campaignTiming!).getTime()) <
            7 * 24 * 60 * 60 * 1000
      );
    })
    .map((f) => ({
      productName: f.productName,
      suggestedDate: f.campaignTiming!,
      action: f.campaignRecommendation!,
    }));

  // サマリーをClaudeに生成してもらう
  const summaryMsg = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 400,
    messages: [
      {
        role: 'user',
        content: `水産ECの今週の在庫リスクサマリーを150字以内で作成してください。

危険商品（14日以内に枯渇）: ${highRiskItems.map((f) => `${f.productName}（${f.daysUntilDepletion}日後）`).join('、') || 'なし'}
要注意商品（15〜30日）: ${mediumRiskItems.map((f) => `${f.productName}（${f.daysUntilDepletion}日後）`).join('、') || 'なし'}
新規キャンペーン提案数: ${newSuggestions.length}件

業者さんへの週次報告メール用サマリーとして、端的に現状と推奨アクションを伝えてください。`,
      },
    ],
  });

  const summary =
    summaryMsg.content[0].type === 'text' ? summaryMsg.content[0].text.trim() : '';

  return {
    generatedAt: today,
    highRiskItems,
    mediumRiskItems,
    newCampaignSuggestions: newSuggestions,
    summary,
  };
}
```

### 5. 提案された配信プランを在庫管理DBへ自動追加

```typescript
async function applyForecastToDeliveryPlan(forecast: WeeklyForecastReport): Promise<void> {
  for (const suggestion of forecast.newCampaignSuggestions) {
    const matchingForecast = forecast.highRiskItems
      .concat(forecast.mediumRiskItems)
      .find((f) => f.productName === suggestion.productName);

    if (!matchingForecast) continue;

    const newPlan: DeliveryPlan = {
      date: suggestion.suggestedDate,
      channel: 'LINE', // ラストチャンス訴求はLINEが即効性高
      theme: `${matchingForecast.productName}ラストチャンス`,
      keyMessage: suggestion.action,
      relatedEvents: [matchingForecast.productName],
      urgency: matchingForecast.riskLevel === 'high' ? 'high' : 'medium',
    };

    await savePlan(newPlan);

    console.log(
      `📅 配信プラン追加: ${suggestion.suggestedDate} - ${matchingForecast.productName}（${matchingForecast.daysUntilDepletion}日後に枯渇予測）`
    );
  }
}
```

### 6. 週次Cronと週次レポートメール

```typescript
// vercel.json に追記
// { "path": "/api/cron/weekly-forecast", "schedule": "0 8 * * 1" }  // 毎週月曜8時

export async function GET(): Promise<Response> {
  const report = await generateWeeklyForecast();
  await applyForecastToDeliveryPlan(report);
  await sendWeeklyForecastEmail(report);
  return new Response('ok');
}

async function sendWeeklyForecastEmail(report: WeeklyForecastReport): Promise<void> {
  const highRiskSection =
    report.highRiskItems.length > 0
      ? report.highRiskItems
          .map(
            (f) =>
              `⚠️ ${f.productName}：あと${f.daysUntilDepletion}日（${f.estimatedDepletionDate}に枯渇予測）\n   → ${f.campaignRecommendation}`
          )
          .join('\n')
      : '（なし）';

  const newCampaignSection =
    report.newCampaignSuggestions.length > 0
      ? report.newCampaignSuggestions
          .map((s) => `📣 ${s.suggestedDate}：${s.productName} - ${s.action}`)
          .join('\n')
      : '（新規提案なし）';

  await sendEmail({
    to: process.env.OWNER_EMAIL!,
    subject: `【週次在庫予測】${report.generatedAt} 週のリスクサマリー`,
    body: `${report.summary}

━━━━━━━━━━━━━━━━━━
■ 危険商品（14日以内に枯渇予測）
${highRiskSection}

■ 自動追加された配信プラン
${newCampaignSection}

配信プランの確認・編集はこちら → [管理画面リンク]
━━━━━━━━━━━━━━━━━━`,
  });
}
```

## 実際に生成されたレポート（8月第3週）

```
【週次在庫予測】2026-08-18 週のリスクサマリー

ホタテ（宮城産剥き身）があと9日で配信停止しきい値に到達します。
カツオたたきは在庫減少トレンドが続いており15日後に枯渇見込み。
新規キャンペーン2件を自動追加しました。確認・承認をお願いします。

━━━━━━━━━━━━━━━━━━
■ 危険商品（14日以内に枯渇予測）
⚠️ ホタテ（宮城産剥き身）：あと9日（2026-08-27に枯渇予測）
   → 「今シーズンのホタテ残りわずか」でLINE配信を前倒し

■ 自動追加された配信プラン
📣 2026-08-21：ホタテ（宮城産剥き身） - 今シーズンのホタテ残りわずか。お盆明けの贈り物に
📣 2026-08-29：カツオたたき - 今年の本カツオ最終入荷。食べ納めのチャンス
━━━━━━━━━━━━━━━━━━
```

ホタテの在庫が急に減っていたのは「お盆ギフトの注文が集中した」から。Claudeはトレンドを「増加中」と検出して正しく危険判定を出した。

## 結果（3週間運用後）

| 指標 | Before（後手対応） | After（先読み対応） |
|------|-------------------|-------------------|
| 在庫切れ後の配信トラブル | 月2〜3回 | 0回 |
| ラストチャンス配信の実施率 | 30%（気づいた時だけ） | 85%（自動提案経由） |
| ラストチャンス配信のCVR | — | +22%（通常配信比） |
| 業者さんの在庫確認にかかる時間 | 週3〜4時間 | 週30分（週次レポート確認のみ） |

「在庫があるうちに告知できる」という当たり前のことが、ようやくシステムとして回るようになった。

## コスト

| 処理 | 頻度 | 月コスト |
|-----|------|---------|
| 在庫スナップショット保存（Notion API） | 毎日 | 無料 |
| 在庫枯渇予測（Claude API） | 週1回・全商品分 | 約15円 |
| 週次サマリー生成（Claude API） | 週1回 | 約3円 |
| 配信コンテンツ生成（既存） | 月5回 | 約20円 |
| **合計** | | **約38円** |

## つまずきポイント

**週末効果の補正が難しかった**

単純な「在庫 ÷ 日次平均」だと週末の売上増を無視して枯渇日が遅めに出る。Claudeのプロンプトに「週末（土日）は1.3〜1.5倍になる傾向」を明示したことで精度が上がった。

**催事イベント中の急増を平均が吸収しにくい**

お盆期間の急増が14日平均に薄まって危険度を低く見積もるケースがあった。Notion履歴DBのメモフィールドに「お盆特需」などのラベルを入れて、イベント期間を除いた平均を使うよう改善中。

**「枯渇しない商品」の判定**

在庫補充が頻繁な商品（牡蠣など、漁期序盤）はトレンドが「増加中」になり枯渇予測が出ない。これは正しい判定だが、補充のない季節末期は急に危険になるため、補充履歴も追加で管理する予定。

## まとめ

「なくなってから気づく」を「なくなる前に動く」に変えるのが今回のテーマだった。

Notionに毎日スナップショットを保存しておくことで、14日分の在庫推移データができあがる。それをClaudeに渡すだけで「あと何日・どのタイミングで告知するべきか」まで提案してくれる。

水産業は在庫が旬・天候・漁の状況に左右されるので、固定のしきい値管理だけでは追いつかない。消費ペースのトレンドを見て動的に配信を組み替える仕組みが、長期的にはより安定する。

次は「過去の配信と在庫減少の相関を分析して、どの配信がいちばん在庫を動かしたか」を定量化するフィードバックループを試す予定。

コード・相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
