---
title: "Claude APIで「イクラ・筋子シーズン」の仕込み中投稿から先行予約メールまで自動生成した話【三陸水産EC】"
description: "秋鮭が入ると筋子（生）も来る。でも仕込みに2日かかるうえ在庫が読めず、コンテンツ準備が毎年後手に回っていた。「仕込み中の期待感」と「予約受付開始」を連動させたコンテンツをClaudeで自動化した実装を公開する。"
pubDate: 2026-09-23
author: sam
category: "Claude活用"
tags: ["Claude", "EC自動化", "メールマーケティング", "イクラ", "筋子", "秋鮭", "水産業", "季節キャンペーン", "Shopify", "SNS"]
readingTime: 9
---

## 「筋子が入ってきたんですが、今から仕込んで明後日には売れます？」

[秋鮭の初物メール](/blog/claude-autumn-salmon-first-catch-email)の仕組みを入れてすぐ、別の業者さんから電話が来た。

「今年の筋子が今朝届いたんです。今から醤油漬けにして、明後日の朝には販売できる状態にします。でも去年は仕込んでる間にコンテンツ準備が追いつかなくて、販売開始してから慌ててメール送ったんですよね。お客さんに『もう売り切れ』って言われて。今年は仕込み中から発信したくて」

これは典型的な「旬もの特有のタイムライン問題」だ。

- **仕込みに2日かかる** → でもその2日間こそ「期待感を高めるチャンス」
- **在庫が読めない** → 筋子の仕込み歩留まりは7〜8割なので、確定在庫が分かるのは仕込み完了後
- **賞味期限が短い** → 冷蔵で5〜7日しかないため、販売開始と同時に購買を促さないと余る

**「仕込み中の投稿→予約受付メール→販売開始メール」を一連の流れで事前に準備する**仕組みをClaudeで作った。

## 作ったもの

3フェーズで自動生成した。

1. **仕込み中コンテンツ**（X・Instagramで期待感を高める「仕込み始めました」投稿）
2. **先行予約メール**（過去にイクラを購入した顧客向けの限定先行案内）
3. **販売開始コンテンツ**（商品説明文・X告知・Instagram投稿）

## 実装コード

### 1. 型定義と仕入れ情報

```typescript
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';

const client = new Anthropic();

interface IkuraBatch {
  salmonOrigin: string;        // "三陸・気仙沼産 秋鮭"
  salmonWeight: string;        // "約120kg（本）"
  roeMassKg: number;           // 筋子の重量（kg）
  expectedYieldKg: number;     // 仕込み後のイクラ見込み量（kg）
  marinadeType: string;        // "醤油漬け（当店秘伝だれ）"
  soakingStartDate: string;    // "2026-09-23"
  salesStartDate: string;      // "2026-09-25"
  expiryDays: number;          // 5
  sellingPricePer100g: number; // 1480
  repeatBuyerCount: number;    // 昨年のリピーター数
  gramOptions: number[];       // [100, 200, 500]
}

const batch: IkuraBatch = {
  salmonOrigin: '三陸・気仙沼産 秋鮭',
  salmonWeight: '約120kg（22本）',
  roeMassKg: 14.8,
  expectedYieldKg: 11.5,
  marinadeType: '醤油漬け（当店秘伝だれ）',
  soakingStartDate: '2026-09-23',
  salesStartDate: '2026-09-25',
  expiryDays: 5,
  sellingPricePer100g: 1480,
  repeatBuyerCount: 87,
  gramOptions: [100, 200, 500],
};
```

### 2. 仕込み中SNSコンテンツを生成する

```typescript
interface SoakingContent {
  xPost: string;
  xHashtags: string;
  instagramCaption: string;
  instagramHashtags: string;
  instagramDay2Caption: string;  // 翌日の「もう少しで完成」投稿
}

async function generateSoakingContent(
  batch: IkuraBatch
): Promise<SoakingContent> {
  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: `水産ECの「イクラ醤油漬け仕込み中」SNS投稿を生成してください。

【仕込み情報】
鮭の産地: ${batch.salmonOrigin}
筋子重量: ${batch.roeMassKg}kg
仕込み方法: ${batch.marinadeType}
仕込み開始: ${batch.soakingStartDate}
販売開始予定: ${batch.salesStartDate}

