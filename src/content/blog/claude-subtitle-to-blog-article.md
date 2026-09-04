---
title: "Claude APIでYouTube字幕テキストからブログ記事・SNS投稿を自動生成した話【1本の動画から3コンテンツ】"
description: "前回のSRT字幕生成の続き。字幕テキストをClaudeに渡してブログ記事→SNS投稿と変換する自動ラインを組んだ。1本の調理動画から三陸水産ECサイト向けのコンテンツを一気に3種類作れるようになった話。"
pubDate: 2026-09-04
author: sam
category: "Claude活用"
tags: ["Claude", "YouTube", "字幕", "ブログ自動化", "SNS", "コンテンツ再利用", "水産業", "自動化"]
readingTime: 7
---

## 前回の終わりに書いた「次のステップ」をやった

[字幕（SRT）自動生成の記事](/blog/claude-srt-subtitle-generator)の最後に、こう書いた。

> 「動画を撮ったら → 字幕生成 → 字幕テキストからブログ記事 → ブログ記事からSNS投稿」という自動ラインが組めれば、1本の動画から複数のコンテンツが取れる。

試した。動いた。

## 何が作れるようになったか

秋鮭のちゃんちゃん焼き動画（10分）を1本撮ると：

1. **SRT字幕ファイル**（YouTubeアップロード用）
2. **ブログ記事**（レシピ＋産地説明、1,200字程度）
3. **SNS投稿セット**（X・Instagram・LINE用にそれぞれ最適化）

が自動で出てくる。業者さんが動画を撮って音声を渡すだけで、コンテンツ配信の仕込みが終わる。

## 実装コード

前回のコードに「SRT → ブログ記事」「ブログ記事 → SNS投稿」の2ステップを追加している。

### 1. SRTテキストをブログ記事に変換

```typescript
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';

const client = new Anthropic();

interface BlogArticle {
  title: string;
  description: string;
  body: string;
  tags: string[];
}

function parseSRT(srtContent: string): string {
  // SRTのタイムコードと番号を除去してテキストだけ抽出
  return srtContent
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return (
        trimmed.length > 0 &&
        !/^\d+$/.test(trimmed) &&                        // 字幕番号を除外
        !/^\d{2}:\d{2}:\d{2},\d{3}/.test(trimmed)       // タイムコードを除外
      );
    })
    .join('　');  // 読点代わりに全角スペースで結合
}

async function srtToBlogArticle(
  srtContent: string,
  productInfo: { name: string; origin: string; season: string }
): Promise<BlogArticle> {
  const transcriptText = parseSRT(srtContent);

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 3000,
    messages: [
      {
        role: 'user',
        content: `あなたは三陸の水産ECサイト向けのコンテンツライターです。
YouTube動画の字幕テキストをもとに、ECサイトのブログ記事を書いてください。

【商品情報】
- 商品名: ${productInfo.name}
- 産地: ${productInfo.origin}
- 旬の時期: ${productInfo.season}

【字幕テキスト（動画の内容）】
${transcriptText}

【記事の条件】
- 見出し構成: 「材料」「作り方（手順）」「産地のポイント」「保存方法」
- 字数: 1,000〜1,400字
- 語調: 親しみやすく、産地への愛着が伝わる文体
- 動画へのリンクを促す一文を末尾に追加する
- 出力はJSONのみ

【出力フォーマット】
{
  "title": "（記事タイトル）",
  "description": "（100字以内のメタディスクリプション）",
  "body": "（Markdown形式の本文）",
  "tags": ["タグ1", "タグ2", ...]
}`,
      },
    ],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('ブログ記事のJSON解析失敗');

  return JSON.parse(jsonMatch[0]) as BlogArticle;
}
```

### 2. ブログ記事からSNS投稿を展開

```typescript
interface SNSPostSet {
  x: string;          // X（旧Twitter）：140字以内
  instagram: string;  // Instagram：改行・絵文字あり
  line: string;       // LINE公式：読みやすい短文
}

async function blogToSNSPosts(article: BlogArticle): Promise<SNSPostSet> {
  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: `以下のブログ記事をもとに、各SNS向けの投稿文を生成してください。

【ブログ記事】
タイトル: ${article.title}
本文（抜粋）:
${article.body.slice(0, 600)}

【SNS別の条件】

■ X（旧Twitter）
- 140字以内（ハッシュタグ込み）
- 最初の一文で興味を引く
- ハッシュタグ3〜4個（#三陸 #水産 など）

■ Instagram
- 150〜250字
- 絵文字を適度に使う（🐟🌊など）
- 改行で読みやすく
- ハッシュタグは末尾にまとめて5〜8個

■ LINE公式アカウント
- 80〜120字
- 絵文字なし
- 「今日のおすすめ」で始める
- URLなし（別途ボタンで設定するため）

出力はJSONのみ。

{
  "x": "（投稿文）",
  "instagram": "（投稿文）",
  "line": "（投稿文）"
}`,
      },
    ],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('SNS投稿のJSON解析失敗');

  return JSON.parse(jsonMatch[0]) as SNSPostSet;
}
```

### 3. パイプライン全体をまとめる

