---
title: "Claude APIで水産ECのX（Twitter）投稿文を自動生成した話"
description: "毎朝の「今日の水揚げ情報」投稿を手動でやめた。Claude APIに魚種・数量・産地を渡すだけで、売れるポスト文が10秒で出てくる仕組みを作った話。"
pubDate: 2026-08-15
author: sam
category: "Claude活用"
tags: ["Claude", "X", "Twitter", "SNS", "水産EC", "自動化", "コンテンツ生成"]
readingTime: 6
---

## 問題：毎朝の投稿が義務になっていた

気仙沼の業者さんから相談を受けた。

「Instagramは写真があるから投稿しやすいけど、Xはテキスト勝負なんで毎日悩む。朝、水揚げ情報が届いてから投稿文を考えて…で30分くらい使ってる」

Xはインスタと違ってテキストの質が直接エンゲージメントに影響する。でも毎朝30分は重い。しかも在庫が出てから考えていたら、競合が先に投稿してしまう。

Claude APIに水揚げデータを渡して、そのまま投稿できるポスト文を出力させたら解決した。

## 作ったもの

水揚げ情報（魚種・数量・産地・価格）を入力すると：
- 本文投稿（280文字以内）
- リプライ用の補足ポスト（スレッド2件目）
- ハッシュタグセット

を生成するスクリプト。

## 実装コード

### 1. 投稿文を生成するコア関数

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface FishInfo {
  species: string;       // 魚種名
  quantity: string;      // 数量・規模感（「少量」「大漁」「今シーズン初」など）
  origin: string;        // 産地・漁場
  price?: string;        // 価格帯（省略可）
  condition?: string;    // 鮮度・状態の特記事項（省略可）
}

interface XPostSet {
  mainPost: string;       // メイン投稿（280文字以内）
  replyPost: string;      // スレッド2件目の補足
  hashtags: string[];     // ハッシュタグ配列
}

async function generateXPost(fish: FishInfo): Promise<XPostSet> {
  const today = new Date();
  const month = today.getMonth() + 1;
  const day = today.getDate();

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `あなたは三陸の水産ECサイトのSNS担当です。以下の水揚げ情報をもとに、X（Twitter）の投稿文セットを作ってください。

【水揚げ情報】
- 魚種：${fish.species}
- 数量・状況：${fish.quantity}
- 産地：${fish.origin}
${fish.price ? `- 価格帯：${fish.price}` : ''}
${fish.condition ? `- 状態：${fish.condition}` : ''}
- 投稿日：${month}月${day}日

【作成ルール】
1. mainPost（メイン投稿）：
   - 280文字以内（日本語・記号含む）
   - 最初の1〜2行で「今日の目玉」を伝える
   - 旬・産地・鮮度の強みを具体的に
   - 絵文字1〜2個まで（魚・海系が好ましい）
   - URLや価格は含めない（スレッドに回す）
   - 「ご注文はこちら」「詳しくはリンク」などCTA文は不要

2. replyPost（スレッド2件目の補足）：
   - 100〜150文字
   - 産地のこだわりや食べ方のひと言アドバイス
   - 「👉 商品ページ：[URL]」を最後に入れるプレースホルダー

3. hashtags：
   - 5〜7個の配列
   - 魚種名・産地名・季節ワードを含む
   - #三陸 #気仙沼 を必ず含む

【出力フォーマット（JSONのみ、説明不要）】
{
  "mainPost": "...",
  "replyPost": "...",
  "hashtags": ["#三陸", "..."]
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON parse failed');

  return JSON.parse(jsonMatch[0]) as XPostSet;
}
```

### 2. バリアント生成（A/Bテスト用）

同じ情報から複数のトーンで生成して選べるようにする：

```typescript
type PostTone = '熱量系' | '丁寧系' | '情報系';

async function generateVariants(
  fish: FishInfo,
  tones: PostTone[] = ['熱量系', '丁寧系', '情報系']
): Promise<Record<PostTone, XPostSet>> {
  const toneInstructions: Record<PostTone, string> = {
    熱量系: '漁師の言葉・現場感を前面に。テンションは高め。「今朝水揚げしたばっかり」系。',
    丁寧系: '上品で信頼感がある語り口。贈り物需要も意識。「三陸の豊かな海が育てた」系。',
    情報系: '数字・産地・旬の時期を事実ベースで淡々と。「今シーズン初水揚げ、数量限定」系。',
  };

  const results = await Promise.all(
    tones.map(async (tone) => {
      const post = await generateXPostWithTone(fish, toneInstructions[tone]);
      return [tone, post] as [PostTone, XPostSet];
    })
  );

  return Object.fromEntries(results) as Record<PostTone, XPostSet>;
}

async function generateXPostWithTone(
  fish: FishInfo,
  toneInstruction: string
): Promise<XPostSet> {
  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `${toneInstruction}

魚種：${fish.species}、産地：${fish.origin}、状況：${fish.quantity}
${fish.condition ? `状態：${fish.condition}` : ''}

X投稿文セットをJSON形式で。mainPost（280字以内）、replyPost（100〜150字）、hashtags（5〜7個）。
JSONのみ出力。`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('parse error');

  return JSON.parse(jsonMatch[0]) as XPostSet;
}
```

### 3. 実際の出力例

```typescript
const fish: FishInfo = {
  species: 'カツオ',
  quantity: '今シーズン初水揚げ・少量',
  origin: '三陸沖',
  condition: '生・即日発送対応',
};

const post = await generateXPost(fish);
console.log(post);
```

**出力（熱量系）：**

```
mainPost:
🎣 三陸沖のカツオ、今シーズン初水揚げきました！
少量だけど鮮度は最高レベル。朝に揚がったものを今日中に発送。
藁焼きでもたたきでも、この時期のカツオはやっぱり違う。

replyPost:
三陸沖は栄養豊富な親潮と黒潮がぶつかる絶好の漁場。
初ガツオは身が引き締まって脂のりが上品。薬味だけで十分うまい。
👉 商品ページ：[URL]

hashtags: ["#三陸", "#気仙沼", "#カツオ", "#初鰹", "#生カツオ", "#旬魚", "#産直水産"]
```

**出力（丁寧系）：**

```
mainPost:
🐟 本日、三陸沖より初夏のカツオが初水揚げされました。
数量限定ではございますが、朝獲れの活きのよい状態で
丁寧にお届けします。この季節ならではの味わいをぜひ。

replyPost:
親潮と黒潮が交わる三陸沖のカツオは、引き締まった身と
上品な脂が特徴です。カルパッチョや塩たたきでもおすすめ。
👉 商品ページ：[URL]

hashtags: ["#三陸", "#気仙沼", "#カツオ", "#初鰹", "#旬の魚", "#産地直送", "#贈り物"]
```

### 4. 定期実行スクリプト（朝の水揚げデータと連携）

CSVやスプレッドシートから読み込んで毎朝自動生成：

```typescript
import * as fs from 'fs';
import { parse } from 'csv-parse/sync';

interface HarvestRow {
  species: string;
  quantity: string;
  origin: string;
  price: string;
  condition: string;
}

async function generateFromCSV(csvPath: string): Promise<void> {
  const raw = fs.readFileSync(csvPath, 'utf-8');
  const rows = parse(raw, { columns: true }) as HarvestRow[];

  const outputLines: string[] = ['# 本日の投稿候補', ''];

  for (const row of rows) {
    const fish: FishInfo = {
      species: row.species,
      quantity: row.quantity,
      origin: row.origin,
      price: row.price,
      condition: row.condition,
    };

    const post = await generateXPost(fish);
    const tags = post.hashtags.join(' ');

    outputLines.push(`## ${row.species}`);
    outputLines.push('### メイン投稿');
    outputLines.push(post.mainPost);
    outputLines.push('');
    outputLines.push('### スレッド2件目');
    outputLines.push(post.replyPost);
    outputLines.push('');
    outputLines.push(`**タグ：** ${tags}`);
    outputLines.push('---');
    outputLines.push('');
  }

  const date = new Date().toISOString().split('T')[0];
  const outputPath = `posts-${date}.md`;
  fs.writeFileSync(outputPath, outputLines.join('\n'));
  console.log(`✅ 投稿候補を保存: ${outputPath}`);
}

