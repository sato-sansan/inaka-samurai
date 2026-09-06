---
title: "Claude APIのコンテンツパイプラインを完全自動化した話【動画アップロード→SNS投稿まで無人】"
description: "前回「次は完全自動化したい」と書いた。やった。DropboxにMP4を入れるだけで字幕生成→ブログ記事→SNS投稿まで全部動く。業者さんが動画を撮るだけでいい状態になった話。"
pubDate: 2026-09-06
author: sam
category: "Claude活用"
tags: ["Claude", "YouTube", "自動化", "Dropbox", "SNS自動投稿", "水産業", "コンテンツパイプライン", "X API", "Instagram"]
readingTime: 9
---

## 前回の終わりに書いた「完全自動化」をやった

[前回の記事](/blog/claude-subtitle-to-blog-article)の最後にこう書いた。

> 「次は、このパイプラインを完全自動化（動画アップロードをトリガーに全部動く）に持っていきたいと思っている。」

やった。動いた。

業者さんのフローはこうなった：

**撮る → Dropboxに入れる → 終わり**

翌朝にはX・Instagramに投稿が済んでいて、ブログ記事のドラフトがメールで届いている。

## 全体のアーキテクチャ

```
業者さんが動画をDropboxに入れる
         ↓
   Dropbox Webhook
         ↓
   Webhookサーバー（Node.js）
         ↓
  ① Whisper API で文字起こし
         ↓
  ② Claude API で字幕（SRT）整形
         ↓
  ③ Claude API でブログ記事生成
         ↓
  ④ Claude API でSNS投稿文生成
         ↓
  ⑤ X API・Instagram Graph API で自動投稿
  ⑥ ブログ記事ドラフトをメール送信
```

今まで別々に動かしていた3本のスクリプトをWebhookで繋いだだけ。意外とシンプルにまとまった。

## 実装コード

### 1. Dropbox Webhookの受け取り（Express）

```typescript
import express from 'express';
import crypto from 'crypto';
import { runFullPipeline } from './pipeline';

const app = express();

// Dropboxの署名検証
function verifyDropboxSignature(body: string, signature: string): boolean {
  const hmac = crypto.createHmac('sha256', process.env.DROPBOX_APP_SECRET!);
  hmac.update(body);
  const expected = hmac.digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

// Webhook確認用（初回登録時にDropboxが叩く）
app.get('/webhook/dropbox', (req, res) => {
  res.send(req.query.challenge);
});

// 実際の通知
app.post(
  '/webhook/dropbox',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['x-dropbox-signature'] as string;
    if (!verifyDropboxSignature(req.body.toString(), signature)) {
      return res.status(403).send('Invalid signature');
    }

    res.sendStatus(200); // Dropboxには即座に200を返す

    // 非同期でパイプラインを実行
    setImmediate(async () => {
      const payload = JSON.parse(req.body.toString());
      const changedPaths: string[] = payload?.list_folder?.accounts ?? [];

      for (const accountId of changedPaths) {
        await processDropboxChanges(accountId);
      }
    });
  }
);

app.listen(3000);
```

### 2. 変更ファイルを取得してパイプラインを起動

```typescript
import { Dropbox } from 'dropbox';

const dbx = new Dropbox({ accessToken: process.env.DROPBOX_ACCESS_TOKEN });

async function processDropboxChanges(accountId: string): Promise<void> {
  // 変更一覧を取得（cursorを保存しておいて差分だけ取る）
  const cursor = await loadCursor(accountId);
  const result = cursor
    ? await dbx.filesListFolderContinue({ cursor })
    : await dbx.filesListFolder({ path: '/videos', recursive: false });

  await saveCursor(accountId, result.result.cursor);

  for (const entry of result.result.entries) {
    // 新規追加されたMP4ファイルだけ処理
    if (
      entry['.tag'] === 'file' &&
      entry.name.endsWith('.mp4') &&
      !entry.name.startsWith('_')  // アンダースコア始まりは除外
    ) {
      console.log(`新規動画検知: ${entry.name}`);
      await runFullPipeline(entry.path_lower!, entry.name);
    }
  }
}
```

### 3. パイプライン本体（3ステップをまとめて実行）

