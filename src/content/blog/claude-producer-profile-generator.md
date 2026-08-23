---
title: "Claude APIで生産者プロフィール文を自動生成した話【直販ECの信頼感アップ】"
description: "漁師さんや農家さんが直販ECを始めるとき、一番後回しになるのが自己紹介文。ヒアリングした内容をClaudeに投げたら、読む人の心をつかむプロフィールが5分で完成した話。"
pubDate: 2026-08-23
author: sam
category: "Claude活用"
tags: ["Claude", "EC", "生産者プロフィール", "直販", "自動化", "コピーライティング"]
readingTime: 6
---

## 課題：自己紹介が一番書けない

直販ECの立ち上げを手伝っていると、必ずここで詰まる。

「商品ページは頑張れるんですけど、自分のことを書くのが…」

気仙沼で30年カツオ漁を続けてきた船長さんでも、南三陸で無農薬野菜を作っている農家さんでも、同じ反応。プロとして誇れる実績があるのに、それを言葉にするのが難しい。

結果、「代表の〇〇です。よろしくお願いします。」で終わる。

**消費者は生産者を買っている**のに、生産者の顔が見えない。

Claude APIにヒアリング内容を投げたら、この問題が解決した。

## 作ったもの

簡単なヒアリングシート（10問程度）への回答をインプットすると：

- メインの生産者プロフィール文（EC掲載用・400字程度）
- 短縮版（SNSプロフィール用・100字以内）
- 一人称の語りかけ文（メルマガ・LINEメッセージ用）

の3バリエーションを出力するスクリプト。

## ヒアリングシートの設計

まず、Claude APIに渡す前の「素材集め」が重要。こんな質問を事前に用意した：

```
1. お名前・屋号・拠点（地域）
2. 何を作っている/獲っているか
3. この仕事を始めたきっかけ・継いだ理由
4. 一番こだわっているポイント（製法・原料・技術など）
5. 地元や環境との関わり（漁協活動、地域の取り組みなど）
6. お客さんに一番喜ばれること
7. 大変だったエピソード（失敗や苦労）
8. これからやりたいこと・夢
9. 家族構成・趣味（人柄が伝わる要素）
10. 一言でいうと、どんな人ですか？
```

このシートをLINEやGoogleフォームで事前に送っておき、回答をそのままAPIに渡す。

## 実装コード

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface ProducerInfo {
  name: string;
  shopName?: string;
  region: string;
  product: string;
  career: string;
  commitment: string;
  localRelation?: string;
  customerJoy: string;
  hardship?: string;
  dream?: string;
  personality?: string;
  selfDescription?: string;
}

interface ProfileOutput {
  main: string;        // EC掲載用・400字
  short: string;       // SNS用・100字以内
  casual: string;      // メルマガ・LINE用（一人称）
}

