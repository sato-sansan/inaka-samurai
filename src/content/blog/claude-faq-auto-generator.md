---
title: "Claude APIで問い合わせ履歴からFAQページを自動生成した話【Shopifyに月1回自動更新】"
description: "自動返信を導入して2ヶ月。問い合わせログが300件を超えたので、Claudeに投げてよくある質問パターンを抽出。ShopifyのFAQページをGitHub Actionsで月1回自動更新したら、問い合わせ件数が月30%減った話。"
pubDate: 2026-08-14
author: sam
category: "Claude活用"
tags: ["Claude", "Shopify", "FAQ", "カスタマーサポート", "自動化", "EC", "GitHub Actions"]
readingTime: 8
---

## 問題：問い合わせ対応を自動化したら、次の課題が見えた

自動返信を導入してから2ヶ月。問い合わせログが300件を超えて、あることに気づいた。

「同じ質問が多い。しかもFAQに書いてある内容と同じ。」

よくある質問ページはあった。でも3年前に作ったもので、内容が古い。「送料はいくらですか？」「賞味期限は？」「のし対応は？」──お客さんが見ていないのか、見つけられないのか分からないが、とにかく同じ質問が繰り返し届く。

300件のログをClaudeに投げたら、FAQにすべき質問パターンが一発で出てきた。

## 作ったもの

問い合わせログ（CSV）を投げると：

- よく聞かれる質問トップ10とその模範回答
- カテゴリ別分類（送料・梱包 / 賞味期限・保存方法 / ギフト・のし / 法人注文）
- ShopifyのFAQページ用HTMLスニペット

を出力するスクリプト。GitHub Actionsのcronで月1回実行し、Shopifyのページを自動更新する。

## 実装コード

### 1. 問い合わせログからFAQを抽出

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface FAQItem {
  question: string;
  answer: string;
  category: string;
  frequency: number;
}

interface FAQResult {
  summary: string;
  faqs: FAQItem[];
}

async function extractFAQsFromInquiries(inquiries: string[]): Promise<FAQResult> {
  const inquiryText = inquiries
    .slice(0, 200) // トークン節約：最新200件に絞る
    .map((q, i) => `[${i + 1}] ${q}`)
    .join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `あなたは水産加工品ECサイトのカスタマーサポート担当です。
以下は直近の問い合わせ内容${inquiries.length}件です。

【問い合わせ一覧】
${inquiryText}

よくある質問（FAQ）をまとめてください。

【出力フォーマット（JSONのみ）】
{
  "summary": "（全体の傾向を2〜3文で）",
  "faqs": [
    {
      "question": "（お客様が実際に聞いてきやすい言い回しで）",
      "answer": "（丁寧かつ具体的な模範回答。送料や賞味期限など具体的な数値は「[要確認]」と入れる）",
      "category": "（送料・梱包 / 賞味期限・保存方法 / ギフト・のし / 法人注文 / その他）",
      "frequency": （この質問が何件あったかの推定件数。整数）
    }
  ]
}

frequency順（多い順）に10件並べてください。`,
      },
    ],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSONパース失敗');
  return JSON.parse(jsonMatch[0]) as FAQResult;
}
```

### 2. 問い合わせログをCSVから読み込む

問い合わせ管理ツール（Zendesk・Re:lationなど）からCSVエクスポートして使う：

```typescript
import * as fs from 'fs';
import { parse } from 'csv-parse/sync';

interface InquiryRow {
  subject: string;
  body: string;
  created_at: string;
}

