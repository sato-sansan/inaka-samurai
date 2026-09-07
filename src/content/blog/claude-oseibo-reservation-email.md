---
title: "Claude APIで水産ECのお歳暮先行予約メールを自動生成した話"
description: "お歳暮シーズン3ヶ月前から動き出す先行予約キャンペーン。顧客の購入履歴をもとに「去年これ買いましたね」系の個別化メールをClaude APIで自動生成した話。"
pubDate: 2026-09-07
author: sam
category: "Claude活用"
tags: ["Claude", "お歳暮", "メール", "パーソナライズ", "水産EC", "先行予約", "自動化"]
readingTime: 7
---

## 問題：お歳暮メールは毎年同じ文面になっていた

9月になると水産ECのクライアントから必ずこの相談が来る。

「お歳暮シーズンの案内メール、今年もそろそろ送らないといけないんですが…去年のコピーしますか？」

去年のコピー。毎年そうやってきた。でもそれだと開封率が年々下がる。お客さんも「また同じやつ来た」ってなる。

問題は個別化コストだ。昨年ズワイガニを贈った人、のしたら鮭を頼んだ人、毎年牡蠣セットを頼む固定客――それぞれに最適な訴求が違う。でも手動でセグメントを切ってメールを書くのが重くてやれていなかった。

Claude APIに購入履歴を渡して、顧客ごとのパーソナライズ本文を生成させたら解決した。

## 作ったもの

顧客の購入履歴と属性データを入力すると：
- 件名（3パターン）
- 本文（昨年購入商品に言及した個別化テキスト）
- 先行予約の特典訴求

を生成するスクリプト。MAツール（Klaviyo / Mailchimp）にCSVで流し込める形式で出力する。

## 実装コード

### 1. 顧客データから個別メールを生成するコア関数

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface CustomerPurchaseHistory {
  customerId: string;
  name: string;               // 顧客名
  lastYearItems: string[];    // 昨年のお歳暮購入商品
  totalOrderCount: number;    // 累計注文回数
  segment: 'リピーター' | '新規' | 'VIP'; // 顧客ランク
  preferredItems?: string[];  // 嗜好履歴（過去全注文より）
}

interface OseiboCampaignEmail {
  subjectLines: string[];     // 件名3案
  bodyText: string;           // 本文
  ctaText: string;            // CTAボタン文言
}

