---
title: "Claude API × Googleカレンダーで水産ECの配信スケジュールを全自動化した話【LINE・メルマガを一元管理】"
description: "毎月の配信計画を立てるのに2〜3時間かかっていた。Googleカレンダーに漁期・旬カレンダーを登録しておくと、Claude APIが自動でLINEメッセージとメルマガを生成・スケジュール配信する仕組みを構築した。"
pubDate: 2026-08-10
author: sam
category: "Claude活用"
tags: ["Claude", "Googleカレンダー", "LINE", "メルマガ", "自動化", "スケジュール", "水産業", "EC"]
readingTime: 10
---

## 「今月何を配信するか」を決めるのが一番しんどい

[LINEメッセージの自動生成](/blog/claude-line-official-message)を実装したとき、業者さんからこんな声があった。

「文章を考えるのは楽になったんだけど、そもそも何を、いつ配信するか決めるのが大変で…毎月頭に2〜3時間かかってる」

確かに。魚の旬・入荷タイミング・催事（お盆・正月・年末年始）・EC独自のセール日。これを組み合わせて「この週はメルマガ、翌週はLINE」と組むのは、海産物の知識がないとできない作業だ。

でも裏を返せば、**旬カレンダーと催事情報さえあれば、配信計画は自動で組める**。

Claude APIとGoogleカレンダーをつなげて、配信プランの立案から文章生成・スケジュール設定まで全自動にした。

## 作ったもの

Googleカレンダーに登録した「漁期・旬・催事」イベントを読み込んで：

1. **月次配信プランを自動生成**（Claude APIで最適なタイミングと内容を提案）
2. **LINEメッセージとメルマガ本文を事前生成**（各配信5〜7日前）
3. **確認フローを経て自動送信**（メールで人間確認 → OKならそのまま配信）

月1回、カレンダーを更新するだけで1ヶ月分が回る。

## システム全体像

```
Googleカレンダー（旬・催事）
        ↓ 月初に取得
  Claude API（配信プラン生成）
        ↓
  月次プランJSON（いつ・何を・どのチャネルで）
        ↓ 各配信5日前にCron起動
  Claude API（コンテンツ生成）
        ↓
  メール確認（業者さんへ）
        ↓ OK返信
  LINE Messaging API / メール配信
```

## Googleカレンダーの設計

専用カレンダー「水産EC配信管理」を作り、以下の2種類のイベントを登録。

**旬・漁期イベント（期間イベント）**

| タイトル | 期間 | 説明 |
|---------|------|------|
| 本カツオ漁期 | 7月〜9月 | 気仙沼港水揚げ、藁焼きたたき主力 |
| 秋サケ漁期 | 9月〜11月 | 定置網漁、甘塩・燻製が人気 |
| 牡蠣シーズン | 11月〜3月 | 宮城産殻付き・剥き身 |
| ホタテ最盛期 | 4月〜6月 | 三陸産、刺身・バター焼き |

**催事・セールイベント（単日〜数日）**

| タイトル | 日付 |
|---------|------|
| お盆前ピーク配送締切 | 8/11 |
| 敬老の日ギフト推奨日 | 9/8 |
| 年末ギフト解禁 | 11/1 |

## 実装コード

### 1. Googleカレンダーから今月のイベントを取得

```typescript
import { google } from 'googleapis';

const calendar = google.calendar({ version: 'v3' });

interface CalendarEvent {
  title: string;
  start: string;
  end: string;
  description?: string;
  type: '旬・漁期' | '催事';
}

async function getMonthlyEvents(year: number, month: number): Promise<CalendarEvent[]> {
  const auth = new google.auth.GoogleAuth({
    keyFile: 'service-account.json',
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  });

  const timeMin = new Date(year, month - 1, 1).toISOString();
  const timeMax = new Date(year, month, 0, 23, 59, 59).toISOString();

  const response = await calendar.events.list({
    auth,
    calendarId: process.env.GOOGLE_CALENDAR_ID!,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
  });

  return (response.data.items ?? []).map((e) => ({
    title: e.summary ?? '',
    start: e.start?.date ?? e.start?.dateTime ?? '',
    end: e.end?.date ?? e.end?.dateTime ?? '',
    description: e.description ?? undefined,
    type: (e.colorId === '11') ? '旬・漁期' : '催事',
  }));
}
```

