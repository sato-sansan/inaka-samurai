---
title: "Claude APIでTikTok用の水産商品紹介台本を自動生成した話【三陸水産EC】"
description: "商品名と特徴を入れるだけで、TikTok用の60秒台本・テロップ案・BGM提案まで出てくる仕組みを作った。撮影はスマホ1台でいい。台本で悩む時間をゼロにした話。"
pubDate: 2026-09-15
author: sam
category: "Claude活用"
tags: ["Claude", "TikTok", "動画", "SNS", "水産EC", "コンテンツ生成", "台本", "自動化"]
readingTime: 8
---

## きっかけ

気仙沼の業者さんから連絡が来た。

「TikTokって売れるって聞いて始めようとしたんですが、台本ってどう書けばいいんですか？」

Instagramは[写真＋キャプション自動生成](/blog/claude-instagram-caption-generator)で解決した。Xは[水揚げ情報→投稿文変換](/blog/claude-x-post-generator)で動いてる。次は動画、特にTikTok。

魚屋がTikTokで売れてる事例はいくつも見てきた。うまくいってるところは撮影より台本で差がついてる。「今日の鮭、やばいです」みたいな冒頭1秒で離脱率が変わる。

Claude に台本を書かせたら、その問題は解決できる。

## 作ったもの

商品名・特徴・ターゲット・尺を入れると：

- **オープニングフック（0〜3秒）**：スクロールを止める第一声
- **本編台本（〜55秒）**：話す内容のセリフ形式
- **CTA（ラスト5秒）**：誘導の一言
- **テロップ案**：画面に重ねる文字（3〜5か所）
- **BGM方向性**：雰囲気の提案

をセットで出力するスクリプト。

## 実装コード

### 1. 台本生成のコア

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface ProductInfo {
  name: string;           // 商品名
  features: string[];     // 特徴・強み（箇条書き）
  target?: string;        // ターゲット（省略可、例: 「海鮮好きの30代女性」）
  duration: 30 | 60 | 90; // 動画の尺（秒）
  style?: '漁師感' | '料理系' | 'ギフト提案' | 'バズ狙い'; // 動画スタイル
}

interface TikTokScript {
  hook: string;           // オープニングフック（0〜3秒）
  script: string;         // 本編台本（セリフ）
  cta: string;            // CTA（ラスト数秒）
  captions: string[];     // テロップ案
  bgmSuggestion: string;  // BGM方向性
}

async function generateTikTokScript(product: ProductInfo): Promise<TikTokScript> {
  const styleGuide: Record<NonNullable<ProductInfo['style']>, string> = {
    漁師感: '現場感・熱量重視。「今朝揚がったばっかり」「やばい」「マジで」系。漁師の親父がスマホで撮ってる感じ。',
    料理系: '食欲をそそる調理シーン想定。丁寧な語り口で「こう食べると最高です」系。',
    ギフト提案: '贈り物・プレゼント需要を刺激。「喜ばれます」「特別な日に」系。',
    バズ狙い: '意外性・驚き・知識欲を煽る。「実は〇〇って知ってた？」「これ見た瞬間欲しくなる」系。',
  };

  const style = product.style ?? '漁師感';
  const featuresText = product.features.map((f, i) => `${i + 1}. ${f}`).join('\n');
  const targetText = product.target ?? '魚介好きな人全般';

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: `あなたはTikTokで食品ECを伸ばしているクリエイターです。
以下の商品の${product.duration}秒TikTok台本を作ってください。

【商品情報】
商品名: ${product.name}
特徴:
${featuresText}
ターゲット: ${targetText}

【動画スタイル】
${styleGuide[style]}

【出力ルール】
- hookは3秒以内で読める長さ。スクロールが止まる強い一言。
- scriptはセリフ形式。「（ここで商品を持ち上げる）」など動作指示を括弧で入れる。
- ${product.duration}秒で話せる分量（日本語は1秒で約4〜5文字が目安）
- ctaはフォロー・購入・プロフ誘導のどれか1つに絞る（欲張らない）
- captionsは画面に重ねるテロップ文字。3〜5個。インパクト重視の短文。
- bgmSuggestionは「〇〇系」で1行。

【出力フォーマット（JSONのみ）】
{
  "hook": "...",
  "script": "...",
  "cta": "...",
  "captions": ["...", "...", "..."],
  "bgmSuggestion": "..."
}`,
      },
    ],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON parse failed');

  return JSON.parse(jsonMatch[0]) as TikTokScript;
}
```

### 2. 複数スタイルで一括生成（選べるようにする）

```typescript
async function generateMultiStyle(
  product: Omit<ProductInfo, 'style'>,
  styles: ProductInfo['style'][] = ['漁師感', '料理系', 'バズ狙い']
): Promise<Record<string, TikTokScript>> {
  const results = await Promise.all(
    styles.map(async (style) => {
      const script = await generateTikTokScript({ ...product, style });
      return [style, script] as [string, TikTokScript];
    })
  );
  return Object.fromEntries(results);
}
```

### 3. 実際の出力例

```typescript
const product: ProductInfo = {
  name: '気仙沼産 生カツオたたき（冷凍）200g',
  features: [
    '三陸沖・今シーズン初水揚げ',
    '藁焼き仕立て・化学調味料不使用',
    '個別急速冷凍で食べたい分だけ使える',
    '解凍後は半日で刺身なみの鮮度に戻る',
  ],
  target: '海鮮好きな30〜50代、贈り物需要も',
  duration: 60,
  style: '漁師感',
};