async function generateOseiboEmail(
  customer: CustomerPurchaseHistory,
  campaignDetails: {
    earlyBirdDeadline: string;  // 先行予約締切日
    discount: string;           // 早期特典（例: "10%オフ"）
    newItems: string[];         // 今年の新ラインナップ
  }
): Promise<OseiboCampaignEmail> {
  const lastYearSummary = customer.lastYearItems.length > 0
    ? `昨年ご購入：${customer.lastYearItems.join('、')}`
    : '昨年の購入履歴なし（今年初めてのアプローチ）';

  const preferredSummary = customer.preferredItems && customer.preferredItems.length > 0
    ? `嗜好傾向：${customer.preferredItems.join('、')}`
    : '';

  const message = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: `あなたは三陸の水産ECサイトのメールマーケティング担当です。
お歳暮先行予約キャンペーンの個別メールを作成してください。

【顧客情報】
- 氏名：${customer.name}様
- 顧客ランク：${customer.segment}（累計注文${customer.totalOrderCount}回）
- ${lastYearSummary}
${preferredSummary ? `- ${preferredSummary}` : ''}

【キャンペーン情報】
- 先行予約締切：${campaignDetails.earlyBirdDeadline}
- 早期特典：${campaignDetails.discount}
- 今年の新ラインナップ：${campaignDetails.newItems.join('、')}

【メール作成ルール】
1. subjectLines（件名3案）：
   - 30文字以内
   - 昨年購入商品がある場合は1案で自然に言及する
   - 「お歳暮」「先行」「特典」を各案に分散させる
   - 数字・締切感・個別感のいずれかで差別化

2. bodyText（本文）：
   - 冒頭で顧客ランクに応じた適切な挨拶（VIPは感謝厚め、新規は温かく）
   - 昨年購入商品がある場合：「昨年の〇〇はいかがでしたか？」と自然につなぐ
   - 今年の見どころを2〜3点
   - 先行予約特典を明確に
   - 300〜400文字
   - 押しつけがましくなく、産地・鮮度への誇りが伝わる文体

3. ctaText：
   - 10〜20文字のCTAボタン文言
   - 先行予約の緊迫感を出す

【出力フォーマット（JSONのみ、説明不要）】
{
  "subjectLines": ["案1", "案2", "案3"],
  "bodyText": "...",
  "ctaText": "..."
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON parse failed');

  return JSON.parse(jsonMatch[0]) as OseiboCampaignEmail;
}
```

### 2. 顧客リストをまとめて処理してCSV出力

```typescript
import * as fs from 'fs';

interface EmailRow {
  customerId: string;
  name: string;
  subject: string;     // 選定した件名（1案目）
  bodyText: string;
  ctaText: string;
}

async function generateBulkOseiboEmails(
  customers: CustomerPurchaseHistory[],
  campaignDetails: {
    earlyBirdDeadline: string;
    discount: string;
    newItems: string[];
  },
  outputPath: string
): Promise<void> {
  const rows: EmailRow[] = [];
  let processed = 0;

  for (const customer of customers) {
    try {
      const email = await generateOseiboEmail(customer, campaignDetails);

      // 件名はA/Bテスト用に1案目を採用（手動で差し替え可）
      rows.push({
        customerId: customer.customerId,
        name: customer.name,
        subject: email.subjectLines[0],
        bodyText: email.bodyText,
        ctaText: email.ctaText,
      });

      processed++;
      if (processed % 10 === 0) {
        console.log(`✅ ${processed}/${customers.length} 件処理完了`);
      }

      // レート制限対策（1秒待機）
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      console.error(`❌ ${customer.customerId} の生成に失敗:`, err);
    }
  }

  // CSVに出力
  const header = 'customerId,name,subject,bodyText,ctaText\n';
  const csvRows = rows.map((r) =>
    [r.customerId, r.name, r.subject, r.bodyText, r.ctaText]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(',')
  );

  fs.writeFileSync(outputPath, header + csvRows.join('\n'));
  console.log(`\n📄 出力完了: ${outputPath}（${rows.length}件）`);
}
```

### 3. 実際の出力例

```typescript
const customer: CustomerPurchaseHistory = {
  customerId: 'C-00512',
  name: '田中 誠一',
  lastYearItems: ['ズワイガニ姿2杯セット', '生たらこ300g'],
  totalOrderCount: 4,
  segment: 'リピーター',
  preferredItems: ['カニ類', 'たらこ・明太子', 'いくら'],
};

const campaign = {
  earlyBirdDeadline: '10月31日',
  discount: '送料無料＋早期割引10%オフ',
  newItems: ['三陸産ホヤの塩辛', '活ホタテ6枚セット', '特選みそ漬け銀鮭'],
};

const email = await generateOseiboEmail(customer, campaign);
console.log(JSON.stringify(email, null, 2));
```

**出力例：**

```json
{
  "subjectLines": [
    "昨年のズワイガニ、今年もご用意しました",
    "【10/31締切】お歳暮の早期予約で送料無料に",
    "三陸から田中様へ、今年も旬をお届けします"
  ],
  "bodyText": "田中様\n\n毎年ご愛顧いただきありがとうございます。\n\n昨年ご注文いただいたズワイガニと生たらこはいかがでしたでしょうか。三陸の海が今年も豊かな恵みを届けてくれています。\n\n今年のお歳暮ラインナップには、田中様のお好みに合いそうな新商品も加わりました。三陸産ホヤの塩辛は磯の香りが濃厚で、日本酒との相性が抜群です。活ホタテ6枚セットは産直ならではの甘みが自慢。\n\n10月31日までのご予約で、送料無料＋10%オフの早期特典をご利用いただけます。今年も大切な方へ、本物の三陸の味をお届けください。",
  "ctaText": "今すぐ先行予約する"
}
```

### 4. セグメント別の件名傾向

生成してみると、セグメントで件名の型が変わってきた：

| セグメント | 件名の傾向 | 例 |
|-----------|-----------|---|
| VIP（10回以上） | 感謝・特別感 | 「いつもありがとうございます、今年も三陸より」 |
| リピーター（2〜9回） | 昨年参照・継続 | 「昨年のカニ、今年もご用意できました」 |
| 新規（初回） | 三陸・産直の価値訴求 | 「三陸直送、お歳暮先行予約承り中です」 |

## コストと効果

**APIコスト試算（1顧客あたり）**

| 項目 | 数値 |
|------|------|
| 入力トークン | 約600 |
| 出力トークン | 約500 |
| 1件生成コスト | 約0.5円 |
| 100顧客分 | 約50円 |

**効果（昨年比）**

| 指標 | 従来（一斉同文） | 今年（個別化） |
|------|----------------|--------------|
| 開封率 | 18% | 31% |
| クリック率 | 2.1% | 5.8% |
| 先行予約転換率 | 0.9% | 2.4% |

クライアントのコメント：「田中さんから『去年のカニの話、よく覚えてくれてましたね』ってLINEが来た。ちゃんと読んでもらえてる実感があった」

## ポイントと工夫

**うまくいった点**
- 昨年購入商品への言及で「ちゃんと覚えてくれてる」感が出る
- VIP顧客への感謝厚めトーンが離脱防止に効いた
- 件名3案を出力してA/Bテストできるのでデータが貯まる

**注意点**
- 購入履歴がない顧客（新規）は一般訴求になるため、別途セグメント設計が必要
- 「昨年〜はいかがでしたか？」フレーズは返品・クレームのあった商品に使わないようデータクレンジングが必要
- 生成後に必ず人間がプレビュー確認。1件ずつ送る前に担当者が目を通すフローを入れる

## まとめ

「去年のコピー」から「去年ありがとう、今年もどうぞ」に変えた。

お歳暮は年に1回の大きな購買タイミング。このタイミングで顧客一人ひとりに「自分のことを知ってくれている店」と感じさせると、来年も戻ってくる確率が上がる。

Claude APIを使えば100人分の個別メールを50円・1時間弱で生成できる。手動なら1日かかる作業。9月のうちから動いておくと10月の先行予約に余裕を持って臨める。

コード・カスタマイズ相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
