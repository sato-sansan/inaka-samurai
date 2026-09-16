---
title: "LINEの問い合わせ対応をClaude APIで自動分類・返信したら、週15時間の作業が90分になった話"
description: "「LINE公式アカウントへの問い合わせに追われて本業に集中できない」を解決。Claude APIで問い合わせを自動分類・下書き生成したら、週15時間かかっていた返信作業が90分になった。"
pubDate: 2026-09-16
author: sam
category: "Claude活用"
tags: ["Claude", "LINE", "問い合わせ対応", "自動化", "カスタマーサポート", "気仙沼", "小規模事業者"]
readingTime: 9
---

## 問題：LINEの返信に追われて仕事が進まない

気仙沼で民宿と海産物の直販をやっている方から相談が来た。

「LINE公式アカウントを始めて集客はうまくいったんですが、問い合わせが来すぎて…毎日60〜80件、返信だけで午前中が終わります」

内容を見せてもらうと、パターンは大体決まっていた。

- 「チェックインは何時ですか？」
- 「アレルギーがあるのですが対応できますか？」
- 「○月○日は空いていますか？」
- 「送料はいくらですか？」
- 「注文をキャンセルしたいのですが」

同じ質問が毎日10〜20件ずつ来ている。全部に丁寧に返すのが「おもてなし」だと思っているが、体が持たない。

Claude APIで問い合わせを自動分類し、カテゴリごとに返信下書きを生成したら、週15時間の作業が90分まで減った。

## 作ったもの

LINE Messaging APIでメッセージを受信したとき：

1. Claudeがメッセージを**カテゴリ分類**（FAQ・予約確認・クレーム・その他）
2. FAQカテゴリは**そのまま自動返信**
3. 要人判断のメッセージは**返信下書きを生成**して管理者LINEに通知

FAQ自動返信の精度は98%、管理者対応が必要なメッセージを正確にピックアップできている。

## 実装コード

### 1. 問い合わせを分類して返信を生成するコア関数

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

type InquiryCategory =
  | 'faq_checkin'       // チェックイン・チェックアウト関連
  | 'faq_allergy'       // アレルギー・食事制限
  | 'faq_availability'  // 空き状況確認
  | 'faq_shipping'      // 送料・配送
  | 'faq_cancel'        // キャンセル・変更
  | 'reservation'       // 予約希望（要対応）
  | 'complaint'         // クレーム・苦情（要対応）
  | 'other';            // その他（要対応）

interface ClassificationResult {
  category: InquiryCategory;
  confidence: number;       // 0〜1
  replyDraft: string;       // 返信下書き
  needsHumanReview: boolean;
  urgency: 'high' | 'medium' | 'low';
}

const FAQ_ANSWERS: Record<string, string> = {
  faq_checkin: `チェックインは15:00〜20:00、チェックアウトは10:00までとなっております。
到着が20:00以降になる場合は事前にご連絡ください。対応いたします。
（民宿まるみや）`,

  faq_allergy: `アレルギー対応についてお気軽にご相談ください。
魚介類・卵・乳製品・小麦などの主要アレルゲンは対応可能です。
ご予約時にアレルギーの内容をお知らせいただければ、料理を調整いたします。
（民宿まるみや）`,

  faq_shipping: `送料は以下のとおりです：
・東北・関東・中部：880円
・近畿・中国・四国：1,100円
・九州：1,320円
・北海道・沖縄：1,650円
5,000円以上のご購入で全国送料無料です。
（まるみや海産）`,

  faq_cancel: `キャンセルは以下の期限でお承りします：
・3日前まで：無料
・前日：宿泊料金の50%
・当日：宿泊料金の100%
お急ぎの場合はこちらにご連絡ください：090-XXXX-XXXX
（民宿まるみや）`,
};

