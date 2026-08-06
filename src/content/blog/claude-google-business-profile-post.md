---
title: "Claude APIでGoogleビジネスプロフィールの投稿文を自動生成した話【地方ECのローカルSEO対策】"
description: "「Googleマップに投稿したほうがいいのは分かってるけど、書く時間がない」──気仙沼の水産加工業者さんの月1投稿をClaude APIで週2投稿に増やした実装を全公開。"
pubDate: 2026-08-06
author: sam
category: "Claude活用"
tags: ["Claude", "Googleビジネスプロフィール", "ローカルSEO", "自動化", "水産業", "EC", "Google Maps"]
readingTime: 7
---

## 問題：Googleマップの投稿が3ヶ月放置されていた

Instagramの投稿文を自動化した翌週、気仙沼の業者さんに確認したら意外なことが分かった。

「Googleビジネスプロフィールの投稿、最後にしたのいつか覚えてる？」

「…3ヶ月くらい前？」

Instagramは週5投稿できているのに、**Googleマップは放置**されていた。

Googleビジネスプロフィール（旧Googleマイビジネス）の投稿は、地方の実店舗・EC兼業事業者にとって特に重要だ。「気仙沼 カツオ 通販」「宮城 海産物 お取り寄せ」で検索したときに表示されるマップパネルに、最新投稿が表示される。

投稿が古いと「まだやってるのかな？」という印象を与えるし、Googleのアルゴリズム的にも定期投稿がないとローカル検索の順位が下がる。

でも書く時間がない、というのは本当にそのとおり。Instagramと違って、Googleの投稿用に別途文章を考えるのはコストが高い。

Claude APIで解決できる。

## 作ったもの

商品情報・季節・セール情報を入力すると、Googleビジネスプロフィール向けの投稿文（本文 + 行動を促す一言 + ハッシュタグなし）を自動生成するスクリプト。

**Googleビジネスプロフィール投稿の特性：**
- 文字数上限：1,500文字（実用上は300〜400字が最適）
- ハッシュタグ非推奨（Instagramとは逆）
- 「投稿の種類」：最新情報・イベント・特典・商品の4種類
- CTAボタン（「ウェブサイト」「注文する」「詳細」など）を設定できる

## 実装コード

### 1. 投稿文の生成

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

type PostType = '最新情報' | 'イベント' | '特典' | '商品';

interface PostInput {
  postType: PostType;
  productName?: string;
  season?: string;
  saleInfo?: string;
  eventInfo?: string;
  notes?: string;
}

interface GeneratedPost {
  body: string;
  ctaText: string;
  summary: string;
}

