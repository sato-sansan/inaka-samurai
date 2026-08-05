---
title: "Claude APIで水産ECのメルマガを自動生成した話【リピート購入を増やす実装例】"
description: "レビュー分析でわかった「夏のカツオへの満足度の高さ」を活かし、既存顧客向けのメルマガをClaude APIで自動生成。月1回の配信が15分で完了するようになった実装を全公開。"
pubDate: 2026-08-05
author: sam
category: "Claude活用"
tags: ["Claude", "メルマガ", "メールマーケティング", "リピート購入", "自動化", "水産業", "EC"]
readingTime: 8
---

## 前回の続き

[レビュー分析の記事](/blog/claude-review-analysis)で「鮮度・味への満足度52%」「保冷剤改善後に梱包クレームがゼロになった」という結果が出た。

これを見た業者さんが言った。

「満足してくれてるお客さんが多いのはわかった。でもリピートが全然ない」

調べてみると、購入者の約85%が1回限り。2回目購入率が低い。

理由はシンプルで、**買ったことを忘れられている**。メルマガを出していない。

Claude APIで解決できる。

## 作ったもの

顧客データと在庫・季節情報を入れると：
- ターゲット別の件名（開封率を上げる）
- 本文（商品の魅力と購入きっかけを自然に伝える）
- CTA（行動を促す一文）

を自動生成する月次メルマガ生成ツール。

## 実装コード

### 1. メルマガ生成関数

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface NewsletterInput {
  month: string;             // 例: "8月"
  season: string;            // 例: "晩夏・新物シーズン"
  featuredProduct: string;   // 例: "気仙沼産 本カツオたたき"
  stockNote?: string;        // 例: "今月は数量限定"
  promotion?: string;        // 例: "送料無料キャンペーン（8/10まで）"
  reviewHighlight?: string;  // レビュー分析から持ってくる好評ポイント
  segment: 'new' | 'repeat' | 'vip'; // 顧客セグメント
}

interface NewsletterResult {
  subject: string;
  preheader: string;
  body: string;
  cta: string;
}

async function generateNewsletter(input: NewsletterInput): Promise<NewsletterResult> {
  const segmentContext = {
    new: '初回購入から3ヶ月以内・リピートなし。まだ購入習慣が定着していない層。',
    repeat: '2〜4回購入の安定顧客。信頼関係があるので商品の深い情報が刺さる。',
    vip: '5回以上購入・合計購入額5万円以上。強い愛着がある。限定感・感謝を前面に出す。',
  }[input.segment];

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: `あなたは地方産品EC（水産加工品）のメールマーケティング担当者です。
既存顧客向けの月次メルマガを作成してください。

【配信情報】
配信月: ${input.month}
季節・旬: ${input.season}
おすすめ商品: ${input.featuredProduct}
${input.stockNote ? `在庫状況: ${input.stockNote}` : ''}
${input.promotion ? `キャンペーン: ${input.promotion}` : ''}
${input.reviewHighlight ? `顧客の好評ポイント（レビューより）: ${input.reviewHighlight}` : ''}

【ターゲット顧客セグメント】
${segmentContext}

【出力フォーマット（JSONのみ）】
{
  "subject": "件名（25字以内・開封率を意識・数字や旬のワードを入れる）",
  "preheader": "プリヘッダーテキスト（50字以内・件名を補完する内容）",
  "body": "本文（400〜500字。ですます調。産地の情景・旬の旨さ・実際の食卓シーンを想像させる。改行で読みやすく）",
  "cta": "行動促進文（20字以内・購入ボタンの上に表示するテキスト）"
}`,
      },
    ],
  });

  const responseText =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON解析失敗');

  return JSON.parse(jsonMatch[0]) as NewsletterResult;
}
```

### 2. セグメント別に一括生成

```typescript
const BASE_INPUT = {
  month: '8月',
  season: '晩夏・本カツオの新物シーズン',
  featuredProduct: '気仙沼産 本カツオたたき（冷凍）200g',
  stockNote: '8月中旬以降は入荷減の見込み',
  promotion: '8月10日（日）まで送料無料',
  reviewHighlight: '「届いた瞬間から新鮮」「藁焼きの香りが本格的」という声が多数',
};

async function generateAllSegments() {
  const segments = ['new', 'repeat', 'vip'] as const;

  const results = await Promise.all(
    segments.map(async (segment) => {
      const newsletter = await generateNewsletter({ ...BASE_INPUT, segment });
      return { segment, newsletter };
    })
  );

  results.forEach(({ segment, newsletter }) => {
    console.log(`\n===== ${segment.toUpperCase()} セグメント =====`);
    console.log(`件名: ${newsletter.subject}`);
    console.log(`プリヘッダー: ${newsletter.preheader}`);
    console.log(`\n本文:\n${newsletter.body}`);
    console.log(`\nCTA: ${newsletter.cta}`);
  });

  return results;
}

