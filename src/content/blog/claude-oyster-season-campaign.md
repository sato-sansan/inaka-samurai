---
title: "Claude APIで牡蠣シーズン初入荷キャンペーンを産地別に仕込んだ話【三陸水産EC】"
description: "松島・広田湾・石巻の3産地それぞれに合わせた初入荷メール・SNS投稿・産地コピーをClaude APIで一括生成した実装と、「産地の個性を言葉にする」プロンプト設計のコツを公開する。"
pubDate: 2026-09-22
author: sam
category: "Claude活用"
tags: ["Claude", "EC自動化", "メールマーケティング", "牡蠣", "水産業", "季節キャンペーン", "Shopify"]
readingTime: 9
---

## 「牡蠣の準備、そろそろですよね」

[カニのキャンペーン仕込み](/blog/claude-crab-season-campaign)が終わったと思ったら、別の業者さんから連絡が来た。

「三陸の牡蠣って10月下旬から始まりますよね。去年は入荷してから慌てて文章書いたんですが、今年はカニと同じようにClaude APIで事前に準備できますか？松島・広田湾・石巻とあって、それぞれ特徴が違うから、コピーをどう分けるかも悩んでて」

これも典型的な「旬もの特有の問題」だ。

**産地ごとに風味が違う → でも一括で告知してしまう → 「ひとまとめにされた感」が出る**

産地をちゃんと使い分けたコピーを、しかも初入荷前に準備する。Claude APIでやった。

## 作ったもの

3フェーズで生成した。

1. **産地別コピー生成**（松島・広田湾・石巻それぞれのUSPと味の言語化）
2. **初入荷メールの生成**（リピーター向け・新規向け、産地別の全組み合わせ）
3. **X・Instagram投稿文の生成**（牡蠣の季節感を視覚的に伝える表現）

## 実装コード

### 1. 型定義と産地データ

```typescript
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';

const client = new Anthropic();

interface OysterOrigin {
  id: string;
  area: string;
  region: string;
  waterCharacteristics: string;
  tasteProfile: string;
  harvestStart: string;
  peakMonth: string;
  annualStock: number;        // 年間取扱量（ケース）
  popularWith: string;
}

const OYSTER_ORIGINS: OysterOrigin[] = [
  {
    id: 'matsushima',
    area: '松島産',
    region: '宮城県松島湾',
    waterCharacteristics: '外洋と内湾が混じり合う豊かな養分。松島湾特有のプランクトンが多い',
    tasteProfile: '甘みが強くクリーミー。牡蠣初心者でも食べやすい丸みのある味',
    harvestStart: '2026-10-20',
    peakMonth: '12月〜1月',
    annualStock: 180,
    popularWith: 'リピーター・贈答・牡蠣入門者',
  },
  {
    id: 'hirota',
    area: '広田湾産',
    region: '岩手県陸前高田市・広田湾',
    waterCharacteristics: '三陸外洋の清浄な海水。震災後に復活した三陸漁業の象徴',
    tasteProfile: '塩味がはっきりしていて引き締まった味。磯の香りが強く、牡蠣好きに刺さる',
    harvestStart: '2026-10-25',
    peakMonth: '1月〜2月',
    annualStock: 90,
    popularWith: '牡蠣フリーク・産地ファン・復興支援購入層',
  },
  {
    id: 'ishinomaki',
    area: '石巻産',
    region: '宮城県石巻市・女川湾周辺',
    waterCharacteristics: '北上川の淡水と三陸外洋が交わる栄養豊富な海域',
    tasteProfile: '肉厚でコクがある。加熱調理（カキフライ・鍋）で特に旨みが増す',
    harvestStart: '2026-11-01',
    peakMonth: '1月〜3月',
    annualStock: 240,
    popularWith: 'カキフライ愛好者・業務用・大容量注文',
  },
];
```

### 2. 産地別コピーを生成する

```typescript
interface OysterOriginCopy {
  originId: string;
  tagline: string;
  usp: string;
  tasteCopy: string;
  occasionCopy: string;
  comparisonNote: string;
}

async function generateOriginCopies(
  origins: OysterOrigin[]
): Promise<OysterOriginCopy[]> {
  const originsText = origins
    .map(
      (o) =>
        `ID:${o.id}\n` +
        `産地:${o.area}（${o.region}）\n` +
        `水質:${o.waterCharacteristics}\n` +
        `味:${o.tasteProfile}\n` +
        `人気層:${o.popularWith}\n`
    )
    .join('\n---\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 3000,
    messages: [
      {
        role: 'user',
        content: `三陸水産ECで販売する牡蠣の産地別コピーを生成してください。