### 2. Claudeで月次配信プランを生成

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface DeliveryPlan {
  date: string;           // 例: "2026-08-12"
  channel: 'LINE' | 'メルマガ' | '両方';
  theme: string;          // 例: "お盆前カツオ最終入荷"
  keyMessage: string;     // 例: "今シーズン最後の本カツオ。お盆の食卓に"
  relatedEvents: string[];
  urgency: 'high' | 'medium' | 'low';
}

interface MonthlyPlan {
  month: string;
  plans: DeliveryPlan[];
  summary: string;
}

async function generateMonthlyPlan(
  events: CalendarEvent[],
  year: number,
  month: number
): Promise<MonthlyPlan> {
  const eventsText = events
    .map((e) => `【${e.type}】${e.title}（${e.start}〜${e.end}）${e.description ? '：' + e.description : ''}`)
    .join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: `あなたは宮城県気仙沼の水産加工品ECの配信マネージャーです。
今月のGoogleカレンダーイベントを元に、最適な配信スケジュールを計画してください。

【今月のカレンダーイベント】
${eventsText}

【配信チャネル】
- LINE公式アカウント：短文・絵文字・即効性。購買欲の高い人向け。頻度は週1まで
- メルマガ（メール）：長文OK・読み込み型。ファン育成・リピーター向け。月2〜3回

【配信計画のルール】
- 旬・漁期の開始・終盤・ピーク前に必ず1回は配信する
- 催事の5〜7日前が最も効果的
- LINE後48時間以内にメルマガを出さない（疲れを防ぐ）
- 月の配信総数は4〜6回（多すぎると解除される）

【出力（JSONのみ）】
{
  "month": "${year}年${month}月",
  "plans": [
    {
      "date": "YYYY-MM-DD",
      "channel": "LINE" | "メルマガ" | "両方",
      "theme": "配信テーマ（20字以内）",
      "keyMessage": "伝えるべき核心メッセージ（40字以内）",
      "relatedEvents": ["関連するカレンダーイベント名"],
      "urgency": "high" | "medium" | "low"
    }
  ],
  "summary": "今月の配信戦略の解説（200字以内）"
}`,
      },
    ],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('月次プランのJSON解析失敗');
  return JSON.parse(jsonMatch[0]) as MonthlyPlan;
}
```

### 3. プランを元にコンテンツを事前生成（Cron起動）

配信5日前に起動して、コンテンツを生成→業者さんにメール確認を送る。

```typescript
async function prepareContent(plan: DeliveryPlan): Promise<void> {
  // 配信5日前になったプランを処理
  const today = new Date().toISOString().split('T')[0];
  const deliveryDate = new Date(plan.date);
  const daysUntil = Math.ceil(
    (deliveryDate.getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysUntil !== 5) return;

  let content: Record<string, string> = {};

  if (plan.channel === 'LINE' || plan.channel === '両方') {
    const lineMessages = await generateLineMessages(plan);
    content.line = JSON.stringify(lineMessages, null, 2);
  }

  if (plan.channel === 'メルマガ' || plan.channel === '両方') {
    const newsletter = await generateNewsletter(plan);
    content.newsletter = newsletter;
  }

  // 業者さんへ確認メール送信
  await sendConfirmationEmail({
    to: process.env.OWNER_EMAIL!,
    subject: `【確認】${plan.date} 配信コンテンツ（${plan.channel}）`,
    plan,
    content,
    approveToken: generateApproveToken(plan.date),
  });
}

// メール内のリンクをクリックすると実際に配信される
async function handleApproval(token: string): Promise<void> {
  const plan = decodeApproveToken(token);
  const content = await loadPreparedContent(plan.date);

  if (plan.channel === 'LINE' || plan.channel === '両方') {
    await broadcastLineMessages(content.line);
  }
  if (plan.channel === 'メルマガ' || plan.channel === '両方') {
    await sendNewsletter(content.newsletter);
  }

  console.log(`配信完了: ${plan.date} ${plan.channel}`);
}
```

### 4. 月初の自動実行（Cron設定）

```typescript
// cron.ts - Vercel Cron / GitHub Actions で定期実行
export async function monthlyPlanCron(): Promise<void> {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 2; // 翌月分を1ヶ月前に作成

  const events = await getMonthlyEvents(year, month);
  const plan = await generateMonthlyPlan(events, year, month);

  // プランをDBに保存（Notion DBでも可）
  await savePlan(plan);

  console.log(`${year}年${month}月の配信プラン生成完了：${plan.plans.length}件`);
}

export async function dailyContentCron(): Promise<void> {
  const plans = await getTodayMinus5DayPlans();
  await Promise.all(plans.map(prepareContent));
}
```

## 実際に生成された8月の配信プラン

```json
{
  "month": "2026年8月",
  "plans": [
    {
      "date": "2026-08-10",
      "channel": "LINE",
      "theme": "カツオ漁期ラストスパート",
      "keyMessage": "今年の本カツオ漁はあと1ヶ月。食べ納めのチャンスを逃さない",
      "relatedEvents": ["本カツオ漁期"],
      "urgency": "high"
    },
    {
      "date": "2026-08-14",
      "channel": "メルマガ",
      "theme": "お盆明けの冷蔵庫補充提案",
      "keyMessage": "帰省手土産で在庫が減った後こそ、旬の食材を取り寄せるタイミング",
      "relatedEvents": ["お盆前ピーク配送締切", "本カツオ漁期"],
      "urgency": "medium"
    },
    {
      "date": "2026-08-25",
      "channel": "LINE",
      "theme": "秋サケ漁期プレ告知",
      "keyMessage": "9月から宮城の秋サケが始まる。先行登録で入荷連絡を受け取れます",
      "relatedEvents": ["秋サケ漁期"],
      "urgency": "low"
    }
  ],
  "summary": "8月はカツオ漁期の終盤とお盆が重なる高需要期。お盆前（8/10）のLINEで今期最後の訴求をかけ、お盆明け（8/14）のメルマガでリピーター向けに静かにフォロー。月末は秋サケのティーザーで次の購買サイクルへの橋渡しをする。"
}
```

Claudeが旬のスケジュールを理解して、メルマガとLINEを疲れないペースで組んでくれる。

## 結果（2ヶ月運用後）

| 指標 | Before（手動） | After（自動） |
|------|--------------|-------------|
| 月次配信計画の作成時間 | 2〜3時間 | 10分（確認のみ） |
| 配信のタイミングの精度 | 感覚ベース | 旬データ連動 |
| LINEの開封率 | 41% | 57%（適切なタイミング効果） |
| メルマガのクリック率 | 4.1% | 6.8% |
| 配信を「忘れた」回数 | 月1〜2回 | 0回 |

「タイミングを考えなくていい、は本当に楽」と業者さん。

## コスト

| 項目 | 月額 |
|------|------|
| Claude API（月次プラン生成 × 1回） | 約5円 |
| Claude API（コンテンツ生成 × 5回） | 約20円 |
| Google Calendar API | 無料（無料枠内） |
| Vercel Cron | 無料（趣味プランで十分） |
| **合計** | **約25円** |

## まとめ

「いつ・何を・どのチャネルで」という配信計画の頭仕事は、旬カレンダーがあればClaudeに委ねられる。

水産業は旬が命なので、カレンダーに漁期を登録しておくだけで自然と最適なタイミングに乗ったコンテンツが出てくる。人間がやることは、毎月カレンダーを確認・更新することと、送信前の最終確認だけ。

「売り逃しが減った気がする」と言ってもらえた。旬の食材を旬のタイミングで告知できるようになったのが一番の効果だと思う。

次は Notion DB に在庫情報を連携して、在庫が少なくなったら自動で配信を止める「在庫連動配信制御」を試す予定。

コードの利用・相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）へどうぞ。
