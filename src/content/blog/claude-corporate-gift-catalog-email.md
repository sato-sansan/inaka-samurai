---
title: "Claude APIで法人向けギフトカタログのメール提案を自動生成した話【三陸水産EC】"
description: "「お歳暮の法人営業、毎年手書きで疲れてる」という声に、過去購買データと予算帯を渡したらClaude APIが会社ごとにパーソナライズされた提案メールを一発で出してくれた話。"
pubDate: 2026-08-26
author: sam
category: "Claude活用"
tags: ["Claude", "EC自動化", "メールマーケティング", "法人営業", "ギフト", "お歳暮", "水産業"]
readingTime: 9
---

## 「法人のお歳暮営業、毎年エクセルと睨めっこで疲れ果てる」

[秋刀魚キャンペーンの配信計画](/blog/claude-autumn-saury-campaign)を終わらせたところで、次の相談が来た。

「個人のお客さんへのメールはだいぶ楽になった。でも法人は別で、毎年8月後半から10月にかけて法人担当が"お歳暮カタログ提案"を各社に送っているんだけど、これが完全に手作業で。会社ごとに去年何を買ったか、予算感はどのくらいか、担当者の名前は、って確認しながら一通一通書いてる」

確かにBtoB営業のメールはBtoCとは別の手間がある。

**過去の購買実績 × 予算感 × 今年の新商品 → 会社ごとのギフトセット提案**

法人は毎年同じものを頼みがちだけど、少し背中を押す提案があると単価が上がる。それをClaude APIに任せてみた。

## 作ったもの

入力：
- 法人顧客リスト（会社名・担当者名・昨年の購入商品・金額のCSV）
- 今年のギフトカタログ（商品名・価格・特徴のJSONL）
- 配送スケジュール（早割締切日・通常締切日）

出力：
- 各社向けにパーソナライズされたメール（件名＋本文）
- 提案セット（今年おすすめの組み合わせとその理由）
- 早割を訴求するCTA

## 実装コード

### 1. 法人顧客データと商品カタログの読み込み

```typescript
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import { parse } from 'csv-parse/sync';

const client = new Anthropic();

interface CorporateClient {
  companyName: string;
  contactName: string;
  contactTitle: string;     // 例: "総務部長"
  lastYearItems: string;    // 昨年購入商品（カンマ区切り）
  lastYearTotal: number;    // 昨年合計金額（円）
  notes: string;            // 担当者メモ（アレルギー・好みなど）
}

interface GiftItem {
  id: string;
  name: string;
  price: number;
  description: string;
  isNewThisYear: boolean;
  pairsWellWith: string[];  // 相性の良い商品ID
}

function loadClients(csvPath: string): CorporateClient[] {
  const raw = fs.readFileSync(csvPath, 'utf-8');
  return parse(raw, { columns: true, cast: true }) as CorporateClient[];
}

function loadCatalog(jsonlPath: string): GiftItem[] {
  return fs
    .readFileSync(jsonlPath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as GiftItem);
}
```

### 2. 法人ごとの提案メール生成

```typescript
async function generateCorporateProposalEmail(
  client_: CorporateClient,
  catalog: GiftItem[],
  earlyBirdDeadline: string,
  normalDeadline: string
): Promise<{ subject: string; body: string; recommendedSet: string }> {
  const catalogText = catalog
    .map(
      (item) =>
        `[${item.id}] ${item.name}（${item.price.toLocaleString()}円）${item.isNewThisYear ? ' ★今年新登場' : ''}\n  ${item.description}`
    )
    .join('\n');

  const budgetHint =
    client_.lastYearTotal >= 50000
      ? '昨年は5万円以上ご利用のお得意様'
      : client_.lastYearTotal >= 20000
        ? '昨年は2〜5万円程度のご利用'
        : '昨年は2万円以下のご利用';

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: `あなたは三陸水産ECの法人営業担当です。
お歳暮シーズンに向け、法人顧客へのギフト提案メールを作成してください。

【お客様情報】
会社名：${client_.companyName}
担当者：${client_.contactTitle} ${client_.contactName}様
昨年ご購入商品：${client_.lastYearItems}
昨年合計金額：${client_.lastYearTotal.toLocaleString()}円（${budgetHint}）
担当者メモ：${client_.notes || 'なし'}

【今年のカタログ】
${catalogText}

【配送スケジュール】
早割締切：${earlyBirdDeadline}（10%OFF）
通常締切：${normalDeadline}