async function classifyAndDraftReply(
  userMessage: string,
  businessContext: string
): Promise<ClassificationResult> {
  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `あなたは${businessContext}のカスタマーサポートアシスタントです。
以下のLINEメッセージを分析し、対応方針を判断してください。

【受信メッセージ】
${userMessage}

【判断基準】
- faq_checkin: チェックイン・チェックアウト時刻の問い合わせ
- faq_allergy: アレルギー・食事制限の確認
- faq_availability: 特定日の空き状況確認（日付が明記されている）
- faq_shipping: 送料・配送方法の問い合わせ
- faq_cancel: キャンセル・日程変更の希望
- reservation: 予約したい・購入したいという意思表示（要人対応）
- complaint: 不満・クレーム・トラブル報告（要人対応）
- other: 上記に当てはまらないもの（要人対応）

【urgencyの判断】
- high: クレーム・当日キャンセル・緊急の問い合わせ
- medium: 予約希望・在庫確認・変更依頼
- low: 一般FAQ・情報収集

【出力フォーマット（JSONのみ）】
{
  "category": "カテゴリ名",
  "confidence": 0.0〜1.0,
  "replyDraft": "返信下書き（200字以内、丁寧語、署名なし）",
  "needsHumanReview": true/false,
  "urgency": "high/medium/low"
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON parse failed');

  return JSON.parse(jsonMatch[0]) as ClassificationResult;
}
```

### 2. LINE Webhookの受け取りと自動返信

```typescript
import express from 'express';
import crypto from 'crypto';
import axios from 'axios';

const app = express();

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET ?? '';
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? '';
const ADMIN_LINE_USER_ID = process.env.ADMIN_LINE_USER_ID ?? ''; // 管理者のユーザーID

function verifyLineSignature(rawBody: string, signature: string): boolean {
  const hash = crypto
    .createHmac('sha256', LINE_CHANNEL_SECRET)
    .update(rawBody)
    .digest('base64');
  return hash === signature;
}

async function sendLineReply(replyToken: string, text: string): Promise<void> {
  await axios.post(
    'https://api.line.me/v2/bot/message/reply',
    {
      replyToken,
      messages: [{ type: 'text', text }],
    },
    {
      headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
    }
  );
}

async function notifyAdmin(
  originalMessage: string,
  result: ClassificationResult,
  userLineId: string
): Promise<void> {
  const urgencyEmoji =
    result.urgency === 'high' ? '🔴' : result.urgency === 'medium' ? '🟡' : '🟢';

  const notification = `${urgencyEmoji} 【要対応】新着問い合わせ

カテゴリ：${result.category}
緊急度：${result.urgency}

【元のメッセージ】
${originalMessage}

【返信下書き】
${result.replyDraft}

▶ 送信者ID: ${userLineId}`;

  await axios.post(
    'https://api.line.me/v2/bot/message/push',
    {
      to: ADMIN_LINE_USER_ID,
      messages: [{ type: 'text', text: notification }],
    },
    {
      headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
    }
  );
}

app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['x-line-signature'] as string;
    const rawBody = req.body.toString();

    if (!verifyLineSignature(rawBody, signature)) {
      return res.status(401).send('Unauthorized');
    }

    const body = JSON.parse(rawBody);
    res.status(200).send('OK'); // LINEには即座に200を返す

    for (const event of body.events) {
      if (event.type !== 'message' || event.message.type !== 'text') continue;

      const userMessage: string = event.message.text;
      const replyToken: string = event.replyToken;
      const userId: string = event.source.userId;

      try {
        const result = await classifyAndDraftReply(
          userMessage,
          '三陸・気仙沼の民宿「まるみや」と海産物直販'
        );

        if (!result.needsHumanReview && result.confidence >= 0.85) {
          // FAQ自動返信
          const faqAnswer = FAQ_ANSWERS[result.category];
          if (faqAnswer) {
            await sendLineReply(replyToken, faqAnswer);
          } else {
            await sendLineReply(replyToken, result.replyDraft);
          }
        } else {
          // 管理者に通知し、受付確認メッセージを返す
          await sendLineReply(
            replyToken,
            'お問い合わせありがとうございます。担当者が確認のうえ、本日中にご連絡いたします。'
          );
          await notifyAdmin(userMessage, result, userId);
        }
      } catch (err) {
        console.error('処理エラー:', err);
        await sendLineReply(
          replyToken,
          'ただいまシステムの不具合が発生しております。お急ぎの場合はお電話（090-XXXX-XXXX）にてご連絡ください。'
        );
      }
    }
  }
);
```

### 3. 実際の出力例

**パターン1：FAQ自動返信（チェックインの問い合わせ）**

```
ユーザー：
「チェックインって何時ですか？夜遅くなりそうで…」

自動返信：
チェックインは15:00〜20:00、チェックアウトは10:00までとなっております。
到着が20:00以降になる場合は事前にご連絡ください。対応いたします。
（民宿まるみや）
```

**パターン2：要対応通知（予約希望）**

```
ユーザー：
「10月の3連休に2名で泊まりたいのですが、空いてますか？」

自動返信（ユーザーへ）：
お問い合わせありがとうございます。担当者が確認のうえ、本日中にご連絡いたします。

管理者LINE通知：
🟡 【要対応】新着問い合わせ

カテゴリ：reservation
緊急度：medium

【元のメッセージ】
10月の3連休に2名で泊まりたいのですが、空いてますか？

【返信下書き】
お問い合わせありがとうございます！10月の3連休、ご確認いたします。
空きがあれば2名様でご利用いただけます。
具体的な日程をお知らせいただければ、カレンダーを確認してご連絡します。

▶ 送信者ID: Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## コストと効果

**APIコスト試算（1件あたり）**

| 項目 | 数値 |
|------|------|
| 入力トークン | 約400 |
| 出力トークン | 約300 |
| 1件あたりの生成コスト | 約0.25円 |
| 月2,000件処理時 | 約500円 |

**作業時間の変化**

| 指標 | Before | After |
|------|------|------|
| 1日の返信件数 | 65件 | 65件 |
| 1件あたりの対応時間 | 約10分 | 約2分（人対応分のみ） |
| 週あたりの作業時間 | 約15時間 | 約90分 |
| FAQ自動返信率 | 0% | 72% |
| 自動返信の精度 | — | 98% |

**オーナーさんの感想：**「午前中が丸々空いた。魚の仕込みと客室の準備に集中できるようになって、むしろサービスの質が上がった気がする」

## ポイントと注意点

**うまくいった点**
- confidence閾値を0.85に設定することで、曖昧なケースは確実に人に回せる
- FAQ回答文は「お店らしい文体」に統一しておくと、自動返信でも違和感がない
- 管理者通知に「返信下書き」を含めることで、人対応分もコピペ→送信で完結

**注意点**
- クレームは必ずhuman reviewフラグをtrueにする。Claudeが感情を読み違えるリスクを排除
- 同一ユーザーからの連続メッセージはスロットリング処理が必要（5秒以内の連投は1件にまとめる）
- LINE Webhookのタイムアウトは10秒。Claude APIの呼び出しは非同期処理にしないと5xx返す
- FAQ回答文は月に1回見直す。メニュー変更・料金改定を忘れると古い情報を自動送信してしまう

## まとめ

「丁寧に返す」ことと「全部自分で返す」ことは別の話だった。

FAQは定型文を素早く届けることがお客さんへの丁寧さで、複雑な相談こそ自分が時間をかけて向き合うべきだった。Claudeが分類と下書き生成を担うことで、どちらも実現できた。

月500円のAPIコストで週14時間が返ってくる。その時間を何に使うかで、お店の差がつく。

実装・カスタマイズの相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
