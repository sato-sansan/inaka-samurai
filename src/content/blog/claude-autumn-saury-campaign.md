---
title: "Claude APIで秋刀魚シーズンのキャンペーンメールを自動生成した話【三陸水産EC】"
description: "「今年のサンマはいつ告知すればいい？」という問いに、漁期・在庫・過去購買データを渡したらClaude APIが最適な配信タイミングとメール文面を一発で提案してくれた話。"
pubDate: 2026-08-25
author: sam
category: "Claude活用"
tags: ["Claude", "EC自動化", "メールマーケティング", "秋刀魚", "水産業", "季節キャンペーン", "Shopify"]
readingTime: 8
---

## 「サンマのシーズン、今年はいつ動けばいい？」

[在庫予測の仕組み](/blog/claude-stock-forecast-campaign)を入れてから、業者さんが次の悩みを持ってきた。

「ホタテやカツオは通年であるから予測しやすい。でもサンマって漁期が短くて、去年は9月頭に入荷したのに一昨年は9月末だった。告知タイミングを間違えると、お客さんに届いたとき"もう終わりました"になる」

確かに。季節もの特有の問題だ。

**漁の時期が毎年ぶれる → 告知が早すぎると「まだない」、遅すぎると「もう完売」**

過去の購買データと入荷実績を渡したら、Claude APIが「今年はいつ告知すべきか」と「その文面」を同時に出してくれた。

## 作ったもの

入力：
- 過去3年の入荷日・完売日（CSVで管理していたもの）
- 今年の漁業情報（三陸の水産ニュースから手動で貼り付け）
- 昨年の購買者リスト（Shopifyからエクスポート）

出力：
- 告知メールの最適配信日（第1報・第2報・残量アラートの3段階）
- 各メールの文面（件名・本文・CTA）
- リピーター向けと新規向けの2パターン

## 実装コード

### 1. 過去データを読み込んで傾向分析

```typescript
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import { parse } from 'csv-parse/sync';

const client = new Anthropic();

interface SeasonalRecord {
  year: number;
  arrivalDate: string;    // 初回入荷日
  soldOutDate: string;    // 完売日
  totalKg: number;        // 総取扱量（kg）
  peakSalesDay: string;   // 最多販売日
}

function loadSeasonalHistory(csvPath: string): SeasonalRecord[] {
  const raw = fs.readFileSync(csvPath, 'utf-8');
  return parse(raw, { columns: true, cast: true }) as SeasonalRecord[];
}

async function analyzeBestTimingAndDraft(
  history: SeasonalRecord[],
  currentSeasonInfo: string,
  buyerCount: number
): Promise<{
  timing: {
    firstNotice: string;
    secondNotice: string;
    lastCallNotice: string;
    reasoning: string;
  };
  emails: {
    firstNotice: { subject: string; body: string };
    secondNotice: { subject: string; body: string };
    lastCall: { subject: string; body: string };
  };
}> {
  const historyText = history
    .map(
      (r) =>
        `${r.year}年: 入荷${r.arrivalDate}／完売${r.soldOutDate}／` +
        `総量${r.totalKg}kg／最多販売日${r.peakSalesDay}`
    )
    .join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 3000,
    messages: [
      {
        role: 'user',
        content: `あなたは水産ECのマーケティングコンサルタントです。
三陸・気仙沼産の秋刀魚キャンペーンの配信計画を立てて、メール文面まで作成してください。

【過去の入荷・完売実績】
${historyText}

【今シーズンの漁業情報（ニュース等からの情報）】
${currentSeasonInfo}

【購買者数】
昨年購入者：${buyerCount}名

【依頼内容】
以下をJSONで出力してください。