【依頼内容】
以下をJSONで出力してください。
{
  "subject": "件名（会社名を入れる。30文字以内）",
  "body": "本文（昨年のお礼→今年の提案→早割の案内の流れで。400〜500文字。${client_.contactName}様へのパーソナルな一文を冒頭に）",
  "recommendedSet": "おすすめセット名と金額と一言理由（昨年より少し上の価格帯を狙う）"
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON パース失敗');

  return JSON.parse(jsonMatch[0]) as {
    subject: string;
    body: string;
    recommendedSet: string;
  };
}
```

### 3. 全法人に一括生成してCSVに保存

```typescript
async function generateAllProposals(
  clients: CorporateClient[],
  catalog: GiftItem[],
  earlyBirdDeadline: string,
  normalDeadline: string
): Promise<void> {
  const results: {
    companyName: string;
    contactName: string;
    subject: string;
    body: string;
    recommendedSet: string;
  }[] = [];

  // レート制限を意識して逐次処理
  for (const corp of clients) {
    console.log(`📝 ${corp.companyName} の提案メール生成中...`);
    try {
      const email = await generateCorporateProposalEmail(
        corp,
        catalog,
        earlyBirdDeadline,
        normalDeadline
      );
      results.push({
        companyName: corp.companyName,
        contactName: corp.contactName,
        ...email,
      });
      // APIレート制限を避けるための短い待機
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (err) {
      console.error(`  ❌ ${corp.companyName}: エラー`, err);
    }
  }

  // 結果をCSVに保存（担当者がメーラーにコピペして使う）
  const header = 'companyName,contactName,subject,body,recommendedSet\n';
  const rows = results
    .map(
      (r) =>
        `"${r.companyName}","${r.contactName}","${r.subject}","${r.body.replace(/"/g, '""')}","${r.recommendedSet}"`
    )
    .join('\n');

  fs.writeFileSync(
    `corporate-proposals-${new Date().toISOString().slice(0, 10)}.csv`,
    header + rows,
    'utf-8'
  );

  console.log(`\n✅ ${results.length}件分の提案メールを保存しました`);
}

async function main() {
  const clients = loadClients('corporate-clients.csv');
  const catalog = loadCatalog('gift-catalog-2026.jsonl');

  console.log(`対象法人数: ${clients.length}件`);

  await generateAllProposals(
    clients,
    catalog,
    '2026-10-15',  // 早割締切
    '2026-11-30'   // 通常締切
  );
}

main().catch(console.error);
```

### 4. 実際の出力例

法人A社（昨年：のし付き鮮魚セット3万円購入）向けの生成例：

```
件名: 【A株式会社様】今年のお歳暮ご提案のご案内

本文:
鈴木様

昨年は三陸の鮮魚セットをお選びいただき、誠にありがとうございました。
社内でご好評いただけたとのご連絡、大変嬉しく拝読いたしました。

今年はその鮮魚セットに加え、今シーズン初登場の
「三陸産生うに入り海鮮丼セット」をご提案させていただきます。
昨年ご好評をいただいた鮮魚との組み合わせで、より贅沢なお歳暮に
なるかと存じます。

また、10月15日（木）までのご注文で10%OFFの早割をご用意しております。
昨年より少し早めにご検討いただけますと、最繁忙期を避けた
スムーズなお届けも可能です。

カタログPDFをご希望の場合はお気軽にご返信ください。

おすすめセット: 三陸豪華海鮮ギフトセット（38,000円）
→ 昨年の鮮魚セットに生うに・いくらをプラスした特別仕様。
  同予算で格上げ感のある一品です。
```

## コストと効果

**APIコスト（法人50社分）**

| 処理 | トークン数（概算） | コスト |
|------|------------------|--------|
| 1社あたりの生成 | 入力1,200＋出力700 | 約1.1円 |
| 50社分合計 | | **約55円** |

**工数削減**

| 作業 | Before（手動） | After（Claude API） |
|------|--------------|-------------------|
| 1社あたりの提案文作成 | 15〜20分 | 0分（確認のみ2分） |
| 50社分合計 | 約15時間 | 約1.5時間（確認・調整） |
| 担当者の心理的負荷 | 高（繁忙期の追加業務） | 低（チェックだけ） |

**法人担当の一言：**
「去年は9月に入ってから慌てて書き始めて、送り終わったのが10月。今年は8月中に50社分が出てきたから、余裕を持って早割に誘導できる。実際に昨年より早く受注が入り始めた」

## ポイントと注意点

**うまくいった点**
- 昨年の購買金額を「少し上の価格帯を狙う」という指示にすることで、ほぼ全社で前年比105〜115%の提案金額になった
- 担当者メモ（アレルギー・好み）を入力に含めることで、除外すべき商品が自動的に外れた
- 一括生成後のCSVをメーラーにコピペするだけで送れるワークフローにしたので、非エンジニアの担当者が使いやすかった

**注意点**
- 生成後は必ず担当者が目視確認してから送ること（会社名の誤りや失礼な表現がないか）
- 法人リストは個人情報を含むため、APIに渡す前にセキュリティポリシーを確認すること
- 今年の商品ラインナップが少ない場合は「昨年と同商品のおすすめ」にフォールバックするロジックを入れると安心

## まとめ

法人向けのパーソナライズ営業メールは「手をかけなきゃいけない」という思い込みがあったけど、Claude APIに渡す情報を整理するだけで十分なクオリティが出た。

50社分が55円・1.5時間で終わった。手書きなら15時間かかっていた作業だ。

早割での誘導も早期にできたおかげで、8月末時点で例年より2週間早くお歳暮の受注が動き始めている。

法人向けの定期的なご挨拶メール、見積もり案内、新商品の案内など、同じ仕組みで横展開できる。コード・カスタマイズ相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