function loadInquiriesFromCSV(filePath: string): string[] {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const rows = parse(raw, { columns: true }) as InquiryRow[];

  return rows
    .filter((r) => r.body && r.body.trim().length > 5)
    .map((r) => {
      const subject = r.subject ? `[件名: ${r.subject}] ` : '';
      return `${subject}${r.body.trim()}`;
    });
}
```

### 3. ShopifyのFAQページ用HTMLを生成

```typescript
function generateFAQHtml(result: FAQResult): string {
  const categoryOrder = [
    '送料・梱包',
    '賞味期限・保存方法',
    'ギフト・のし',
    '法人注文',
    'その他',
  ];

  const grouped: Record<string, FAQItem[]> = {};
  for (const faq of result.faqs) {
    if (!grouped[faq.category]) grouped[faq.category] = [];
    grouped[faq.category].push(faq);
  }

  const sections: string[] = [];
  const updatedDate = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  sections.push(`<p class="faq-updated">最終更新：${updatedDate}</p>`);

  for (const cat of categoryOrder) {
    const items = grouped[cat];
    if (!items || items.length === 0) continue;

    sections.push(`<h2 class="faq-category">${cat}</h2>`);
    sections.push('<div class="faq-list">');

    for (const item of items) {
      sections.push(`
  <details class="faq-item">
    <summary class="faq-question">${escapeHtml(item.question)}</summary>
    <div class="faq-answer"><p>${escapeHtml(item.answer)}</p></div>
  </details>`);
    }

    sections.push('</div>');
  }

  return sections.join('\n');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```

### 4. Shopify Admin APIでFAQページを更新

```typescript
async function updateShopifyFAQPage(
  shopDomain: string,
  accessToken: string,
  pageId: number,
  htmlContent: string
): Promise<void> {
  const url = `https://${shopDomain}/admin/api/2024-01/pages/${pageId}.json`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({
      page: { id: pageId, body_html: htmlContent },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify APIエラー: ${res.status} ${text}`);
  }

  console.log('FAQページを更新しました');
}
```

### 5. メイン処理：一連の流れをつなぐ

```typescript
async function main() {
  const SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN!;
  const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN!;
  const FAQ_PAGE_ID = Number(process.env.SHOPIFY_FAQ_PAGE_ID!);

  // 1. 問い合わせログを読み込む
  const inquiries = loadInquiriesFromCSV('inquiries-latest.csv');
  console.log(`問い合わせ件数: ${inquiries.length}件`);

  // 2. ClaudeでFAQを抽出
  console.log('Claude APIでFAQ抽出中...');
  const result = await extractFAQsFromInquiries(inquiries);
  console.log(`FAQ生成: ${result.faqs.length}件`);

  // 3. HTMLを生成してローカル保存（確認用）
  const html = generateFAQHtml(result);
  fs.writeFileSync(
    'faq-preview.html',
    `<!DOCTYPE html><html lang="ja"><body>${html}</body></html>`
  );

  // 4. Shopifyへ反映
  await updateShopifyFAQPage(SHOP_DOMAIN, ACCESS_TOKEN, FAQ_PAGE_ID, html);
  console.log('完了！');
}

main().catch(console.error);
```

### 6. cronで月1回自動実行（GitHub Actions例）

`.github/workflows/update-faq.yml`：

```yaml
name: Update FAQ Page

on:
  schedule:
    - cron: '0 9 1 * *'  # 毎月1日 午前9時（UTC）
  workflow_dispatch:       # 手動実行も可能

jobs:
  update-faq:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Download inquiry log from S3
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        run: aws s3 cp s3://your-bucket/inquiries-latest.csv ./

      - name: Update FAQ
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          SHOPIFY_SHOP_DOMAIN: ${{ secrets.SHOPIFY_SHOP_DOMAIN }}
          SHOPIFY_ACCESS_TOKEN: ${{ secrets.SHOPIFY_ACCESS_TOKEN }}
          SHOPIFY_FAQ_PAGE_ID: ${{ secrets.SHOPIFY_FAQ_PAGE_ID }}
        run: npx ts-node src/update-faq.ts
```

## 実際の出力例（抜粋）

```
=== 送料・梱包 ===

Q: 送料はいくらかかりますか？
A: 全国一律[要確認]円です。[要確認]円以上のご注文で送料無料になります。
（推定 52件 / 200件中）

Q: 夏場の保冷はどうなっていますか？
A: 6〜9月はクール便（冷蔵）でお届けしています。保冷剤を[要確認]個同梱しますが、
   到着後はすみやかに冷蔵・冷凍保存をお願いします。
（推定 38件 / 200件中）

=== ギフト・のし ===

Q: 熨斗（のし）はつけてもらえますか？
A: はい、対応しています。ご注文時の備考欄に「表書き（例：御中元）」と
   「お名前」をご記入ください。
（推定 29件 / 200件中）
```

## コストと効果

**APIコスト試算（200件の問い合わせ分析）**

| 項目 | 数値 |
|------|------|
| 入力トークン（200件×平均60字） | 約3,000 |
| 出力トークン | 約2,000 |
| 1回の分析コスト | 約1.2円 |

月次自動更新のAPIコスト：**約1.2円**

**効果（3ヶ月後）**

| 指標 | Before | After |
|------|--------|-------|
| 月間問い合わせ件数 | 280件 | 190件 |
| FAQ更新頻度 | 年1回（手動） | 月1回（自動） |

**業者さんの感想：**「FAQを見て解決してくれる人が増えた。月末にメールをまとめて確認する時間が半分になった」

## ポイントと注意点

**うまくいった点**

- `[要確認]` プレースホルダーを使うことで、送料など変動する情報を担当者が確認・修正しやすくなった
- `<details>` タグのアコーディオン形式はShopifyのデフォルトCSSと相性がよく、追加スタイルが不要
- GitHub Actionsで完全自動化したので、誰かが操作しなくても毎月更新される

**注意点**

- 問い合わせ内容に個人情報が含まれる場合は、送信前に氏名・メアドを除去する匿名化処理を追加すること
- Shopify Admin APIのRate Limitは1分あたり40リクエスト。複数ページを更新する場合は間隔を空ける
- 生成された回答は担当者がレビューしてから公開すること（誤情報・古い情報の混入防止）

## まとめ

「FAQが古い」は放置されがちな課題だ。更新するには問い合わせを分析して、文章を書いて、HTMLに反映して…という工程が必要で、優先度が後回しになる。

Claude APIを使えば、問い合わせCSVをセットして実行するだけで、最新の傾向に基づいたFAQが自動生成される。

**実装コスト：半日 / 月次更新コスト：1.2円 / 問い合わせ削減：約30%**

コード・カスタマイズ相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