{
  "timing": {
    "firstNotice": "YYYY-MM-DD（第1報：入荷前予告）",
    "secondNotice": "YYYY-MM-DD（第2報：入荷確定報告）",
    "lastCallNotice": "YYYY-MM-DD（残量アラート）",
    "reasoning": "この配信タイミングを選んだ根拠（過去データへの言及を含む）"
  },
  "emails": {
    "firstNotice": {
      "subject": "（件名）",
      "body": "（本文。入荷前の期待感を高める内容。300〜400文字）"
    },
    "secondNotice": {
      "subject": "（件名）",
      "body": "（本文。入荷確定・数量限定・購入促進。300〜400文字）"
    },
    "lastCall": {
      "subject": "（件名）",
      "body": "（本文。残量少・今シーズン最後のチャンス。200〜300文字）"
    }
  }
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON パース失敗');

  return JSON.parse(jsonMatch[0]);
}
```

### 2. リピーター向け・新規向けのパーソナライズ

```typescript
async function generatePersonalizedVersion(
  baseEmail: { subject: string; body: string },
  isRepeat: boolean
): Promise<{ subject: string; body: string }> {
  const persona = isRepeat
    ? '昨年も購入してくれたリピーター。去年の味を知っている。'
    : '今年初めてサンマを検討している新規顧客。鮮度や産地への不安がある。';

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 800,
    messages: [
      {
        role: 'user',
        content: `以下のメールを、対象顧客に合わせてリライトしてください。

【対象顧客】
${persona}

【元のメール】
件名: ${baseEmail.subject}
本文:
${baseEmail.body}

【指示】
- 件名と本文をJSONで出力（{ "subject": "...", "body": "..." }）
- 文字数・トーンは元のメールに合わせる
- リピーターなら「昨年ご好評いただいた」「また今年も」などの表現を活用
- 新規なら産地・鮮度・送料・返金保証などの安心要素を1つ加える`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('パース失敗');

  return JSON.parse(jsonMatch[0]) as { subject: string; body: string };
}
```

### 3. 実行スクリプト

```typescript
async function main() {
  // 過去データ読み込み
  const history = loadSeasonalHistory('saury-history.csv');

  // 今年の漁業情報（手動で最新ニュースを貼る）
  const currentInfo = `
    2026年の三陸沖のサンマ漁は、8月下旬時点で試験操業が始まった。
    水温が例年より0.5度低く、群れの南下は例年より5〜7日遅い見込みと漁師からの情報あり。
    ただし群れの密度は高く、本格操業が始まれば去年より多い漁獲量が期待できる。
  `.trim();

  const buyerCount = 342; // Shopifyで確認した昨年購入者数

  console.log('📊 配信計画を分析中...');
  const result = await analyzeBestTimingAndDraft(history, currentInfo, buyerCount);

  console.log('\n📅 推奨配信タイミング');
  console.log(`第1報（予告）：${result.timing.firstNotice}`);
  console.log(`第2報（入荷確定）：${result.timing.secondNotice}`);
  console.log(`残量アラート：${result.timing.lastCallNotice}`);
  console.log(`\n根拠：${result.timing.reasoning}`);

  // リピーター・新規の2パターン生成
  console.log('\n✉️ リピーター向けメール（第1報）生成中...');
  const repeatFirst = await generatePersonalizedVersion(
    result.emails.firstNotice,
    true
  );
  console.log(`件名: ${repeatFirst.subject}`);
  console.log(`本文:\n${repeatFirst.body}`);

  console.log('\n✉️ 新規向けメール（第1報）生成中...');
  const newFirst = await generatePersonalizedVersion(
    result.emails.firstNotice,
    false
  );
  console.log(`件名: ${newFirst.subject}`);
  console.log(`本文:\n${newFirst.body}`);

  // ファイルに保存
  fs.writeFileSync(
    'saury-campaign-2026.json',
    JSON.stringify({ timing: result.timing, emails: { repeat: repeatFirst, new: newFirst } }, null, 2),
    'utf-8'
  );
  console.log('\n✅ saury-campaign-2026.json に保存しました');
}

main().catch(console.error);
```

### 4. 実際の出力例

```
📅 推奨配信タイミング
第1報（予告）：2026-09-08
第2報（入荷確定）：2026-09-14
残量アラート：2026-09-22

根拠：
過去3年の入荷実績は 9/3、9/9、8/31 と幅がある。今年は水温低めで
5〜7日遅れとの情報から、入荷予測は9/10前後と判断。第1報は入荷2日前の
9/8を推奨。昨年は入荷翌日に全体の43%が完売したため、第2報は入荷確定
翌日の9/14。過去実績で平均11日で完売していることから、残量アラートは
9/22に設定。
```

**リピーター向け第1報（生成例）:**

```
件名: 【秋刀魚2026】また今年も気仙沼からお届けします

昨年ご好評いただいたサンマ、今年も三陸・気仙沼から直送でお届けできる
見込みが立ちました。

今シーズンは水温の影響で漁期が例年より少し遅め。でも群れの密度が高く、
漁師さんからは「今年は脂のりが期待できる」とのこと。

入荷確定次第すぐにご案内します。昨年ご購入いただいた方は早めのご連絡
になりますので、ぜひ楽しみにしていてください。

▶ 昨年の秋刀魚レビューを見る: [リンク]
```

**新規向け第1報（生成例）:**

```
件名: 【初秋限定】三陸の秋刀魚、今年も獲れました

気仙沼の漁師さんが丁寧に漁獲した秋刀魚を、水揚げ翌日にお届けします。
スーパーで見かける冷凍ものとは別物の「生・鮮度そのまま」の味を
一度体験してみてください。

初めてのご購入でも安心な理由：
✔ 鮮度に自信があるから、万が一の場合は全額返金
✔ 送料込みで計算しやすい価格設定
✔ 漁師さんの名前と船名が記載された産地証明付き

入荷が確定したらすぐにご案内します。数量限定ですのでお早めに。
```

## コストと効果

**APIコスト（分析＋6通メール生成）**

| 処理 | トークン数（概算） | コスト |
|------|------------------|--------|
| タイミング分析＋3通生成 | 入力2,000＋出力2,500 | 約1.5円 |
| パーソナライズ×6バリエーション | 入力6,000＋出力3,000 | 約2.4円 |
| 合計 | | **約3.9円** |

**工数削減**

| 作業 | Before（手動） | After（Claude API） |
|------|--------------|-------------------|
| 配信日の検討（過去データ参照） | 30分 | 0分（自動） |
| メール文面3通×2パターン作成 | 約3時間 | 5分（確認のみ） |
| 担当者への説明資料作成 | 30分 | 0分（根拠も自動出力） |

**業者さんの一言：**
「去年は第1報が遅くて入荷当日になってしまった。今年は9/8に予告を送れたから、入荷確定のメールで30分以内に50件注文が入った」

## ポイントと注意点

**うまくいった点**
- 「なぜこのタイミングか」の根拠をClaude自身が説明するので、業者さんへの説明がそのまま使える
- リピーターと新規で文面を分けることで、両方の開封率が向上した
- 季節もの特有の「読みの不確実性」をプロンプトに盛り込むことで、根拠のある提案が出てきた

**注意点**
- 漁業情報は手動で最新情報を入力する必要がある（自動化するには水産庁や漁協のデータAPIが必要）
- 実際の入荷日は確定してから第2報を送ること（予測がずれる場合がある）
- 「完売御礼」メールも用意しておくとブランドイメージの維持になる

## まとめ

季節もの商品のキャンペーンは「タイミング」と「文面」の両方に時間がかかっていた。

過去の入荷実績とシーズン情報を渡すだけで「9/8に予告、9/14に確定報告」という具体的な計画が出てくる。しかも根拠付きなので、業者さんへの説明コストもゼロ。

水産業に限らず、苺・枝豆・新米など「漁期・収穫期に合わせたEC」をやっている生産者さんにも使える実装だと思う。

コード・カスタマイズ相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
