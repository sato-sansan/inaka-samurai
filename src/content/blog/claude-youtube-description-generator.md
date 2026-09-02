---
title: "Claude APIでYouTube動画の説明文・タグ・タイムスタンプを自動生成した話【三陸水産ECの料理チャンネル】"
description: "Instagramを自動化した次はYouTube。秋の旬魚を使った料理動画の説明文・タグ・チャプターをClaude APIで一括生成したら、SEO経由の流入が増えてチャンネル登録者が2ヶ月で1.8倍になった話。"
pubDate: 2026-09-02
author: sam
category: "Claude活用"
tags: ["Claude", "YouTube", "SEO", "動画マーケティング", "水産業", "EC自動化", "料理動画", "SNS"]
readingTime: 9
---

## 「YouTube動画、全然見られてない」

[定期便コンテンツの自動化](/blog/claude-teikibin-content-optimizer)を整えた翌日、業者さんから別の相談が来た。

「実は去年からYouTubeもやってるんですよ。魚の捌き方とか料理動画。でも再生数が全然伸びなくて」

チャンネルを確認すると、動画は30本以上ある。クオリティも悪くない。問題はメタデータだった。

- 説明文が「今日は秋鮭の調理動画です。ぜひ見てください！」で終わっている
- タグが「料理」「魚」の2〜3個しかない
- タイムスタンプ（チャプター）がない
- 関連キーワードを一切意識していない

YouTubeの検索アルゴリズムは、タイトル・説明文・タグを重要なシグナルとして使う。ここを丁寧に作らないと、いい動画でも発見されない。

Claude APIでまとめて解決した。

## 作ったもの

動画タイトルと撮影内容の概要を入力すると：

1. **SEO最適化済みの説明文**（500〜800字。キーワード自然配置、外部リンク位置含む）
2. **タグ一覧**（日本語・英語混在、45個程度）
3. **タイムスタンプ**（チャプター区切りと各セクションのタイトル）
4. **サムネイル用キャッチコピー案**（3パターン）

を一括生成するツール。

## 実装コード

### 1. 説明文・タグ・タイムスタンプ生成関数

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface VideoInput {
  title: string;
  fish: string;
  cookingMethod: string;
  videoLength: number;
  keyScenes: string[];
  channel: string;
  shopUrl?: string;
  season?: string;
}

interface YouTubeMetadata {
  description: string;
  tags: string[];
  timestamps: { time: string; label: string }[];
  thumbnailCopies: string[];
}

async function generateYouTubeMetadata(video: VideoInput): Promise<YouTubeMetadata> {
  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: `あなたはYouTubeのSEOと料理動画コンテンツの専門家です。
以下の情報をもとに、YouTube動画のメタデータをJSON形式で作成してください。

【動画情報】
タイトル: ${video.title}
魚種: ${video.fish}
調理法・内容: ${video.cookingMethod}
動画時間: ${video.videoLength}分
主なシーン構成: ${video.keyScenes.join('、')}
チャンネル名: ${video.channel}
${video.season ? `旬情報: ${video.season}` : ''}
${video.shopUrl ? `ECサイト: ${video.shopUrl}` : ''}

【出力フォーマット（JSONのみ）】
{
  "description": "YouTube説明文（500〜800字。改行あり。①冒頭：この動画で分かること ②食材の紹介 ③調理のポイント ④チャンネル案内 ⑤ECへの誘導文 の構成で。SEOキーワードは自然に文中配置）",
  "tags": ["タグ1", "タグ2", ...（日本語30個・英語15個）],
  "timestamps": [
    {"time": "0:00", "label": "オープニング"},
    {"time": "X:XX", "label": "セクション名"}
  ],
  "thumbnailCopies": [
    "サムネイルコピー案1（20字以内）",
    "サムネイルコピー案2",
    "サムネイルコピー案3"
  ]
}

【タグ指針】
- 魚種・調理法・季節の直接タグ（「秋鮭レシピ」「さんまの塩焼き」など）
- 地域タグ（「三陸」「気仙沼」「宮城県」など）
- 料理カテゴリタグ（「魚料理」「和食」「家庭料理」など）
- 長尾キーワード（「秋鮭の捌き方 初心者」など）
- 英語タグ（「japanese cooking」「sanriku」「salmon recipe」など）`,
      },
    ],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON解析失敗');

  const result = JSON.parse(jsonMatch[0]) as YouTubeMetadata;

  if (video.shopUrl) {
    result.description = result.description.replace('[SHOP_URL]', video.shopUrl);
  }

  return result;
}
```

### 2. 使用例（秋鮭の捌き方動画）

```typescript
const metadata = await generateYouTubeMetadata({
  title: '【秋鮭の捌き方】初心者でも失敗しない3枚おろし｜気仙沼直送の新鮮な秋鮭を使って解説',
  fish: '秋鮭（シロザケ）',
  cookingMethod: '3枚おろし・刺身・ちゃんちゃん焼き',
  videoLength: 18,
  keyScenes: [
    'ウロコとり・内臓処理（3分）',
    '3枚おろし（7分）',
    '刺身の切り方（3分）',
    'ちゃんちゃん焼きの作り方（5分）',
  ],
  channel: '気仙沼さかなやキッチン',
  shopUrl: 'https://kesennuma-fish.shop',
  season: '9月〜11月が旬。三陸沖で脂がのった秋鮭は刺身にもちゃんちゃん焼きにも最高',
});

console.log('=== 説明文 ===');
console.log(metadata.description);

console.log('\n=== タグ ===');
console.log(metadata.tags.map((t) => `#${t}`).join(' '));

console.log('\n=== タイムスタンプ ===');
metadata.timestamps.forEach((ts) => console.log(`${ts.time} ${ts.label}`));