const script = await generateTikTokScript(product);
console.log(JSON.stringify(script, null, 2));
```

**出力（漁師感スタイル）：**

```
hook:
「気仙沼の今年初カツオ、マジでやばいから見て」

script:
「今朝、三陸沖から揚がったカツオです。（商品を持ち上げてカメラに近づける）
見てください、この色。藁で焼いたばっかりの香ばしさ、伝わりますか？

化学調味料とか一切入れてない。産地でそのまま急速冷凍してるから
スーパーで買うより鮮度が高いこともある。（冷凍パックを見せる）

解凍も簡単。冷蔵庫に半日置くだけで、こんなにきれいに切れます。（スライスする手元を映す）
薬味だけで十分うまい。ポン酢も合うけど、まず塩で食べてほしい。

この時期だけしか取れないやつを直送してます。
数が少ないから、今日中に見てみて。」

cta:
「プロフのリンクから。今日の在庫、残り少ないです」

captions:
["今シーズン初水揚げ🎣", "藁焼き・無添加", "冷凍でも鮮度は本物", "産地直送", "数量限定"]

bgmSuggestion:
"勢いのあるアコースティックギター系・テンポ速め（BPM120〜130）"
```

**同じ商品・バズ狙いスタイル：**

```
hook:
「スーパーのカツオと産地直送、鮮度が全然違う話」

script:
「実はカツオって、水揚げから時間が経つほど急激に味が落ちる魚なんです。（手元でカツオを持つ）
でも冷凍技術が上がって、今は産地直送の冷凍の方が、
スーパーの生より新鮮なことが普通にあります。

理由はシンプル。（指で数える）
スーパーは水揚げ→市場→問屋→店舗と4〜5日かかる。
産地直送は水揚げ当日に急速冷凍→翌日出荷。

実際に解凍してみます。（冷蔵庫から取り出す）
半日後に切ると…この断面の艶、わかりますか？
これ、さっき言ったスーパーで売ってるチルドより新鮮な状態です。

「冷凍＝鮮度が落ちる」って思ってたなら、一回試してみてください。」

cta:
「プロフのリンクに飛んでみて。送料込みの価格で出してます」

captions:
["産地直送の冷凍 > スーパーの生🐟", "水揚げ当日急速冷凍", "鮮度の差は流通経路で決まる", "この断面の艶を見て", "冷凍＝鮮度落ちは古い常識"]