async function generateProducerProfile(
  producer: ProducerInfo
): Promise<ProfileOutput> {
  const infoText = `
名前: ${producer.name}
屋号: ${producer.shopName ?? 'なし'}
拠点: ${producer.region}
生産物: ${producer.product}
経歴・きっかけ: ${producer.career}
こだわり: ${producer.commitment}
地域との関わり: ${producer.localRelation ?? '特になし'}
お客さんに喜ばれること: ${producer.customerJoy}
大変だったエピソード: ${producer.hardship ?? 'なし'}
夢・展望: ${producer.dream ?? 'なし'}
人柄・趣味: ${producer.personality ?? 'なし'}
自己定義: ${producer.selfDescription ?? 'なし'}
`.trim();

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: `あなたは地方産品の直販ECに特化したコピーライターです。
以下の生産者情報をもとに、消費者の信頼を得るプロフィール文を3パターン作成してください。

【生産者情報】
${infoText}

【作成するプロフィール】

## 1. メインプロフィール（EC掲載用）
- 400字程度
- 三人称（「〇〇さんは〜」ではなく「私は〜」でも可。ECサイトの文体に合わせる）
- 生産へのこだわりと人柄が伝わる内容
- 地域・自然との関係を入れる
- 読んだ人が「この人から買いたい」と思える温度感

## 2. 短縮版（SNSプロフィール用）
- 100字以内
- 絵文字は使わない
- 職業・地域・こだわりの3要素を凝縮

## 3. 語りかけ文（メルマガ・LINE用）
- 200字程度
- 一人称（「私は」「うちでは」）
- 初めてメッセージを受け取った人へ話しかけるような温度感
- 購読のお礼と自己紹介を兼ねる

出力は以下のJSON形式のみで返してください：
{
  "main": "（メインプロフィール本文）",
  "short": "（短縮版本文）",
  "casual": "（語りかけ文本文）"
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSONパース失敗');

  return JSON.parse(jsonMatch[0]) as ProfileOutput;
}
```

## 使用例（気仙沼の漁師さん）

```typescript
const result = await generateProducerProfile({
  name: '佐藤 一郎',
  shopName: '気仙沼 佐藤水産',
  region: '宮城県気仙沼市',
  product: '本カツオたたき・めかじき切り身・サンマ開き（冷凍）',
  career: '父の船に18歳から乗り、28歳で独立。以来25年間カツオ漁を続けている。',
  commitment:
    '水揚げ当日に加工・冷凍する鮮度管理。化学調味料・保存料は一切使わない。',
  localRelation: '気仙沼漁協の組合員。震災後の港復興活動にも10年携わってきた。',
  customerJoy: '「スーパーのカツオとは別物」「毎年リピートしている」という声',
  hardship: '2011年の震災で船と加工場を失い、ゼロから再建した。',
  dream: '息子に漁業を継いでほしい。三陸の魚を全国の食卓に届け続けたい。',
  personality: '妻と二人の子供。休日は釣り（仕事と同じだが楽しい）。',
  selfDescription: '海が職場の、頑固な魚好き。',
});

console.log('=== メインプロフィール ===');
console.log(result.main);
console.log('\n=== SNS用 ===');
console.log(result.short);
console.log('\n=== メルマガ・LINE用 ===');
console.log(result.casual);
```

## 実際の出力例

```
=== メインプロフィール ===
宮城県気仙沼港で25年、カツオを追い続けています。18歳で父の船に乗り込み、
三陸の海を体で覚えてきました。

こだわりは「水揚げ当日加工・即冷凍」。鮮度が命の魚を、一番おいしい状態で
届けるために、化学調味料・保存料は一切使いません。手間はかかりますが、
それが三陸の海への誠意だと思っています。

2011年の震災で船も加工場も失いましたが、地域のみなさんと一緒に10年かけて
港を再建してきました。「あの頃の三陸の味が戻ってきた」とお客さんに言ってもらえる
たびに、やっていてよかったと思います。

息子にこの仕事を継いでほしい。そのためにも、三陸の魚のおいしさをもっと
多くの人に知ってもらいたい。そんな思いで、直販を始めました。

=== SNS用 ===
宮城・気仙沼の漁師。水揚げ当日加工・無添加にこだわり25年。震災を乗り越えた
三陸の本カツオを、産地直送でお届けします。

=== メルマガ・LINE用 ===
はじめまして。気仙沼でカツオ漁を25年やっている佐藤と申します。
フォローいただきありがとうございます。

うちでは水揚げ当日に加工・冷凍した、添加物なしの三陸産魚介をお届けしています。
「スーパーとは別物だった」とよく言っていただけるのが、一番の励みです。

旬の情報やお得なセット情報を不定期でお送りします。よろしくお願いします。
```

## 複数パターンを比較する

気に入らなければ再生成も簡単。「もう少し硬め」「震災の話は省いて」など追記して再実行するだけ：

```typescript
async function generateWithVariation(
  producer: ProducerInfo,
  variation: string
): Promise<ProfileOutput> {
  // variation: "もう少し硬めの文体で" / "地域色を抑えて全国向けに" など
  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: `（同じプロンプト）\n\n【追加指示】${variation}`,
      },
    ],
  });
  // ...
}
```

## コストと時間

| 項目 | 数値 |
|------|------|
| 1生産者あたりのAPIコスト | 約1.5円 |
| ヒアリングから完成まで | 15〜20分（従来：2〜3時間） |
| 手直しの回数 | 平均1〜2回（ほぼそのまま使える） |

**生産者さんの感想：「自分のことなのに、自分では書けない言葉が出てきた」**

## 気をつけること

- ヒアリング内容が薄いと出力も薄くなる。質問への回答が1行なら追いヒアリングが必要
- 生産者本人に「自分の言葉に聞こえるか」を必ず確認してもらう
- 固有名詞（地名・商品名）は出力後に必ずチェック（たまに混ざる）
- 掲載前に「これ、自分が言いたいことと合ってますか？」と確認する一言が大切

## まとめ

生産者プロフィールは、商品ページと同じくらい購買の意思決定に影響する。

「この人から買いたい」という気持ちを作るのは、写真と文章だ。写真は生産者さん自身が撮れても、文章はプロでも難しい。そこをClaudeが橋渡しできる。

ヒアリングして素材を集めれば、あとはAPIが形にしてくれる。EC担当者がコピーライターでなくても、プロが書いたような紹介文が5分でできる。

直販ECを始めたばかりの生産者さんに、まず試してほしい実装です。

実装の相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
