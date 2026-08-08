---
title: "Claude APIでLINE公式アカウントのメッセージを自動生成した話【水産ECの夏季キャンペーン実装】"
description: "メルマガで2回目購入率が改善した次の課題は「若い世代へのリーチ」。LINE公式アカウントのメッセージをClaude APIで自動生成し、40代以下の新規顧客獲得につなげた実装を全公開。"
pubDate: 2026-08-08
author: sam
category: "Claude活用"
tags: ["Claude", "LINE", "LINE公式アカウント", "メッセージ自動化", "水産業", "EC", "夏季キャンペーン"]
readingTime: 8
---

## メルマガの次の壁

[前回のメルマガ自動化](/blog/claude-newsletter-generator)で2回目購入率が15%→31%になった。

業者さんと振り返りをしていたら、こんな話が出た。

「リピーターは増えたんだけど、見てると50代以上のお客さんばっかりで…若い人はメルマガ読まないんですよね」

確かに。40代以下の購買層はメールをほとんど開かない。

「LINEで配信してみたいんだけど、何を書けばいいか毎回悩んで。メルマガと同じコピーを貼っつけたら文字数多すぎて読まれなかった」

LINE向けコンテンツは短く、絵文字を使い、会話に近いトーンが必要。メルマガとは別物。

これもClaudeに任せられる。

## LINEメッセージの難しさ

LINE公式アカウントのメッセージには制約がある。

- **吹き出し1つあたり最大500文字**（読まれるのは実質150文字以内）
- 絵文字・改行で「読みやすさ」を作る必要がある
- タイムライン上でスクロールされる前にフックする冒頭が命
- 硬いビジネス文体は即スルー

メルマガのプロンプトをそのまま使っても全然違うものが出てくる。LINEに最適化したプロンプトを作る必要があった。

## 作ったもの

商品情報・キャンペーン内容を入れると：
- **1通目（フックメッセージ）**：短い！スクロールを止める1〜2文
- **2通目（商品説明）**：旬・産地・食べ方を絵文字込みで140字
- **3通目（CTA）**：購入リンクへの誘導文

の3連投メッセージを自動生成するツール。

## 実装コード

### 1. LINE向けメッセージ生成関数

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface LineMessageInput {
  product: string;           // 例: "気仙沼産 本カツオたたき"
  season: string;            // 例: "お盆前の最終入荷"
  promotion?: string;        // 例: "2パック購入で送料無料"
  deadline?: string;         // 例: "8月12日（火）23:59まで"
  reviewQuote?: string;      // 例: "「解凍してすぐ食べられる」"
  targetAge: '全年齢' | '20〜40代' | '50代以上';
}

interface LineMessageSet {
  hook: string;     // 1通目
  body: string;     // 2通目
  cta: string;      // 3通目
}

async function generateLineMessages(input: LineMessageInput): Promise<LineMessageSet> {
  const toneGuide = {
    '全年齢': 'カジュアルだが丁寧。絵文字を適度に使う。',
    '20〜40代': 'フレンドリーでテンポ速め。絵文字多め。料理する楽しさや時短に訴求。',
    '50代以上': '丁寧で信頼感重視。絵文字は控えめ。産地・素材の安心感を前面に。',
  }[input.targetAge];

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `あなたは地方産品EC（水産加工品）のLINE公式アカウント担当者です。
友だち登録ユーザー向けのブロードキャストメッセージ（3通連投）を作成してください。

【商品・キャンペーン情報】
商品: ${input.product}
時期・背景: ${input.season}
${input.promotion ? `キャンペーン: ${input.promotion}` : ''}
${input.deadline ? `締め切り: ${input.deadline}` : ''}
${input.reviewQuote ? `お客様の声: ${input.reviewQuote}` : ''}

【ターゲット】
${toneGuide}

【LINEメッセージのルール】
- 各メッセージは150文字以内（絵文字含む）
- 改行を活用して縦に読みやすくする
- 1通目は「え、なに？」と思わせるフック。商品名は出さない
- 2通目で商品・旬・食べ方を伝える
- 3通目はリンクタップへの一押し。緊急感か限定感を添える

【出力フォーマット（JSONのみ）】
{
  "hook": "1通目のテキスト（フック）",
  "body": "2通目のテキスト（商品説明）",
  "cta": "3通目のテキスト（CTA）"
}`,
      },
    ],
  });

  const responseText =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON解析失敗');

  return JSON.parse(jsonMatch[0]) as LineMessageSet;
}
```

### 2. 実行例

```typescript
const messages = await generateLineMessages({
  product: '気仙沼産 本カツオたたき（冷凍）200g',
  season: 'お盆前の最終入荷。今年の本カツオ漁は終盤',
  promotion: '2パック以上で送料無料',
  deadline: '8月12日（火）23:59まで',
  reviewQuote: '「解凍してすぐタタキで食べられる、最高」',
  targetAge: '20〜40代',
});