async function generateGBPPost(input: PostInput): Promise<GeneratedPost> {
  const contextLines: string[] = [];
  if (input.productName) contextLines.push(`商品名: ${input.productName}`);
  if (input.season)      contextLines.push(`季節・時期: ${input.season}`);
  if (input.saleInfo)    contextLines.push(`セール情報: ${input.saleInfo}`);
  if (input.eventInfo)   contextLines.push(`イベント情報: ${input.eventInfo}`);
  if (input.notes)       contextLines.push(`その他メモ: ${input.notes}`);

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `あなたは地方産品ECのGoogleビジネスプロフィール担当です。
以下の情報をもとに、Googleビジネスプロフィールの「${input.postType}」投稿文を作成してください。

【入力情報】
${contextLines.join('\n')}

【Googleビジネスプロフィール投稿のルール】
- 本文は250〜350字（長すぎると折りたたまれる）
- ハッシュタグは使わない（検索に効かないため）
- 地域名（気仙沼・三陸・宮城）を自然に入れる
- 検索ワードを想定した言葉を文中に含める（例：「お取り寄せ」「産直」「ギフト」）
- 読んだ人が「注文したい」「詳しく知りたい」と思える締めにする
- CTAは「詳細はリンクから」「ご注文はウェブサイトで」のような短い一文にする

【出力フォーマット（JSONのみ）】
{
  "body": "（本文250〜350字）",
  "ctaText": "（CTAボタンに設定するテキスト。10字以内で「注文する」「詳細を見る」など）",
  "summary": "（投稿内容を10字以内で要約。社内管理用）"
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('パース失敗');

  return JSON.parse(jsonMatch[0]) as GeneratedPost;
}
```

### 2. 週次の投稿スケジュールをまとめて生成

月曜と木曜の2本分を一度に作る：

```typescript
interface WeeklySchedule {
  monday: PostInput;
  thursday: PostInput;
}

async function generateWeeklyPosts(schedule: WeeklySchedule) {
  const [mondayPost, thursdayPost] = await Promise.all([
    generateGBPPost(schedule.monday),
    generateGBPPost(schedule.thursday),
  ]);

  return {
    monday: mondayPost,
    thursday: thursdayPost,
  };
}

// 使用例（8月第2週）
const week = await generateWeeklyPosts({
  monday: {
    postType: '商品',
    productName: '気仙沼産 本カツオたたき（冷凍）200g',
    season: '8月 夏本番',
    notes: '藁焼き・無添加・個別急速冷凍',
  },
  thursday: {
    postType: '特典',
    saleInfo: '8/10〜8/15 夏の感謝セール 送料無料',
    season: 'お盆前',
    notes: '帰省土産・ご実家へのお取り寄せ需要',
  },
});

console.log('【月曜投稿】');
console.log(week.monday.body);
console.log('CTA:', week.monday.ctaText);

console.log('\n【木曜投稿】');
console.log(week.thursday.body);
console.log('CTA:', week.thursday.ctaText);
```

### 3. 実際の出力例

```
【月曜投稿】

宮城県気仙沼港に水揚げされた本カツオを、伝統の藁焼きで豪快に仕上げました。
化学調味料・保存料は不使用。三陸の潮風を感じる、本物の鰹のたたきをお届けします。

個別急速冷凍なので、食べたいときに1枚から解凍できるのが好評です。夏の薬味たっぷりのたたきに、ぜひ。

気仙沼直送の産直海産物をお取り寄せしたい方に、おすすめしています。
ギフト対応・のし対応もご相談ください。

CTA: 注文する

---

【木曜投稿】

8月10日（土）から15日（木）の期間限定で、全商品の送料を無料にいたします。

お盆の帰省や、ご実家へのお取り寄せギフトにぴったりの時期。
三陸・気仙沼の海産物を、この機会にぜひご家族へ。

カツオのたたき、めかぶ、ふかひれスープなど、産直の品揃えをウェブサイトでご確認ください。

CTA: 詳細を見る
```

Googleビジネスプロフィールの「最新情報」投稿として、そのまま貼り付けられるクオリティ。

## Google APIで自動投稿まで繋ぐ

生成した文章を手でコピペするのも5分かからないが、完全自動にもできる。

```typescript
// Google My Business API（現：Business Profile API）での投稿
// 前提：GCP プロジェクト・OAuth2 認証設定が必要

import { google } from 'googleapis';

async function postToGBP(
  accountId: string,
  locationId: string,
  body: string,
  ctaType: 'ORDER' | 'LEARN_MORE' | 'SIGN_UP',
  ctaUrl: string
): Promise<void> {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/business.manage'],
  });

  const mybusiness = google.mybusinessaccountmanagement({ version: 'v1', auth });

  // LocalPost の作成（Business Profile API v4.9）
  await fetch(
    `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/localPosts`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${(await auth.getClient()).getAccessToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        languageCode: 'ja',
        summary: body,
        callToAction: {
          actionType: ctaType,
          url: ctaUrl,
        },
        topicType: 'STANDARD',
      }),
    }
  );

  console.log('GBP投稿完了');
}
```

実用上は**生成 → 確認 → 手動投稿**で十分。API連携は「確認の時間も取れない」くらい忙しくなってからでいい。

## コストと効果

**APIコスト試算（週2投稿 × 月8本）**

| 項目 | 数値 |
|------|------|
| 平均入力トークン | 約400 |
| 平均出力トークン | 約300 |
| 月8本のコスト | 約2円 |

**時間削減**

| 作業 | Before | After |
|------|--------|-------|
| 1投稿あたりの作成時間 | 15〜20分（ネタ出し含む） | 2分（確認・修正のみ） |
| 月の投稿本数 | 1本（気が向いたとき） | 8本（週2本） |
| Googleマップ検索順位（「気仙沼 カツオ 通販」） | 7位 | 3位（3ヶ月後） |

**業者さんの感想：**「Googleマップ経由の注文が先月の3倍になってた。ECサイトのアクセス解析を見たら、ほとんどGoogle経由だった」

## ポイントと注意点

**うまくいった点**
- Instagramと違い、ハッシュタグが不要で文章がすっきりする
- 「地域名」「産直」「お取り寄せ」「ギフト」などのキーワードをプロンプトに組み込んだことでローカル検索にヒットしやすい投稿になった
- 月曜・木曜の2本を週1回まとめて生成し、担当者が確認するだけのフローにしたことで継続できた

**注意点**
- GoogleビジネスプロフィールのAPIはGCPプロジェクトの審査が必要（手動投稿のほうがハードルが低い）
- 投稿の鮮度が大事なので、セール情報・在庫情報は必ず最新のものをインプットする
- 同じパターンの投稿が続くと効果が落ちる。月1回プロンプトの「notes」欄を見直す

## まとめ

Instagramを自動化したときに「Googleマップも同じことできるのでは？」と気づいた。やってみたら、こちらのほうが**即効性があった**。

Instagramは既存フォロワーへの告知に強く、Googleビジネスプロフィールは**検索で初めて見つける新規客**に直結する。地方のEC事業者にとって、後者の方が売上インパクトが大きいケースが多い。

投稿文生成のコードはInstagramのものとほぼ同じ構造。プロンプトを変えるだけで2つのチャネルが両方回るようになった。

コードの利用・カスタマイズ相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）へどうぞ。