```typescript
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import { postToX } from './publishers/x';
import { scheduleInstagramPost } from './publishers/instagram';
import { sendDraftEmail } from './mailer';

const claude = new Anthropic();
const openai = new OpenAI();

export async function runFullPipeline(
  dropboxPath: string,
  fileName: string
): Promise<void> {
  const videoName = path.basename(fileName, '.mp4');
  const outputDir = `./output/${videoName}`;
  fs.mkdirSync(outputDir, { recursive: true });

  try {
    // --- Step 1: 動画をダウンロードして音声抽出 ---
    console.log('[1/5] 動画ダウンロード中...');
    const videoBuffer = await downloadFromDropbox(dropboxPath);
    const audioPath = `${outputDir}/audio.mp3`;
    await extractAudio(videoBuffer, audioPath);

    // --- Step 2: Whisper で文字起こし ---
    console.log('[2/5] 文字起こし中...');
    const transcript = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: 'whisper-1',
      language: 'ja',
      response_format: 'srt',
    });

    const srtPath = `${outputDir}/subtitle.srt`;
    fs.writeFileSync(srtPath, transcript, 'utf-8');

    // --- Step 3: Claude でSRTを整形 ---
    console.log('[3/5] 字幕を整形中...');
    const refinedSrt = await refineSRT(transcript, videoName);
    fs.writeFileSync(`${outputDir}/subtitle_refined.srt`, refinedSrt, 'utf-8');

    // --- Step 4: Claude でブログ記事とSNS投稿を生成 ---
    console.log('[4/5] ブログ記事・SNS投稿を生成中...');
    const productInfo = inferProductFromFileName(videoName);
    const article = await srtToBlogArticle(transcript, productInfo);
    const snsPosts = await blogToSNSPosts(article);

    fs.writeFileSync(`${outputDir}/blog.md`, article.body, 'utf-8');
    fs.writeFileSync(
      `${outputDir}/sns.json`,
      JSON.stringify(snsPosts, null, 2),
      'utf-8'
    );

    // --- Step 5: SNSに投稿・メール送信 ---
    console.log('[5/5] 公開処理中...');
    await postToX(snsPosts.x);
    await scheduleInstagramPost(snsPosts.instagram, `${outputDir}/thumbnail.jpg`);
    await sendDraftEmail({
      to: process.env.DRAFT_EMAIL_TO!,
      subject: `[ブログ下書き] ${article.title}`,
      body: article.body,
      attachmentPath: `${outputDir}/subtitle_refined.srt`,
    });

    console.log(`✅ ${videoName} のパイプライン完了`);
  } catch (err) {
    console.error(`❌ パイプラインエラー (${videoName}):`, err);
    // エラーはSlackに通知（省略）
  }
}
```

### 4. X（旧Twitter）への自動投稿

```typescript
import { TwitterApi } from 'twitter-api-v2';

const xClient = new TwitterApi({
  appKey: process.env.X_API_KEY!,
  appSecret: process.env.X_API_SECRET!,
  accessToken: process.env.X_ACCESS_TOKEN!,
  accessSecret: process.env.X_ACCESS_SECRET!,
});

export async function postToX(text: string): Promise<void> {
  // 140字を超えていたら末尾を切る
  const trimmed = text.length > 140 ? text.slice(0, 137) + '...' : text;

  const result = await xClient.v2.tweet(trimmed);
  console.log(`X投稿完了: https://x.com/i/web/status/${result.data.id}`);
}
```

### 5. Instagramへの予約投稿

Instagramは「今すぐ投稿」ではなく、業者さんが最終確認できるよう**24時間後に予約**する形にした。

```typescript
const INSTAGRAM_ACCOUNT_ID = process.env.INSTAGRAM_ACCOUNT_ID!;
const IG_ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN!;