bgmSuggestion:
"知的・落ち着いた系のBGM（ピアノ＋軽いビート、BPM90〜100）"
```

### 4. Notionに台本を自動保存

```typescript
// 台本をNotionデータベースに追加して撮影管理
interface NotionScriptRow {
  productName: string;
  style: string;
  hook: string;
  scriptText: string;
  cta: string;
  captions: string;
  bgm: string;
  status: '台本作成済' | '撮影待ち' | '編集中' | '投稿済';
  shootDate?: string;
}

async function saveToNotion(
  product: ProductInfo,
  script: TikTokScript
): Promise<void> {
  const row: NotionScriptRow = {
    productName: product.name,
    style: product.style ?? '漁師感',
    hook: script.hook,
    scriptText: script.script,
    cta: script.cta,
    captions: script.captions.join(' / '),
    bgm: script.bgmSuggestion,
    status: '台本作成済',
  };

  // Notion APIで追加（ここは各自の実装に合わせる）
  console.log('Notionに保存:', row);
}
```

### 5. まとめて台本バッファを作る

```typescript
// 1週間分を一気に作る
const productList: ProductInfo[] = [
  {
    name: '気仙沼産 生カツオたたき 200g',
    features: ['今シーズン初', '藁焼き', '無添加'],
    duration: 60,
    style: '漁師感',
  },
  {
    name: '三陸産 生ウニ（瓶詰め） 80g',
    features: ['ミョウバン不使用', '甘み強い', '産地限定'],
    duration: 60,
    style: 'バズ狙い',
  },
  {
    name: '秋鮭の切り身セット 6切れ',
    features: ['今年の秋鮭・脂のり最高', '塩焼き・ちゃんちゃん焼き向き', '小分け冷凍'],
    duration: 30,
    style: '料理系',
  },
];

async function buildWeeklyBuffer() {
  for (const product of productList) {
    const script = await generateTikTokScript(product);
    await saveToNotion(product, script);
    console.log(`✅ ${product.name} - 台本完成`);
  }
}

await buildWeeklyBuffer();
```

## コストと効果

| 指標 | Before（手書き） | After（Claude API） |
|------|------------------|---------------------|
| 1台本の制作時間 | 40〜60分 | 5分（確認・修正含む） |
| 週4本の合計時間 | **約4時間** | **約20分** |
| 台本クオリティのバラつき | 大きい | 安定 |
| APIコスト（週4本） | — | **約3円** |

台本を書くのが苦手な業者さんでも、確認・微調整だけでいい状態になる。

## 運用で気づいたこと

### hookで決まる

TikTokは最初の1〜2秒で9割決まる。「今朝揚がったカツオです」じゃなくて「マジでやばいから見て」の方が止まる。Claude に hook の強度を上げるよう明示すると出力が変わった。

プロンプトに追加したフレーズ：

```
hookは「この動画見た人が思わず止まる」ほどの強度で。
「やばい」「信じられない」「知らなかった」という感情を引き出す一文。
```

### スタイルと商品の相性

| 商品カテゴリ | 合いやすいスタイル |
|---|---|
| 旬の魚・初物 | 漁師感 |
| ウニ・イクラ・高級魚 | バズ狙い（意外な事実系） |
| 鮭・さば・日常的な魚 | 料理系 |
| ギフトセット | ギフト提案 |

### テロップの使い方

Claude が出してくるテロップ案を、そのまま動画編集アプリ（CapCut等）のテキストとして貼り付けてる。位置やフォントは人間が調整するが、文言を考える必要がなくなった。

## まとめ

TikTokが売れると言われてる理由は、アルゴリズムより「台本の質」だと思ってる。面白い台本があれば素人のスマホ動画でも回る。逆に台本が弱いと、いくら映像が綺麗でも止まらない。

Claude に台本を書かせることで、その「台本の質」のハードルを一気に下げられた。業者さんがやることは「撮影」と「軽い修正」だけ。

気仙沼の業者さんはこの仕組みで週3〜4本投稿を継続できるようになって、3ヶ月でTikTokのフォロワーが1,200人→8,400人になった。撮影はすべてスマホ1台。

コード・カスタマイズ相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