【条件】
X投稿（1日目 / 仕込み開始当日）:
- 「今朝届いた筋子を仕込み始めました」という臨場感
- 完成を楽しみにしてもらう締め
- 120文字以内

Xハッシュタグ: 5〜6個（#イクラ は必須）

Instagram（1日目）:
- 筋子をほぐして醤油だれに漬ける工程の描写
- 「こういう手仕事の積み重ねで出来ている」という文脈を入れる
- 250文字以内

Instagram（2日目 / 完成前日）:
- 「明日販売開始です」という告知を自然に組み込む
- 待ってくれているお客さんへのメッセージ
- 200文字以内

Instagramハッシュタグ: 8〜10個

【出力（JSONのみ）】
{
  "xPost": "...",
  "xHashtags": "...",
  "instagramCaption": "...",
  "instagramHashtags": "...",
  "instagramDay2Caption": "..."
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('仕込み中コンテンツのJSON解析失敗');
  return JSON.parse(jsonMatch[0]) as SoakingContent;
}
```

### 3. 先行予約メールを生成する

```typescript
interface PreorderEmail {
  subject: string;
  body: string;
  lineShortVersion: string;
}

async function generatePreorderEmail(
  batch: IkuraBatch
): Promise<PreorderEmail> {
  const totalGrams = Math.floor(batch.expectedYieldKg * 1000);
  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: `水産ECの「イクラ先行予約」メールを生成してください。
過去にイクラを購入したことがある${batch.repeatBuyerCount}名への限定案内です。

【仕込み情報】
産地: ${batch.salmonOrigin}
今シーズン仕込み総量（見込み）: 約${totalGrams}g
販売グラム展開: ${batch.gramOptions.join('g・')}g
100gあたり税込: ${batch.sellingPricePer100g.toLocaleString()}円
賞味期限: 冷蔵${batch.expiryDays}日
販売開始予定: ${batch.salesStartDate}

【条件】
- 件名30文字以内
- 本文250〜350文字
- 「今シーズン限り・数量限定」という希少感を自然に伝える
- 昨年購入したことへの感謝を1文入れる
- 仕込み中のリアルを短く添える（コンテンツが信頼感になる）
- 早期予約特典（500g以上で送料無料）を明記
- URLプレースホルダーは {{preorder_url}}
- 「新鮮」「最高」「絶品」「プレミアム」は使わない

【出力（JSONのみ）】
{
  "subject": "件名",
  "body": "本文",
  "lineShortVersion": "LINE用短縮版（100文字以内）"
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('先行予約メールのJSON解析失敗');
  return JSON.parse(jsonMatch[0]) as PreorderEmail;
}
```

### 4. 販売開始コンテンツを生成する

```typescript
interface SalesLaunchContent {
  shopifyDescription: string;
  xLaunchPost: string;
  xHashtags: string;
  instagramLaunchCaption: string;
  instagramHashtags: string;
  launchEmailSubject: string;
  launchEmailBody: string;
}

async function generateSalesLaunchContent(
  batch: IkuraBatch
): Promise<SalesLaunchContent> {
  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2500,
    messages: [
      {
        role: 'user',
        content: `水産ECのイクラ醤油漬け「販売開始」コンテンツを一括生成してください。

【商品情報】
産地: ${batch.salmonOrigin}
仕込み方法: ${batch.marinadeType}
グラム展開: ${batch.gramOptions.join('g・')}g
100gあたり税込: ${batch.sellingPricePer100g.toLocaleString()}円
賞味期限: 冷蔵${batch.expiryDays}日
今シーズン限定品

【各コンテンツの条件】

Shopify商品説明文（HTML）:
- <h3>タグと<p>タグを使う
- 「産地と仕込みの背景」→「味の特徴」→「使い方（イクラ丼・茶漬け・軍艦）」→「賞味期限・保存方法」の順
- 300〜400文字相当の情報量

X販売開始告知（120文字以内）:
- 「本日より販売開始」の明確な宣言
- 数量限定の緊張感

Xハッシュタグ: 5〜6個

Instagram販売開始キャプション（250文字以内）:
- 2日間の仕込みが終わって完成した達成感
- 食べる場面（イクラ丼の朝ごはん）を想起させる

Instagramハッシュタグ: 8〜10個

販売開始メール件名（25文字以内）

販売開始メール本文（200〜280文字）:
- 先行予約のお礼（購入者へ）と一般販売の告知（未購入者へ）の両方に使えるバージョン
- URLプレースホルダーは {{sales_url}}

【出力（JSONのみ）】
{
  "shopifyDescription": "...",
  "xLaunchPost": "...",
  "xHashtags": "...",
  "instagramLaunchCaption": "...",
  "instagramHashtags": "...",
  "launchEmailSubject": "...",
  "launchEmailBody": "..."
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('販売開始コンテンツのJSON解析失敗');
  return JSON.parse(jsonMatch[0]) as SalesLaunchContent;
}
```

### 5. 実行スクリプト

```typescript
async function main() {
  console.log('🐟 イクラシーズンキャンペーン自動生成開始...\n');

  console.log('📱 仕込み中SNSコンテンツを生成中...');
  const soakingContent = await generateSoakingContent(batch);
  console.log(`X投稿: ${soakingContent.xPost.slice(0, 50)}...`);

  console.log('\n✉️ 先行予約メールを生成中...');
  const preorderEmail = await generatePreorderEmail(batch);
  console.log(`件名: ${preorderEmail.subject}`);

  console.log('\n🛍️ 販売開始コンテンツを生成中...');
  const launchContent = await generateSalesLaunchContent(batch);
  console.log(`販売開始メール件名: ${launchContent.launchEmailSubject}`);

  const output = { soakingContent, preorderEmail, launchContent };
  fs.writeFileSync(
    'ikura-campaign-2026.json',
    JSON.stringify(output, null, 2),
    'utf-8'
  );
  console.log('\n✅ ikura-campaign-2026.json に保存完了');
}

main().catch(console.error);
```

## 実際に生成された内容

### 仕込み中X投稿（生成例）

```
今朝届いた気仙沼産秋鮭の筋子を、秘伝の醤油だれに漬け込みました。
仕込みに2日かかります。明後日の朝、いくらとして届けます。
少量なのでお早めに。

#イクラ #筋子 #三陸 #気仙沼 #秋鮭 #醤油漬け
```

### 仕込み中Instagram（1日目・生成例）

```
今年もこの季節が来ました。

一粒ずつ手でほぐした筋子を、うちの秘伝の醤油だれに漬け込んでいます。
だれは昆布・酒・みりんをベースにしたもので、加減は毎年、鮭の状態を見ながら職人が調整します。

イクラは仕込みが全て。産地の良さを活かすか殺すかは、漬ける時間とだれの濃度で決まります。
2日後の完成をお楽しみに。

#イクラ #醤油漬け #手仕事 #気仙沼 #三陸 #秋鮭 #水産 #お取り寄せ
```

### 先行予約メール（生成例）

```
件名: 【限定87名様】今シーズンのいくらが仕込み中です

昨年ご購入いただいた皆さまへ、一足先にご案内します。

今年も気仙沼産秋鮭の筋子が入荷し、昨日から醤油漬けの仕込みを始めました。
今シーズンの仕込み量は約11.5kg。100g・200g・500gの3展開で、
9月25日（木）朝より販売を開始します。

賞味期限が冷蔵5日と短いため、ご予約いただけると当日発送でお届けできます。
500g以上のご予約は、送料無料でご案内します。

▶ 先行予約はこちら: {{preorder_url}}

数量に限りがございますので、お早めにどうぞ。
```

### Shopify商品説明文（生成例）

```html
<h3>気仙沼産秋鮭のいくら醤油漬け</h3>
<p>今シーズンの気仙沼産秋鮭から取れた筋子を、当店秘伝の醤油だれで仕込みました。
昆布・酒・みりんをベースにしただれに、一粒ずつほぐした卵を2日間漬け込んでいます。
加熱処理なし。冷蔵5日以内にお召し上がりください。</p>

<h3>味の特徴</h3>
<p>塩気よりもだしの旨みが先に来る、やや控えめな味付けです。
いくらそのものの味を邪魔しない仕上がりで、温かいご飯の上に乗せると
粒が弾けて旨みが広がります。</p>

<h3>おすすめの食べ方</h3>
<ul>
  <li><strong>いくら丼</strong>：温かいご飯に乗せて、わさびと海苔を添えて</li>
  <li><strong>いくら茶漬け</strong>：熱いだしをかけて。朝ごはんに最適</li>
  <li><strong>軍艦巻き</strong>：すし飯と合わせて、手巻きパーティーに</li>
</ul>
```

### 販売開始X投稿（生成例）

```
【本日販売開始】気仙沼産秋鮭のいくら醤油漬け、完成しました。

2日間の仕込みが終わり、今朝から発送できます。
今シーズン限定・約11.5kgのみ。

#イクラ #気仙沼 #秋鮭 #三陸 #醤油漬け #お取り寄せ
```

## コストと効果

**APIコスト（1シーズン分一括生成）**

| 処理 | トークン数（概算） | コスト |
|------|------------------|--------|
| 仕込み中SNSコンテンツ | 入力800＋出力1,200 | 約0.9円 |
| 先行予約メール | 入力900＋出力1,000 | 約0.9円 |
| 販売開始コンテンツ | 入力1,200＋出力2,500 | 約1.8円 |
| 合計 | | **約3.6円** |

**工数削減**

| 作業 | Before（手動） | After（Claude API） |
|------|--------------|-------------------|
| 仕込み中投稿2本作成 | 約30分 | 1分（確認のみ） |
| 先行予約メール1通作成 | 約45分 | 1分（確認のみ） |
| 販売開始コンテンツ一式 | 約1.5時間 | 3分（確認のみ） |
| 合計 | 約2.5時間 | **約5分** |

**業者さんの一言：**
「去年は販売開始当日になってもコンテンツが揃わなくて、筋子が届いたのに何も発信できない時間があったんです。今年は筋子が届く前日に全部準備が終わってて、届いた瞬間にXに投稿できた。お客さんから『仕込みの写真が好き』って言われて、コンテンツとして機能してるなと実感しました」

## ポイントと注意点

**うまくいった点**
- 「仕込み中→予約→販売開始」の3ステップをひとつのスクリプトで一括生成したので、タイムラインのつながりが自然になった
- `expiryDays: 5` という数値を渡したことで、告知文に「冷蔵5日」という具体的な情報が自動で含まれた
- 仕込み中コンテンツに工程の描写（「一粒ずつほぐす」「だれに2日漬ける」）が入ったことで、単なる告知より信頼感が出た

**注意点**
- 筋子の仕込み歩留まりは実際にやってみないと分からない（14.8kg → 11.5kg想定が実際は12.2kgになることもある）。`expectedYieldKg` は控えめに入力し、超えた分は追加販売の喜びに変える運用が安全
- 賞味期限が短いため、仕込み完了日の午前中には販売開始・メール配信できるよう段取りを組む。午後にずれると冷蔵5日が実質4日になる
- SNS投稿の「仕込み写真」が有効なので、実際の仕込み作業中に数枚撮影しておく。テキストだけより格段にエンゲージメントが上がる

## まとめ

イクラシーズンは「筋子入荷→仕込み（2日）→販売開始（5日間）→完売」という短い時間軸で動く。この間に「仕込み中の期待感づくり」「先行予約獲得」「販売開始の一斉告知」という3段階のコミュニケーションをこなす必要がある。

手動でやると2〜3時間かかる作業が、Claude APIを使えば3.6円・5分で終わる。さらに「筋子が届く前日に全準備完了」できるので、当日は仕込みと写真撮影だけに集中できる。

旬ものの水産ECは「鮮度」だけでなく「コミュニケーションの鮮度」も問われる。仕込み中から発信し始めて、完成→即販売という流れをClaudeで自動化しておくと、毎年のイクラシーズンが劇的に楽になる。

コード・カスタマイズ相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。次はイクラのリピーター向け「来年の予約登録」仕組みを書く予定。