await generateAllSegments();
```

### 3. 実際の出力例（repeatセグメント）

```
件名: 【8月限定】気仙沼カツオ、今年も旨い理由

プリヘッダー: 8月10日まで送料無料。藁焼きの香りを今すぐ食卓に。

本文:
いつもご利用ありがとうございます。

今年の本カツオは三陸沖の豊かな海流に恵まれ、脂の乗りが例年以上と言われています。
気仙沼港に水揚げされたばかりを、昔ながらの藁焼きで丁寧に仕上げました。

お客様からのレビューにも「届いた瞬間から新鮮」「藁焼きの香りが本格的で感動した」という声を多くいただいています。
先日の保冷剤改善（2個→3個）も好評で、今年の夏は安心してお届けできます。

旬は短く、8月中旬以降は入荷が減る見込みです。
今だけの本物の味を、ぜひ今年も食卓にどうぞ。

▼ 8月10日（日）まで送料無料でお届けします。

CTA: 今すぐ旬のカツオを注文する
```

## 配信ツールとの連携

生成したメルマガはそのままMailchimpやSendGridに投げられる：

```typescript
import mailchimp from '@mailchimp/mailchimp_marketing';

mailchimp.setConfig({
  apiKey: process.env.MAILCHIMP_API_KEY!,
  server: 'us1',
});

async function createMailchimpCampaign(
  listId: string,
  segmentId: number,
  newsletter: NewsletterResult
): Promise<string> {
  const campaign = await mailchimp.campaigns.create({
    type: 'regular',
    recipients: {
      list_id: listId,
      segment_opts: { saved_segment_id: segmentId },
    },
    settings: {
      subject_line: newsletter.subject,
      preview_text: newsletter.preheader,
      from_name: '気仙沼カツオ本舗',
      reply_to: 'info@example.com',
    },
  });

  await mailchimp.campaigns.setContent(campaign.id, {
    html: buildEmailHtml(newsletter),
  });

  return campaign.id;
}

function buildEmailHtml(newsletter: NewsletterResult): string {
  return `
<div style="max-width:600px;margin:0 auto;font-family:sans-serif;">
  <p style="white-space:pre-line;line-height:1.8;">${newsletter.body}</p>
  <div style="text-align:center;margin-top:24px;">
    <a href="https://example.myshopify.com" style="background:#2563eb;color:#fff;padding:14px 32px;border-radius:4px;text-decoration:none;font-weight:bold;">
      ${newsletter.cta}
    </a>
  </div>
</div>`;
}
```

## コストと効果

**APIコスト（月1回 × 3セグメント）**

| 項目 | 数値 |
|------|------|
| 平均入力トークン | 約450/セグメント |
| 平均出力トークン | 約400/セグメント |
| 月3セグメント生成コスト | 約2円 |

**時間削減**

| 作業 | Before | After |
|------|--------|-------|
| 1本のメルマガ作成 | 45〜60分 | 5分（生成＋確認） |
| 3セグメント分 | 約3時間 | 約15分 |
| 配信設定（Mailchimp） | 別途30分 | 別途30分（変わらず） |

**配信後3ヶ月の結果**

| 指標 | Before（未配信） | After（月1配信） |
|------|----------------|-----------------|
| 2回目購入率 | 15% | 31% |
| 開封率 | — | 38%（業界平均22%） |
| メルマガ経由売上 | 0円 | 月売上の約18% |

業者さんの感想：「名前の知らない人が常連になってきた感じがする」

## ポイントと注意点

**うまくいった点**
- レビューのポジティブコメントをそのまま本文に引用することで「お客様の声」として機能する
- セグメントごとに件名のトーンを変えたことで、VIPセグメントの開封率が特に高かった（51%）
- プリヘッダーに締め切り情報を入れることで緊急感が伝わる

**注意点**
- 生成後は必ず読んで確認する（固有名詞・日付・在庫情報が正確かチェック）
- 配信頻度は月1〜2回まで。毎週出すと購読解除が増える
- 件名に「無料」「今すぐ」を入れると迷惑メールフィルターに引っかかる場合がある

## まとめ

メルマガを出していなかった最大の理由は「書く時間がない」ではなく「何を書けばいいか毎回迷う」だったと思う。

Claude にインプットを渡すだけで、季節・商品・顧客セグメントに合わせた内容が出てくる。迷う作業がなくなって、確認するだけになった。

2回目購入率が15%→31%になったのは、品質の問題ではなく**存在を思い出してもらえていなかった**だけ。メルマガはその一番シンプルな解決策だった。

実装の相談・コードの利用はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）へどうぞ。