export async function scheduleInstagramPost(
  caption: string,
  imagePath: string
): Promise<void> {
  // 1. 画像をCDNにアップロード（S3等）してURLを取得
  const imageUrl = await uploadImageToCDN(imagePath);

  // 2. メディアコンテナを作成
  const createRes = await fetch(
    `https://graph.facebook.com/v19.0/${INSTAGRAM_ACCOUNT_ID}/media`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: imageUrl,
        caption,
        access_token: IG_ACCESS_TOKEN,
      }),
    }
  );
  const { id: creationId } = await createRes.json();

  // 3. 24時間後に投稿するため、creation_idを保存してcronで叩く
  await schedulePublish(creationId, Date.now() + 24 * 60 * 60 * 1000);
}
```

### 6. 動画ファイル名から商品情報を推測

業者さんに「ファイル名を決めてもらう」ルールを設けた。

```
akisake-chanchan-2026-09-06.mp4   → 秋鮭・ちゃんちゃん焼き
sanma-shio-yaki-2026-09-05.mp4   → さんま・塩焼き
hotate-butter-2026-09-04.mp4     → ホタテ・バター醤油
```

```typescript
const PRODUCT_MAP: Record<string, { name: string; origin: string; season: string }> = {
  akisake:  { name: '気仙沼産 秋鮭（生）', origin: '気仙沼', season: '9月〜11月' },
  sanma:    { name: '三陸産 さんま（生）', origin: '三陸沖', season: '8月〜10月' },
  hotate:   { name: '気仙沼産 帆立貝',    origin: '気仙沼湾', season: '通年（旬は秋冬）' },
  katsuo:   { name: '三陸産 初鰹',        origin: '三陸沖', season: '5月〜7月' },
  uni:      { name: '三陸産 生うに',      origin: '三陸沿岸', season: '6月〜8月' },
};

function inferProductFromFileName(
  fileName: string
): { name: string; origin: string; season: string } {
  const lower = fileName.toLowerCase();
  for (const [key, info] of Object.entries(PRODUCT_MAP)) {
    if (lower.includes(key)) return info;
  }
  return { name: fileName, origin: '三陸', season: '通年' };
}
```

## 実際に動いた例（2026-09-05）

業者さんが `sanma-shio-yaki-2026-09-05.mp4` をDropboxに入れた翌朝：

**Xに投稿された文**
```
三陸のさんまが今年も届きました🎣 今年は脂のりが例年以上。
シンプルな塩焼きで食べるのが一番。さばき方と塩の振り方を動画で紹介しています。
#三陸 #さんま #塩焼き #水産直送
```

**ブログ記事のドラフト（メールで届いた冒頭）**
```
# 三陸のさんまで塩焼き｜脂ののった旬のさんまをシンプルに焼くコツ

秋の三陸を代表する魚、さんま。
今年は水温の影響で例年より1週間早く南下してきました。
脂のりが抜群のうちに、一番シンプルな「塩焼き」で食べてほしい。
```

業者さんからの反応：「朝起きたら終わってた。魔法みたい」

## コストまとめ

| ステップ | APIコスト |
|----------|-----------|
| Whisper 文字起こし（10分動画） | 約12円 |
| Claude SRT整形 | 約3円 |
| Claude ブログ記事生成 | 約4円 |
| Claude SNS投稿生成 | 約1円 |
| **合計/本** | **約20円** |

月に10本撮ってもらったとして200円。サーバー代（Vercel / Railway）を加えても月1,000円以下で回る。

## 運用してわかったこと

**ファイル名ルールが一番大事だった**

最初はファイル名を自由にしてもらっていたが、`DSC_0291.mp4` みたいな名前では商品情報が推測できない。3パターンのサンプルを見せてルールを決めたら問題なくなった。

**Instagramの「24時間後予約」が正解だった**

最初は即時投稿していたが、「さんまじゃなくてホタテの動画だった」みたいなミスが起きた。1日の猶予があれば業者さんが気づいて止められる。X（即時投稿）はミスが起きたことがないのでそのまま。

**エラー通知はSlackに流す**

パイプラインが止まっても気づかないと困るので、エラー時はSlackのIncoming Webhookに通知を飛ばすようにした。「〇〇の処理に失敗しました」とファイル名つきで来るので対応が早い。

## まとめ

「撮る → Dropboxに入れる → 終わり」になった。

各ステップは[字幕生成](/blog/claude-srt-subtitle-generator)・[ブログ生成](/blog/claude-subtitle-to-blog-article)の記事でそれぞれ作っていたものをWebhookで繋いだだけ。Claude APIのコストも1本あたり20円以下で、量産体制に入っても問題ない。

業者さんが動画を撮り続けてくれれば、コンテンツが勝手に積み上がっていく。秋漁シーズンに間に合ってよかった。

コードや相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