【産地情報】
${originsText}

【条件】
- 産地同士を比較して「どれが上か」という書き方は避ける
- それぞれの個性を尊重した表現にする
- 水産業の専門用語は使わず、一般顧客が直感で理解できる言葉で
- 「新鮮」「おいしい」などの空虚な表現を使わない
- 産地・海・漁師の現場感が伝わる具体的な言葉を使う

【出力（JSONの配列のみ）】
[
  {
    "originId": "産地ID",
    "tagline": "産地を一言で表す（〜25文字）",
    "usp": "この産地を選ぶ理由3点（〜180文字）",
    "tasteCopy": "食べた瞬間のイメージ（〜100文字）",
    "occasionCopy": "どんな場面に合うか（〜80文字）",
    "comparisonNote": "他産地との簡単な差異・比較表用（〜60文字）"
  }
]`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '[]';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('産地コピーのJSON解析失敗');
  return JSON.parse(jsonMatch[0]) as OysterOriginCopy[];
}
```

### 3. 初入荷メールを生成する

```typescript
interface OysterArrivalEmail {
  originId: string;
  customerType: 'repeat' | 'new';
  subject: string;
  body: string;
}

async function generateArrivalEmails(
  origin: OysterOrigin,
  copy: OysterOriginCopy,
  repeatCount: number
): Promise<OysterArrivalEmail[]> {
  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: `三陸水産ECの牡蠣初入荷メールを2パターン生成してください。

【産地情報】
産地: ${origin.area}（${origin.region}）
初入荷予定: ${origin.harvestStart}
旬のピーク: ${origin.peakMonth}
年間在庫: ${origin.annualStock}ケース

【産地コピー（生成済み）】
タグライン: ${copy.tagline}
味の表現: ${copy.tasteCopy}

【昨年のリピーター数】
${repeatCount}名

【パターン1：リピーター向け】
- 「今年も届きました」という安心感と馴染み感
- 去年の体験を想起させる表現
- 数量限定である旨を自然に添える

【パターン2：新規向け】
- 「なぜこの産地の牡蠣なのか」を1〜2文で説明
- 鮮度保証・返金保証など安心要素を1つ入れる
- 初めてでも注文しやすい雰囲気

【共通ルール】
- 件名30文字以内
- 本文250〜350文字
- URLプレースホルダーは {{shop_url}}
- 「新鮮」「最高」「絶品」は使わない

【出力（JSONの配列のみ）】
[
  { "customerType": "repeat", "subject": "件名", "body": "本文" },
  { "customerType": "new",    "subject": "件名", "body": "本文" }
]`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '[]';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('初入荷メールのJSON解析失敗');

  const emails = JSON.parse(jsonMatch[0]) as Array<{
    customerType: 'repeat' | 'new';
    subject: string;
    body: string;
  }>;

  return emails.map((e) => ({ originId: origin.id, ...e }));
}
```

### 4. SNS投稿を生成する

```typescript
interface OysterSnsContent {
  originId: string;
  xArrivalPost: string;
  xRecipePost: string;
  xHashtags: string;
  instagramCaption: string;
  instagramHashtags: string;
}

async function generateSnsContent(
  origin: OysterOrigin,
  copy: OysterOriginCopy
): Promise<OysterSnsContent> {
  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: `三陸水産ECの牡蠣初入荷SNS投稿を生成してください。

【産地情報】
産地: ${origin.area}
タグライン: ${copy.tagline}
味の特徴: ${origin.tasteProfile}
初入荷予定: ${origin.harvestStart}

【条件】
X初入荷告知（120文字以内）：
- 「今シーズン初入荷」の臨場感
- 産地名を入れる

Xレシピ提案（120文字以内）：
- ${origin.area}に合う食べ方の提案
- 料理名を具体的に（「生食」「カキフライ」「アヒージョ」など）

Xハッシュタグ（5〜6個）：
- #牡蠣 は必須

Instagramキャプション（200文字以内）：
- 漁師さん・産地の風景を想起させる表現
- 写真を見ている人が「食べたくなる」締め

Instagramハッシュタグ（8〜10個）