```typescript
interface ContentPipeline {
  srtPath: string;
  outputDir: string;
  product: { name: string; origin: string; season: string };
}

async function runContentPipeline(config: ContentPipeline): Promise<void> {
  const srtContent = fs.readFileSync(config.srtPath, 'utf-8');

  // Step 1: SRT → ブログ記事
  console.log('ブログ記事を生成中...');
  const article = await srtToBlogArticle(srtContent, config.product);

  // Step 2: ブログ記事 → SNS投稿
  console.log('SNS投稿を生成中...');
  const snsPosts = await blogToSNSPosts(article);

  // ファイル出力
  const base = config.outputDir;
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });

  fs.writeFileSync(`${base}/blog.md`, `# ${article.title}\n\n${article.body}`, 'utf-8');
  fs.writeFileSync(`${base}/sns.json`, JSON.stringify(snsPosts, null, 2), 'utf-8');
  fs.writeFileSync(`${base}/meta.json`, JSON.stringify({
    title: article.title,
    description: article.description,
    tags: article.tags,
  }, null, 2), 'utf-8');

  console.log('\n=== 生成完了 ===');
  console.log(`📝 ブログ: ${base}/blog.md`);
  console.log(`📱 SNS: ${base}/sns.json`);
  console.log('\n【X投稿プレビュー】');
  console.log(snsPosts.x);
}

// 実行
await runContentPipeline({
  srtPath: './subtitles/akisake-recipe.srt',
  outputDir: './output/akisake-recipe',
  product: {
    name: '気仙沼産 秋鮭（生）',
    origin: '気仙沼',
    season: '9月〜11月',
  },
});
```

## 実際の出力例

### ブログ記事（冒頭のみ）

```markdown
# 気仙沼の秋鮭でちゃんちゃん焼き｜産地直送ならではの鮮度で作る北海道の定番料理

秋になると気仙沼の市場に並ぶ銀色に輝く秋鮭。
今年も水揚げが始まりました。

北海道の郷土料理「ちゃんちゃん焼き」は、新鮮な鮭があればこそ美味しく作れる一品です。
スーパーの鮭とは一味違う、産地直送の旨味をぜひ体験してください。

## 材料（2〜3人前）

- 秋鮭（切り身）… 3切れ
- キャベツ … 1/4個
...
```

### SNS投稿（X）

```
気仙沼から秋鮭が届きました🎣 今年の水揚げは脂のりが抜群。
産地直送ならではの新鮮な鮭でちゃんちゃん焼きのレシピを動画で紹介しています。
#三陸 #気仙沼 #秋鮭 #水産直送
```

### SNS投稿（Instagram）

```
🍂 秋の味覚、気仙沼の秋鮭🐟

今年も水揚げが始まりました✨
脂がのった旬の秋鮭を使った「ちゃんちゃん焼き」のレシピ動画を公開中です🎬

市場に並ぶ銀色の鮭を見ると、三陸に秋が来たなあと毎年思います🌊

ぜひYouTubeで作り方をチェックしてみてください！

#三陸 #気仙沼 #秋鮭 #水産直送 #ちゃんちゃん焼き #旬の魚 #産地直送 #東北グルメ
```

## コストと時間

| ステップ | 処理時間 | APIコスト |
|----------|----------|-----------|
| SRT → ブログ記事 | 約25秒 | 約4円 |
| ブログ記事 → SNS投稿 | 約10秒 | 約1円 |
| **合計（字幕生成除く）** | **約35秒** | **約5円** |

前回のWhisper＋Claude字幕生成（約35円/本）と合わせても**1本あたり計40円**でコンテンツが3種類出来上がる。

## 業者さんとの作業フロー

パイプラインを整えてから、動画1本あたりの作業がこう変わった：

| 作業 | Before | After |
|------|--------|-------|
| ブログ記事執筆 | 2〜3時間 | 10分（確認・修正のみ） |
| SNS投稿作成 | 30分×3プラットフォーム | 3分（微調整） |
| 合計 | 約4時間 | 約15分 |

業者さんが動画を撮ったらDropboxに入れてもらい、スクリプトが自動で動く。翌朝には3種類のドラフトが届いている状態を目指している（現在はまだ半自動）。

## ポイントと注意点

**うまくいったこと**
- 字幕テキストを「材料・手順・保存方法」に再構成する指示が効いた
- SNSごとに文字数・絵文字・ハッシュタグを別仕様で指定したので、コピペで使えるものが出てきた
- 産地情報を毎回プロンプトに入れることで、「気仙沼」「三陸」など地名が自然に入る

**注意点**
- 字幕テキストだけでは分量が足りないことがある（10分動画でも字幕は400〜600字程度）。そのときは`productInfo`に商品スペックや産地エピソードを追加してプロンプトに渡す
- ブログ記事は必ず人が確認してから公開する。特に価格・数量など数字の表現はClaudeが適当な値を入れることがある
- Instagram用のハッシュタグは地域・季節・料理名をバランスよく入れるよう指示しないと偏りやすい

## まとめ

「動画を撮る → コンテンツになる」のパイプラインができた。

漁師さんや加工業者さんが「動画を撮るのは好きだけど、SNSやブログの文章が苦手」という話はよく聞く。撮ることに集中してもらって、コンテンツ展開はClaudeに任せる分業が現実的になってきた。

次は、このパイプラインを完全自動化（動画アップロードをトリガーに全部動く）に持っていきたいと思っている。

コードや相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
