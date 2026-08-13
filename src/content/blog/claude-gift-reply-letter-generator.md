---
title: "Claude APIでお中元・お歳暮の礼状を自動生成した話【取引先30社分を30分で片付ける】"
description: "熨斗文の次は礼状。毎年お中元・お歳暮のたびに30社以上の取引先へ礼状を書く作業をClaude APIで自動化した。送り主・品物・関係性を入力するだけで格式のある礼状文を即座に生成するTypeScript実装を全公開。"
pubDate: 2026-08-13
author: sam
category: "Claude活用"
tags: ["Claude", "礼状", "お中元", "ビジネス文書", "時候の挨拶", "自動化", "水産業", "EC"]
readingTime: 7
---

## 熨斗文の次の課題

[前回](/blog/claude-gift-noshi-message-generator)でお中元の熨斗文・メッセージカードを自動生成した。

業者さんから早速フィードバックが来た。

「送る側の準備は楽になったんですが、逆に自分たちが取引先からお中元をいただいたときの礼状がまだ手書きで…毎年30社以上に書いてるんですよ」

そういえば見落としていた。贈る側だけじゃなく、もらう側にも仕事がある。

日本のビジネス慣習では、お中元・お歳暮を受け取ったら礼状を出すのが礼儀だ。ハガキまたは封書で、時候の挨拶・品物への感謝・今後の取引への言葉を盛り込む。フォーマットがある程度決まっているとはいえ、送り主との関係性や品物によって文体・内容を変えたい。それを30社分書くのは、慣れていても半日はかかる。

## 礼状の難しさ

礼状には独自のルールがある。

- **時候の挨拶**: 月・季節によって使う言葉が変わる（「残暑の候」「盛夏の折」など）
- **頭語・結語**: 「拝啓〜敬具」「謹啓〜謹白」など格式によって使い分ける
- **品物への言及**: 「〇〇を頂戴し」と具体的に書くのが丁寧とされる
- **関係性のトーン**: 長年の取引先 vs 新規取引先、法人 vs 個人で文体が変わる
- **字数**: ハガキなら150〜250字が目安

自力で書くには礼状のテンプレ集を引っ張り出して、時候の挨拶を確認して、品物名を入れ替えて…という手順が毎回発生する。30社分やったら数時間は飛ぶ。

## 作ったもの

送り主情報・品物・関係性を入力すると、ハガキに印刷できる礼状文を生成するツール。

**入力**:
- 送り主名（個人名 or 会社名・担当者名）
- いただいた品物
- 送付時期（月）
- 関係性（長年の取引先・新規取引先・個人）
- 格式レベル（丁寧・標準）

**出力**:
- 頭語・結語込みの礼状本文（ハガキサイズ想定）
- 文字数

## 実装コード

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

type Formality = '丁寧' | '標準';
type RelationshipType = '長年の取引先' | '新規取引先' | '個人（知人・友人）';

interface ReishoInput {
  senderName: string;       // 例: "株式会社○○水産 鈴木部長"
  giftReceived: string;     // 例: "三陸産 活き牡蠣（詰め合わせ）"
  month: number;            // 1〜12
  relationship: RelationshipType;
  formality: Formality;
}

interface ReishoResult {
  body: string;
  charCount: number;
  greeting: string;
}

async function generateReisho(input: ReishoInput): Promise<ReishoResult> {
  const seasonalGreetings: Record<number, string[]> = {
    1:  ['厳寒の候', '寒冷の候', '大寒の候'],
    2:  ['余寒の候', '立春の候', '梅花の候'],
    3:  ['早春の候', '春暖の候', '浅春の候'],
    4:  ['陽春の候', '春和の候', '花冷えの候'],
    5:  ['新緑の候', '薫風の候', '立夏の候'],
    6:  ['梅雨の候', '向暑の候', '夏至の候'],
    7:  ['盛夏の候', '猛暑の候', '炎暑の候'],
    8:  ['残暑の候', '晩夏の候', '処暑の候'],
    9:  ['初秋の候', '秋涼の候', '新秋の候'],
    10: ['仲秋の候', '秋冷の候', '紅葉の候'],
    11: ['晩秋の候', '霜降の候', '初霜の候'],
    12: ['師走の候', '寒冬の候', '歳末の候'],
  };

  const greeting = (seasonalGreetings[input.month] ?? ['時下'])[0];

  const formalityGuide = {
    '丁寧': '「謹啓〜謹白」を使い、格式高い文語調で書く。',
    '標準': '「拝啓〜敬具」を使い、丁寧だが読みやすい現代語調で書く。',
  }[input.formality];

  const relationshipGuide = {
    '長年の取引先': '長年のお付き合いへの感謝と今後の取引継続への期待を添える。「平素より格別のお引き立て」等の定型句を使う。',
    '新規取引先':   '控えめに。今後の関係構築への期待と誠実な姿勢を前面に出す。',
    '個人（知人・友人）': '柔らかい文体。形式ばりすぎず、親しみを感じさせる言葉遣いにする。',
  }[input.relationship];

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `あなたは日本のビジネス文書作成の専門家です。
お中元（または贈り物）への礼状をハガキ向けに作成してください。

【情報】
送り主: ${input.senderName}
いただいた品物: ${input.giftReceived}
時候の挨拶（必ず使用）: ${greeting}
関係性: ${input.relationship}
格式: ${input.formality}

【文体の指示】
格式: ${formalityGuide}
関係性: ${relationshipGuide}

【制約】
- 150〜250字（頭語・結語含む）
- ハガキ1枚に収まる長さ
- 品物名（${input.giftReceived}）を必ず含む
- 時候の挨拶（${greeting}）で書き始める

【出力フォーマット（JSONのみ）】
{
  "body": "礼状本文（頭語〜結語まで全文）",
  "greeting": "使用した時候の挨拶"
}`,
      },
    ],
  });

  const responseText =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON解析失敗');

  const parsed = JSON.parse(jsonMatch[0]) as { body: string; greeting: string };

  return {
    body: parsed.body,
    charCount: parsed.body.length,
    greeting: parsed.greeting,
  };
}
```

## バッチ処理（30社分を一気に生成）

```typescript
import * as fs from 'fs';