// 使用例
await generateFromCSV('harvest-today.csv');
```

## コストと効果

**APIコスト試算（1魚種あたり）**

| 項目 | 数値 |
|------|------|
| 入力トークン | 約400 |
| 出力トークン | 約300 |
| 1投稿セット生成コスト | 約0.3円 |
| 3バリアント生成時 | 約0.9円 |

**時間削減**

| 作業 | Before | After |
|------|--------|-------|
| 投稿文考える | 30分/日 | 確認・選択のみ（3〜5分） |
| エンゲージメント | ばらつきが大きい | トーン選択で安定化 |

**業者さんの感想：**「朝の仕込み中に水揚げデータを入れておくと、作業終わった頃には投稿文が出来てる。考える時間がゼロになった」

## ポイントと工夫

**うまくいった点**
- バリアント生成でA/Bテストがしやすくなった
- 「熱量系」が常時7〜8割のエンゲージメントを取る（ユーザーによっては丁寧系が合う）
- スレッド設計で食べ方情報も自然に入る

**注意点**
- 280文字制限はプロンプトに明示してもオーバーする場合がある → 生成後に `mainPost.length <= 280` でチェックを入れると安心
- ハッシュタグはトレンドで変わるので月1回くらい見直す
- 「ご注文はリンクから」系のCTAは投稿よりスレッドに置く方がリーチが伸びやすい（インプレッション計測で分かった）

## まとめ

毎朝の「投稿文を考える30分」が、「どのトーンにするか選ぶ3分」に変わった。

水産ECは在庫と鮮度が命で、水揚げから投稿まで速さが重要。Claude APIを挟んでも10秒で生成できるので、競合に先んじて投稿できるようになった。

Instagramは写真で勝負できるがXはテキスト。魚の現場感・旬・産地のこだわりをテキストで伝えるのが苦手な業者さんほど効果が出やすい実装。

コード・カスタマイズ相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