console.log('【1通目】\n' + messages.hook);
console.log('\n【2通目】\n' + messages.body);
console.log('\n【3通目】\n' + messages.cta);
```

### 3. 実際の出力例（20〜40代ターゲット）

```
【1通目】
夏のカツオ、
今年はもう食べましたか？🐟

実は今週が今シーズン最後の入荷なんです。

---

【2通目】
気仙沼港から直送の本カツオたたき🔥

藁焼きの香りがたまらなくて、
解凍してすぐそのまま食べられる手軽さが人気。

「最高すぎてリピ確定」のレビューが続いてます✨

今年の漁はあと少し。
食べ納めするなら今です！

---

【3通目】
2パック以上で送料無料🎁

👇 8/12（火）23:59までの限定です
（残りわずか・なくなり次第終了）
```

## LINE Messaging APIとの連携

生成したメッセージをそのまま配信できる：

```typescript
import axios from 'axios';

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN!;

async function broadcastLineMessages(messages: LineMessageSet): Promise<void> {
  const payload = {
    messages: [
      { type: 'text', text: messages.hook },
      { type: 'text', text: messages.body },
      { type: 'text', text: messages.cta },
    ],
  };

  await axios.post(
    'https://api.line.me/v2/bot/message/broadcast',
    payload,
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      },
    }
  );

  console.log('配信完了');
}

// 生成 → 確認 → 配信
const msgs = await generateLineMessages({ /* ... */ });
console.log('--- 確認してください ---');
console.log(JSON.stringify(msgs, null, 2));

// 内容を確認してから実行
await broadcastLineMessages(msgs);
```

## A/Bテスト：ターゲット別の効果比較

同じ商品・同じキャンペーンで、ターゲット年齢を変えて2パターン生成し、友だちリストをセグメント別に配信した。

**全年齢向け（コントロール）**
```
三陸のカツオ、今が旬です🐟
気仙沼産の本カツオたたき、夏の終わりに
ぜひ食卓に。

2パック以上で送料無料、8月12日まで。
```

**20〜40代向け（テスト）**
```
夏のカツオ、
今年はもう食べましたか？🐟
…（上記の出力）
```

| 指標 | 全年齢向け | 20〜40代向け |
|------|----------|------------|
| 開封率（既読率） | 41% | 58% |
| リンクタップ率 | 6.2% | 11.4% |
| 購入率 | 3.1% | 6.8% |
| 40代以下の購入者割合 | 22% | 39% |

40代以下の購入者割合が22%→39%に。狙ったセグメントに届いた。

## コストと時間

**APIコスト（1回の配信準備）**

| 項目 | 数値 |
|------|------|
| 入力トークン（平均） | 約550 |
| 出力トークン（平均） | 約350 |
| 1回あたりコスト | 約1円 |
| A/Bテスト2パターン | 約2円 |

**時間比較**

| 作業 | Before | After |
|------|--------|-------|
| LINE文章を考える時間 | 30〜45分（毎回悩む） | 5分（生成＋確認） |
| 「硬くなりすぎた」修正 | 頻繁に発生 | ほぼなし |
| 月4回配信の合計 | 約3時間 | 約20分 |

## まとめ

LINEはメルマガより制約が多いぶん、「何を書くか」より「どう削るか」で悩んでいた。

Claude に「150文字・絵文字あり・フック構成」の制約を与えると、その枠の中でちゃんと最適化してくれる。プロンプト側でフォーマットを厳密に指定するのがコツ。

40代以下の購入者割合が増えたのは、コンテンツのトーンが変わったからだと思う。同じ商品でも、誰に向けて書くかで読まれ方が全然違う。

メルマガ × LINE の両方を回せるようになったことで、幅広い世代にリーチできるようになった。

次は季節ごとの自動スケジュール配信（Googleカレンダー連動）を試す予定。

コードの利用・相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）へどうぞ。