interface RecipientRecord {
  id: string;
  senderName: string;
  giftReceived: string;
  relationship: RelationshipType;
  formality: Formality;
}

async function generateBatchReisho(
  recipients: RecipientRecord[],
  month: number
): Promise<void> {
  const results: Array<RecipientRecord & ReishoResult> = [];

  for (const recipient of recipients) {
    const reisho = await generateReisho({ ...recipient, month });
    results.push({ ...recipient, ...reisho });

    console.log(`\n--- ${recipient.senderName} (${reisho.charCount}字) ---`);
    console.log(reisho.body);
  }

  fs.writeFileSync('reisho_output.json', JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\n${results.length}件の礼状を生成しました。`);
}

const recipients: RecipientRecord[] = JSON.parse(
  fs.readFileSync('recipients.json', 'utf-8')
);

await generateBatchReisho(recipients, 8); // 8月
```

`recipients.json` にExcelから変換した取引先リストを入れて実行するだけ。APIは直列で叩いているのでレート制限を気にしなくて済む。

## 実際の出力例

**入力（長年の取引先・丁寧格式）**:
```json
{
  "senderName": "株式会社○○水産 鈴木部長",
  "giftReceived": "三陸産 活き牡蠣（詰め合わせ12個入り）",
  "month": 8,
  "relationship": "長年の取引先",
  "formality": "丁寧"
}
```

**出力**:
```
謹啓　残暑の候、貴社ますますご隆盛のこととお慶び申し上げます。

このたびは、結構な三陸産活き牡蠣のお中元をご恵送賜り、誠にありがとうございます。お心遣いに深く感謝申し上げます。

平素より格別のお引き立てを賜り、厚く御礼申し上げます。今後ともご厚誼のほどよろしくお願い申し上げます。

まずは書中をもって御礼申し上げます。
　　　　　　　　　　　　　　　　　　謹白
（196字）
```

**入力（新規取引先・標準格式）**:
```json
{
  "senderName": "佐藤商店 佐藤様",
  "giftReceived": "気仙沼産 本カツオたたき（冷凍）",
  "month": 8,
  "relationship": "新規取引先",
  "formality": "標準"
}
```

**出力**:
```
拝啓　残暑の候、お変わりなくお過ごしのことと存じます。

このたびは、気仙沼産本カツオたたきのお中元をお贈りいただき、誠にありがとうございます。丁寧なお心遣いに恐縮しております。

今後ともどうぞよろしくお願い申し上げます。

　　　　　　　　　　　　　　　　　　　敬具
（152字）
```

関係性と格式によって文体・定型句・長さが自然に変わる。どちらも手直しなしで使えるレベルだった。

## ハガキへの出力

```typescript
function formatForPrint(
  result: RecipientRecord & ReishoResult
): string {
  return [
    `【${result.senderName} 様宛】`,
    result.body,
    `文字数: ${result.charCount}字`,
    '─'.repeat(40),
  ].join('\n');
}

const printText = results.map(formatForPrint).join('\n\n');
fs.writeFileSync('reisho_print.txt', printText, 'utf-8');
```

このテキストをWordに貼り付けて縦書き・A6サイズに設定するか、ラベル印刷ツールに渡すだけで印刷まで完結する。

## 結果

| 指標 | Before | After |
|------|--------|-------|
| 1社あたりの作成時間 | 10〜15分 | 1分（確認込み） |
| 30社分の合計時間 | 約4〜6時間 | 約30分（生成10分＋確認・印刷20分） |
| 時候の挨拶の調べ直し | 毎回必要 | 不要 |
| 文体への不安 | 毎回ある | ほぼなし |

業者さんの感想：「毎年これが憂鬱だったんですが、今年は余裕で終わりました」

## コスト

| 項目 | 数値 |
|------|------|
| 入力トークン（1件平均） | 約500 |
| 出力トークン（1件平均） | 約300 |
| 1件あたりコスト | 約1円 |
| 30件の合計 | **約30円** |

礼状テンプレ本を買う費用より安い。

## まとめ

礼状は「フォーマットがある程度決まっているのに毎回手間がかかる」という典型的なAI向けの作業だった。

時候の挨拶・頭語結語のルールをコードに事前に組み込んでおけば、Claudeは与えられた制約の中で格式のある文章をきちんと生成する。人間がやると「この表現で大丈夫か？」と迷うところも、Claudeは迷わない。

お中元が終わったらお歳暮がある。同じシステムで12月分も対応できる。

次は礼状の宛名面（郵便番号・住所・氏名の縦書きフォーマット）の自動生成も組み込む予定。

コードの利用・相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）へどうぞ。