【出力（JSONのみ）】
{
  "xArrivalPost": "X初入荷告知",
  "xRecipePost": "Xレシピ提案",
  "xHashtags": "ハッシュタグ（スペース区切り）",
  "instagramCaption": "Instagramキャプション",
  "instagramHashtags": "ハッシュタグ（スペース区切り）"
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('SNSコンテンツのJSON解析失敗');

  const sns = JSON.parse(jsonMatch[0]) as Omit<OysterSnsContent, 'originId'>;
  return { originId: origin.id, ...sns };
}
```

### 5. 実行スクリプト

```typescript
async function main() {
  console.log('🦪 牡蠣初入荷キャンペーン自動生成開始...\n');

  const repeatCounts: Record<string, number> = {
    matsushima: 218,
    hirota: 94,
    ishinomaki: 163,
  };

  console.log('📝 産地別コピーを生成中...');
  const copies = await generateOriginCopies(OYSTER_ORIGINS);

  copies.forEach((c) => {
    const origin = OYSTER_ORIGINS.find((o) => o.id === c.originId);
    console.log(`\n【${origin?.area}】`);
    console.log(`タグライン: ${c.tagline}`);
    console.log(`USP: ${c.usp}`);
    console.log(`味: ${c.tasteCopy}`);
  });

  const allEmails: OysterArrivalEmail[] = [];
  const allSns: OysterSnsContent[] = [];

  for (const origin of OYSTER_ORIGINS) {
    const copy = copies.find((c) => c.originId === origin.id);
    if (!copy) continue;

    const repeatCount = repeatCounts[origin.id] ?? 0;

    console.log(`\n✉️ ${origin.area}のメールを生成中...`);
    const emails = await generateArrivalEmails(origin, copy, repeatCount);
    allEmails.push(...emails);

    emails.forEach((e) => {
      const label = e.customerType === 'repeat' ? 'リピーター' : '新規';
      console.log(`[${label}] 件名: ${e.subject}`);
    });

    console.log(`📱 ${origin.area}のSNSを生成中...`);
    const sns = await generateSnsContent(origin, copy);
    allSns.push(sns);
    console.log(`  X初入荷: ${sns.xArrivalPost.slice(0, 40)}...`);
  }

  const output = { copies, emails: allEmails, sns: allSns };
  fs.writeFileSync(
    'oyster-season-2026.json',
    JSON.stringify(output, null, 2),
    'utf-8'
  );
  console.log('\n✅ oyster-season-2026.json に保存完了');
}

main().catch(console.error);
```

## 実際に生成された内容

### 産地別タグライン（生成例）

```
【松島産】
タグライン: 松島湾の甘さが、そのまま殻に詰まっている
味: 口に入れた瞬間、磯の空気と一緒にほんのり甘みが広がる。後味にクリームのようなコク。

【広田湾産】
タグライン: 三陸の外洋が育てた、輪郭のはっきりした一粒
味: 塩の輪郭がはっきりして、かむほどに磯の香りが押し寄せてくる。牡蠣らしい牡蠣。

【石巻産】
タグライン: 北上川の恵みで育った、食べ応えのある牡蠣
味: 肉厚で歯ごたえがある。加熱すると旨みが凝縮して、カキフライにすると「これが牡蠣か」と気づく。
```

### 初入荷メール（生成例）

**松島産・リピーター向け:**

```
件名: 【松島産牡蠣】今シーズンも届きはじめました

お待たせしました。松島湾の牡蠣が今シーズンの初入荷を迎えました。

今年は水温が例年より1週間ほど早く下がり、漁師さん曰く「粒の張りが
去年より早い」との話です。甘みが強いシーズン序盤の個体が揃っています。

昨年ご購入いただいた方はご存知かと思いますが、
松島の牡蠣は12月〜1月が最もクリーミーになる時期です。
今から始めていただくと、その変化を楽しんでいただけます。

今シーズンの在庫は昨年比で少なめの見込みです。
▶ 今シーズンの松島産牡蠣を見る: {{shop_url}}
```

**広田湾産・新規向け:**

```
件名: 三陸・広田湾の牡蠣が今季初入荷しました

広田湾は岩手県陸前高田市沖に広がる三陸外洋の漁場です。
内湾とは異なる清浄な外洋水で育った牡蠣は、塩の輪郭がはっきりした
「牡蠣らしい牡蠣」と言われます。

初めてご購入の方へ：万一鮮度にご満足いただけない場合は、
写真をお送りいただければ全額返金対応をしています。
三陸の牡蠣をぜひ一度試してみてください。

