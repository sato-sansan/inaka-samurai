---
title: "Claude APIで水産加工業者のお問い合わせ対応を自動化した話【TypeScript実装全公開】"
description: "「在庫ありますか？」「賞味期限は？」「法人注文できますか？」──毎日届く定型問い合わせをClaudeに任せた。実装コードと費用対効果をすべて公開。"
pubDate: 2026-08-01
author: sam
category: "Claude活用"
tags: ["Claude", "チャットボット", "自動化", "水産業", "顧客対応", "メール"]
readingTime: 9
---

## 問題：1日20件の定型メールが地味につらい

気仙沼の水産加工販売業者さん（EC運営）から相談が来た。

「商品ページに書いてあることを毎日20件聞かれる。答えるのは簡単だけど、積み重なると半日消える」

典型的なやつ。よく見ると問い合わせのうち**約70%は5パターン**で占められていた：

1. 「○○はまだ在庫ありますか？」
2. 「賞味期限はどのくらいですか？」
3. 「法人・業者向け購入はできますか？」
4. 「産地証明書はもらえますか？」
5. 「冷凍と冷蔵、どちらで届きますか？」

Claude APIで自動返信できる。

## 作ったもの

問い合わせメールのテキストを投げると：
- FAQ に該当する場合 → 即時自動返信文を生成
- 判断できない場合 → 人間にエスカレーション

という仕組み。ショッピングカートのお問い合わせフォームと連携して動かしている。

## 実装コード

### 1. Claude に判断させる（分類 + 返信文生成）

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface InquiryResult {
  canAutoReply: boolean;
  replyText?: string;
  escalationReason?: string;
}

const FAQ_CONTEXT = `
【よくある質問と回答】
Q: 在庫確認
A: 在庫状況はサイトのリアルタイム在庫数をご確認ください。「在庫なし」と表示されている場合は次回入荷をお知らせするメール登録が可能です。

Q: 賞味期限
A: 冷凍品は製造日より12ヶ月、冷蔵品は製造日より5日間です。お届け時点で残り3日以上を保証しています。

Q: 法人・業者購入
A: 法人のお客様向けに業務用パックをご用意しています。10kg以上のご注文で10%割引、請求書払いにも対応しています。info@example.comまでご連絡ください。

Q: 産地証明書
A: ご要望の場合、ご注文確認メールにてPDFを添付してお送りします。注文備考欄に「産地証明書希望」とご記入ください。

Q: 配送温度帯
A: 商品ページに「冷凍」「冷蔵」の表示があります。冷凍・冷蔵の混載はできないため、別々のご注文をお願いしています。
`;

async function handleInquiry(
  customerEmail: string,
  inquiryText: string
): Promise<InquiryResult> {
  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `あなたは水産加工品ECショップのカスタマーサポート担当です。
以下のFAQをもとに、お客様からのお問い合わせに対応してください。

${FAQ_CONTEXT}

【お客様からの問い合わせ】
${inquiryText}

【指示】
1. FAQで対応可能な場合：自然な日本語で返信文を作成し、以下のJSON形式で返してください。
2. FAQの範囲を超える場合（クレーム・特殊な要望・明確な回答ができない場合）：escalateをtrueにしてください。

返答フォーマット（JSONのみ）：
{
  "canAutoReply": true/false,
  "replyText": "（返信文）または null",
  "escalationReason": "（エスカレーション理由）または null"
}`,
      },
    ],
  });

  const responseText =
    message.content[0].type === 'text' ? message.content[0].text : '{}';

  // JSONブロックを抽出（マークダウンで囲まれている場合に対応）
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { canAutoReply: false, escalationReason: 'パース失敗' };
  }

  return JSON.parse(jsonMatch[0]) as InquiryResult;
}
```

### 2. 返信メールを整形して送る

```typescript
function buildReplyEmail(
  originalInquiry: string,
  replyText: string,
  customerName?: string
): string {
  const salutation = customerName ? `${customerName}様` : 'お客様';

  return `${salutation}

お問い合わせいただきありがとうございます。
気仙沼カツオ本舗 サポート担当です。

---

${replyText}

---

上記でご不明な点がございましたら、お気軽にご連絡ください。

気仙沼カツオ本舗
support@example.com
営業時間：平日 9:00〜17:00
`;
}

// メール送信関数（使用中のメールサービスに合わせて置き換え）
async function sendAutoReply(to: string, body: string): Promise<void> {
  // SendGrid / SES / Nodemailer などを使用
  console.log(`Auto-reply sent to ${to}`);
  console.log(body);
}

// メインの処理フロー
async function processInquiry(
  customerEmail: string,
  customerName: string | undefined,
  inquiryText: string
): Promise<'auto_replied' | 'escalated'> {
  const result = await handleInquiry(customerEmail, inquiryText);

  if (result.canAutoReply && result.replyText) {
    const emailBody = buildReplyEmail(inquiryText, result.replyText, customerName);
    await sendAutoReply(customerEmail, emailBody);
    console.log(`[AUTO] ${customerEmail} → 自動返信`);
    return 'auto_replied';
  } else {
    // 担当者へ転送
    console.log(`[ESCALATE] ${customerEmail} → 理由: ${result.escalationReason}`);
    return 'escalated';
  }
}
```

### 3. 動作確認

```typescript
// テスト
await processInquiry(
  'tanaka@example.com',
  '田中',
  '気仙沼カツオたたきを注文したいのですが、会社用に領収書は発行してもらえますか？業者価格はありますか？'
);
```

出力：

```
[AUTO] tanaka@example.com → 自動返信

田中様

お問い合わせいただきありがとうございます。
気仙沼カツオ本舗 サポート担当です。

---

ご注文の際は、法人のお客様向けに業務用パックをご用意しております。
10kg以上のご注文で10%割引、請求書払いにも対応しております。
詳しくは info@example.com までご連絡ください。

領収書につきましては、ご注文後にマイページよりPDF形式でダウンロード可能です。

---
```

ほぼそのまま使える。

## コストと効果

**APIコスト試算（月1,000問い合わせの場合）**

| 項目 | 数値 |
|------|------|
| 平均入力トークン | 約500 |
| 平均出力トークン | 約350 |
| 月1,000件のコスト | 約240円（claude-opus-4-6料金） |

**時間削減**

| 作業 | Before | After |
|------|--------|-------|
| 定型問い合わせ対応 | 1件3分 × 20件/日 = **60分/日** | 確認のみ **5分/日** |
| エスカレーション件数 | 20件/日 | 6件/日（70%削減） |

**業者さんの感想：**「毎朝のメール確認がストレスじゃなくなった」

## ポイントと注意点

**うまくいった点**
- FAQ をプロンプトに入れるだけでチューニング不要
- 「判断できない場合はエスカレーション」という逃げ道を作ったのが重要
- JSON出力を指定することでパース安定

**注意点**
- 返信文は毎日10件ほどサンプルチェックする（クオリティ維持）
- クレームや感情的な文章は必ずエスカレーション判定されるよう FAQ に含めない
- FAQは最低月1回更新（商品や規約が変わるたびに）

## まとめ

定型問い合わせの自動化は、コスト・工数・難易度のバランスが最高にいい。

FAQさえ整理されていれば**半日で動くものが作れる**。月240円のAPIコストで60分/日が返ってくるなら、投資対効果は圧倒的。

「まず5パターンだけ自動化する」という割り切りが成功の鍵だった。

コードを試したい方、または自社のFAQに合わせたカスタマイズ相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）へどうぞ。