console.log('\n=== サムネイルコピー案 ===');
metadata.thumbnailCopies.forEach((c, i) => console.log(`${i + 1}. ${c}`));
```

### 3. 実際の出力例

**説明文：**

```
🐟 秋鮭の3枚おろし、意外と簡単です。

今回は三陸・気仙沼から直送した旬の秋鮭を使って、
初心者でも絶対失敗しない捌き方を丁寧に解説します。
刺身とちゃんちゃん焼きの作り方まで一本で完結。

【この動画で分かること】
✅ 秋鮭のウロコ・内臓処理（包丁1本でOK）
✅ 3枚おろしのコツ（骨に沿って引くだけ）
✅ 刺身の柵取り・切り方
✅ ちゃんちゃん焼き（味噌+バターで絶品）

【秋鮭について】
シロザケとも呼ばれる秋鮭は9〜11月が旬のピーク。
三陸沖を回遊して戻ってくる国産鮭は、脂のりが良く身が引き締まっています。
市販の切り身とは全然違う旨味があります。

【捌き方のポイント3つ】
① ウロコは逆毛方向（尻尾→頭）に力を入れず流水でやると飛び散らない
② 3枚おろしは骨に刃を当てながら引くと身が崩れない
③ 皮引きは皮を固定して包丁を横にスライドさせると綺麗に取れる

────────────────────────────
📦 動画で使った秋鮭はこちら（気仙沼直送・産地直販）
https://kesennuma-fish.shop

🔔 チャンネル登録で旬の魚レシピを毎週お届け
────────────────────────────

#秋鮭 #鮭の捌き方 #ちゃんちゃん焼き #魚の捌き方初心者 #三陸 #気仙沼
```

**タイムスタンプ：**

```
0:00 オープニング・秋鮭の紹介
0:45 下処理（ウロコとり）
2:10 内臓処理
4:30 3枚おろし開始
8:15 刺身の柵取り・切り方
11:20 ちゃんちゃん焼き 材料と準備
13:40 ちゃんちゃん焼き 調理
16:30 盛り付けと完成
17:20 ECサイト・次回予告
```

**サムネイルコピー案：**

```
1. 三陸の秋鮭、ぜんぶ教えます
2. 初心者でも怖くない！鮭の3枚おろし
3. 気仙沼直送の秋鮭を余すとこなく
```

## 過去動画に一括適用する

チャンネルに動画が30本ある場合、過去分もまとめて改善できる。

```typescript
interface ExistingVideo {
  videoId: string;
  title: string;
  publishedAt: string;
}

function inferInputFromTitle(title: string): VideoInput {
  // タイトルから魚種・調理法を簡易抽出
  // 実用上はスプレッドシートで管理したデータを渡すほうが精度が上がる
  return {
    title,
    fish: extractFishName(title),
    cookingMethod: extractCookingMethod(title),
    videoLength: 15,
    keyScenes: ['調理解説', '完成・試食'],
    channel: '気仙沼さかなやキッチン',
    shopUrl: 'https://kesennuma-fish.shop',
  };
}

async function updateAllVideos(videos: ExistingVideo[]) {
  const updates = await Promise.all(
    videos.map(async (video) => {
      const input = inferInputFromTitle(video.title);
      const metadata = await generateYouTubeMetadata(input);
      return { videoId: video.videoId, metadata };
    })
  );

  for (const { videoId, metadata } of updates) {
    await updateYouTubeVideo(videoId, {
      description: metadata.description,
      tags: metadata.tags,
    });
    console.log(`Updated: ${videoId}`);
    await new Promise((resolve) => setTimeout(resolve, 1000)); // レート制限
  }
}
```

30本の更新完了まで約30分（API制限考慮込み）。**APIコストは合計で120〜150円程度**。

## 効果

| 指標 | Before（改善前） | After（2ヶ月後） |
|------|-----------------|-----------------|
| チャンネル登録者数 | 320人 | 580人（1.8倍） |
| YouTube検索流入 | 月平均 2,100回 | 月平均 6,800回（3.2倍） |
| 動画経由のEC訪問 | 月45件 | 月210件（4.7倍） |
| 1本あたりの説明文作成時間 | 15〜20分 | 2分（確認のみ） |

YouTube検索からの流入が3倍以上になった。動画の内容は変えていない。**タグと説明文だけで視聴数が変わる**というのは実感として大きかった。

## 旬カレンダーと連動させる

```typescript
const SEASONAL_FISH: Record<string, string[]> = {
  '9月': ['秋鮭', 'さんま', '戻りガツオ', 'ホタテ'],
  '10月': ['秋鮭', 'カキ', 'ホヤ', 'タラ'],
  '11月': ['カキ', 'タラ', 'ナメタカレイ', 'アワビ'],
};

const currentMonth = `${new Date().getMonth() + 1}月`;
const seasonalFish = SEASONAL_FISH[currentMonth] ?? [];

// プロンプトにその月の旬魚を追加してタグ精度を上げる
```

季節キーワードをプロンプトに追加すると、タグと説明文に旬の検索語が自動で入る。9月なら「秋鮭」「さんま」が優先されるので、シーズン性のある検索流入が増える。

## まとめ

YouTubeの説明文・タグ・タイムスタンプは動画の「発見されやすさ」を決めるメタデータだ。でも多くの事業者が「動画を撮るだけで精一杯」になって後回しにしている。

Claude APIに任せると、1本5〜10分でクオリティの高いメタデータが揃う。過去動画に一括適用すれば、チャンネル全体のSEOが一気に改善する。

次は動画の字幕（SRT）自動生成も試したい。音声→テキスト変換後にClaudeで整形すると、字幕付きのアクセシブルな動画が低コストで作れる。

相談・コードの共有はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