今シーズンは年間90ケースの少量入荷です。
▶ 広田湾産牡蠣を見る: {{shop_url}}
```

### X投稿（生成例）

**松島産 初入荷告知:**

```
松島湾の牡蠣が今シーズン初入荷しました。

今年は粒の張りが早め。甘みが特徴の松島産は12月〜1月がピークですが、
今の時期は旬の入り口を楽しめます。在庫少なめです。

#牡蠣 #松島産 #三陸 #初入荷 #冬の味覚
```

**石巻産 レシピ提案:**

```
石巻産の牡蠣はカキフライが一番引き立ちます。

肉厚な身が加熱でも縮まず、外はサクッと中は旨みが凝縮。
「牡蠣フライがこんなにうまいとは」という声が毎年来ます。

#カキフライ #石巻産 #牡蠣 #冬ごはん #三陸海産物
```

**広田湾産 Instagramキャプション（生成例）:**

```
冬の三陸に、牡蠣の季節が来ました。

広田湾に並ぶ養殖いかだ。外洋のきれいな海水を吸い込みながら
1年かけて育った牡蠣が、今シーズン初めて水揚げされました。

殻を割った瞬間の磯の香り、レモンをひとしぼりして口に運ぶと
塩味がはっきりと広がります。こってりではなく、すっきりした旨み。
この時期しか届かない味を、ぜひ。
```

## コストと効果

**APIコスト（3産地分一括生成）**

| 処理 | トークン数（概算） | コスト |
|------|------------------|--------|
| 産地別コピー3件 | 入力1,500＋出力2,000 | 約1.5円 |
| 初入荷メール6通（3産地×2パターン） | 入力4,500＋出力4,500 | 約4.1円 |
| SNS9件（3産地×3種） | 入力3,000＋出力2,500 | 約2.6円 |
| 合計 | | **約8.2円** |

**工数削減**

| 作業 | Before（手動） | After（Claude API） |
|------|--------------|-------------------|
| 産地別コピー3種作成 | 約2時間 | 0分（自動） |
| 初入荷メール6通作成 | 約3時間 | 5分（確認のみ） |
| SNS9件作成 | 約1.5時間 | 5分（確認のみ） |
| 合計 | 約6.5時間 | **約10分** |

**業者さんの一言：**
「松島・広田湾・石巻って、どれも"三陸の牡蠣"でひとまとめにしてたんですよね。去年のInstagramを見返したら全部同じ文章で産地名だけ変えてた。今年はそれぞれ個性のある文章が出てきて、常連のお客さんが"広田湾のが好き"とか"石巻はカキフライに使うんだよね"って話しかけてくれるようになりました」

## ポイントと注意点

**うまくいった点**
- 「空虚な表現を使わない」という制約（「新鮮」「おいしい」「絶品」禁止）をプロンプトに書いたことで、具体的な産地描写が出てきた
- `waterCharacteristics` と `tasteProfile` を別フィールドで渡したことで、味の説明に「なぜそうなるか」という背景が含まれた
- 産地ごとにループして逐次生成したことで、コンテキストの混入を防いだ（一括で3産地分を渡すと「松島の特徴を広田湾の説明に使う」という混線が起きた）

**注意点**
- 入荷量が少ない産地（広田湾：90ケース）は「在庫少なめ」という表現を自然に入れる工夫が必要。プロンプトに `annualStock` を渡して比較させると自動で反映される
- X投稿は産地ごとに投稿するのが理想だが、同日に3産地分を投稿するとスパムに見える。日をずらして初入荷日前後に合わせたスケジュールで運用すること
- メールの送信タイミングは実際の初入荷確定後に送ること。「入荷予定」でメールを送ると予定がずれたときにクレームになる

## まとめ

牡蠣は産地が複数あり、それぞれ味・旬のタイミング・顧客層が異なる。これを手動で管理しようとすると、どうしても「三陸産牡蠣」として一括にしてしまう。

**産地データ（水質・味・入荷時期）→ 制約（空虚な表現禁止）→ Claude → 産地別コピー＋メール＋SNS**というパイプラインで、6.5時間の作業が10分になった。

カニのキャンペーン（[前回記事](/blog/claude-crab-season-campaign)）と同様、**「入荷前に準備が終わる」という状態**が最大の成果だと思う。今年は10月下旬の初入荷に向けて、9月中にすべてのコンテンツが揃った状態で待てる。

次は牡蠣の鮮度問題への対応——「配送中に死んでしまった」というクレームへの返信自動化を考えている。

コード・カスタマイズ相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
