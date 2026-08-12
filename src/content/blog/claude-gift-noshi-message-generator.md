---
title: "Claude APIで水産ECの熨斗文・ギフトメッセージを自動生成した話【お中元・お歳暮・慶弔対応】"
description: "お中元シーズンに毎日50件届くギフト注文の熨斗文・メッセージカード入力をClaudeで自動化。送り主名・用途・関係性を入力するだけで、のし表書きと心のこもったメッセージ文を即時生成する仕組みをTypeScriptで構築した。"
pubDate: 2026-08-12
author: sam
category: "Claude活用"
tags: ["Claude", "Shopify", "ギフト", "熨斗", "自動化", "水産業", "EC", "お中元", "お歳暮"]
readingTime: 9
---

## お中元シーズンに毎日50件の熨斗対応が積み重なる

気仙沼の水産加工品EC、毎年7〜8月になると注文フォームへの問い合わせが一気に増える。

「熨斗に何て書けばいいですか？」「メッセージカードの文章を考えてもらえますか？」

内容は決まりきっている。送り主・送り先・用途（お中元、内祝い、父の日…）がわかれば、のしの表書きとメッセージカードの文章はパターン化できる。でも1件1件に返信するのは業者さんにとって地味にしんどい作業だった。

Claude APIで自動生成の仕組みを作った。

## 作ったもの

注文フォームで「贈り物情報」を入力すると：

1. **熨斗の表書きを自動判定**（用途から「御中元」「御歳暮」「内祝」「快気祝」等を選択）
2. **縦書き熨斗用のフォーマットに整形**（送り主名の書き方も考慮）
3. **メッセージカードの文章をClaudeが生成**（送り先との関係性・用途に合わせた文体）

Shopifyの注文フォームにカスタムフィールドを追加して、注文完了と同時に印刷データを自動生成する。

## システム全体像

```
Shopify 注文フォーム（ギフト情報入力）
        ↓ Webhook（order.created）
  Next.js API Route
        ↓
  Claude API（表書き判定 + メッセージ生成）
        ↓
  熨斗印刷データ（PDF）+ メッセージカード（テキスト）
        ↓
  業者さんへメール通知 + 注文管理システムに保存
```

## 実装コード

### 1. 型定義と表書きマスタ

```typescript
// types/gift.ts
export interface GiftInfo {
  purpose: string;       // 例: "お中元", "内祝い", "快気祝い", "結婚祝い"
  senderName: string;    // 送り主の名前（連名可）
  recipientName?: string; // 送り先（任意）
  relationship?: string;  // 関係性 例: "上司", "親戚", "取引先"
  customMessage?: string; // 購入者からの一言メモ
}

export interface NoshiResult {
  uwagaki: string;       // 表書き 例: "御中元"
  shitaname: string;     // 下の名前（送り主）
  cardMessage: string;   // メッセージカード本文
  formality: '丁寧' | '親しみ';
}

// 表書きのマッピング（Claudeに渡す前に前処理）
const UWAGAKI_MAP: Record<string, string> = {
  'お中元': '御中元',
  '中元': '御中元',
  'お歳暮': '御歳暮',
  '歳暮': '御歳暮',
  '内祝い': '内祝',
  '快気祝い': '快気祝',
  '快気内祝い': '快気内祝',
  '結婚祝い': '御結婚御祝',
  '出産祝い': '御出産御祝',
  '就職祝い': '御就職御祝',
  '新築祝い': '御新築御祝',
  '退職祝い': '御退職記念',
  'お礼': '御礼',
  '粗品': '粗品',
};
```

### 2. Claude APIで熨斗文とメッセージカードを生成

```typescript
import Anthropic from '@anthropic-ai/sdk';
import type { GiftInfo, NoshiResult } from './types/gift';

const client = new Anthropic();

export async function generateGiftContent(gift: GiftInfo): Promise<NoshiResult> {
  const resolvedUwagaki = UWAGAKI_MAP[gift.purpose] ?? gift.purpose;

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `あなたは日本の贈答マナーに精通した専門家です。
水産加工品（鮭・カツオたたき・牡蠣・いくら等）を贈る際の熨斗情報とメッセージカード文章を生成してください。

【贈り物情報】
- 用途: ${gift.purpose}（表書き: ${resolvedUwagaki}）
- 送り主: ${gift.senderName}
- 送り先との関係: ${gift.relationship ?? '不明'}
${gift.recipientName ? `- 送り先のお名前: ${gift.recipientName}` : ''}
${gift.customMessage ? `- 購入者からのメモ: ${gift.customMessage}` : ''}

【生成ルール】
- 熨斗の下の名前は送り主名をそのまま使用（連名の場合は「田中・鈴木」形式）
- メッセージカードは200字以内
- 関係性が「取引先」「上司」なら敬語丁寧体、「友人」「親戚（同世代）」なら親しみやすい文体
- 水産加工品らしい季節感・産地への言及を自然に入れる
- 過度な形式文句は避け、人の温かみが感じられる文章に

【出力（JSONのみ）】
{
  "uwagaki": "表書き文字列",
  "shitaname": "熨斗下の名前",
  "cardMessage": "メッセージカード本文",
  "formality": "丁寧" | "親しみ"
}`,
      },
    ],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('熨斗情報のJSON解析失敗');

  return JSON.parse(jsonMatch[0]) as NoshiResult;
}
```

### 3. Shopify Webhook から受け取って処理

```typescript
// pages/api/shopify-gift-webhook.ts (Next.js API Route)
import type { NextApiRequest, NextApiResponse } from 'next';
import { generateGiftContent } from '@/lib/gift-generator';
import { createNoshiPdf } from '@/lib/pdf-generator';

interface ShopifyOrder {
  id: number;
  note_attributes: Array<{ name: string; value: string }>;
  // ...
}

function extractGiftInfo(order: ShopifyOrder): GiftInfo | null {
  const attrs = Object.fromEntries(
    order.note_attributes.map((a) => [a.name, a.value])
  );

  if (!attrs['gift_purpose']) return null;

  return {
    purpose: attrs['gift_purpose'],
    senderName: attrs['gift_sender'] ?? '（送り主名未入力）',
    recipientName: attrs['gift_recipient'] ?? undefined,
    relationship: attrs['gift_relationship'] ?? undefined,
    customMessage: attrs['gift_message'] ?? undefined,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const order = req.body as ShopifyOrder;
  const giftInfo = extractGiftInfo(order);

  if (!giftInfo) {
    return res.status(200).json({ message: 'ギフト注文ではないためスキップ' });
  }

  const result = await generateGiftContent(giftInfo);
  const pdfPath = await createNoshiPdf(result, order.id);

  // 業者さんへ通知メール
  await sendNotificationEmail({
    orderId: order.id,
    giftInfo,
    result,
    pdfPath,
  });

  return res.status(200).json({ success: true, result });
}
```

### 4. Shopifyの注文フォームにカスタムフィールドを追加

Shopifyのギフト情報入力フィールドは `cart.js` に追記する形で追加。

```javascript
// assets/gift-form.js（Shopifyテーマに追加）
const GIFT_PURPOSES = [
  'お中元', 'お歳暮', '内祝い', '快気祝い',
  '結婚祝い', '出産祝い', '新築祝い', 'お礼', 'その他',
];

function insertGiftForm() {
  const form = document.querySelector('form[action="/cart"]');
  if (!form) return;

  const html = `
    <div id="gift-option" style="margin: 16px 0; padding: 16px; border: 1px solid #e0e0e0; border-radius: 8px;">
      <label style="font-weight: bold;">
        <input type="checkbox" id="is-gift"> ギフト包装・熨斗を希望する
      </label>
      <div id="gift-fields" style="display:none; margin-top: 12px;">
        <select name="attributes[gift_purpose]">
          <option value="">-- 用途を選択 --</option>
          ${GIFT_PURPOSES.map((p) => `<option value="${p}">${p}</option>`).join('')}
        </select>
        <input type="text" name="attributes[gift_sender]" placeholder="送り主のお名前（例: 田中太郎）" />
        <input type="text" name="attributes[gift_recipient]" placeholder="送り先のお名前（任意）" />
        <select name="attributes[gift_relationship]">
          <option value="">-- 送り先との関係 --</option>
          <option>上司・職場関係</option>
          <option>取引先</option>
          <option>親族</option>
          <option>友人・知人</option>
        </select>
        <textarea name="attributes[gift_message]" placeholder="一言メモ（任意）：メッセージの雰囲気など"></textarea>
      </div>
    </div>
  `;

  form.insertAdjacentHTML('beforeend', html);

  document.getElementById('is-gift')?.addEventListener('change', (e) => {
    const fields = document.getElementById('gift-fields');
    if (fields) fields.style.display = (e.target as HTMLInputElement).checked ? 'block' : 'none';
  });
}

document.addEventListener('DOMContentLoaded', insertGiftForm);
```

## 実際に生成された出力例

### ケース1：お中元・取引先向け

**入力:**
```json
{
  "purpose": "お中元",
  "senderName": "株式会社〇〇 営業部一同",
  "relationship": "取引先",
  "customMessage": "長年のお付き合いへの感謝を込めて"
}
```

**出力:**
```json
{
  "uwagaki": "御中元",
  "shitaname": "株式会社〇〇 営業部一同",
  "cardMessage": "盛夏の候、貴社ますますご清栄のこととお喜び申し上げます。\n平素より格別のご高配を賜り、厚く御礼申し上げます。\nわずかではございますが、宮城・気仙沼の海の幸をお贈りいたします。旬の味わいをお楽しみいただければ幸いです。\n今後ともご指導のほど、よろしくお願い申し上げます。",
  "formality": "丁寧"
}
```

### ケース2：内祝い・親族向け

**入力:**
```json
{
  "purpose": "内祝い",
  "senderName": "田中 花子",
  "recipientName": "鈴木 様",
  "relationship": "親族",
  "customMessage": "出産内祝い。おじいちゃんへ"
}
```

**出力:**
```json
{
  "uwagaki": "内祝",
  "shitaname": "田中 花子",
  "cardMessage": "このたびは温かいお祝いをいただき、本当にありがとうございました。\nおかげさまで母子ともに元気に過ごしております。\n三陸の新鮮な海の幸を少しばかりお贈りします。どうかゆっくりお召し上がりください。\nまた落ち着いたら顔を見せにお邪魔しますね。",
  "formality": "親しみ"
}
```

丁寧・親しみの文体を自動で切り替えてくれるのが地味にありがたい。

## 結果（お中元シーズン2週間の比較）

| 指標 | Before（手動対応） | After（Claude自動生成） |
|------|------------------|----------------------|
| 熨斗・メッセージ対応の問い合わせ | 1日平均12件 | 1日平均2件（-83%） |
| 1件あたりの対応時間 | 約8分 | 約0分（自動） |
| 注文確定からデータ準備完了まで | 翌日〜当日 | 約30秒 |
| 表書きの誤記・ミス | 月2〜3件 | 0件 |
| 業者さんの感想 | 「お盆前が一番しんどかった」 | 「ギフト注文を怖がらなくなった」 |

「内祝いと快気内祝いで表書きが違うのをいつも調べてた」という悩みがそもそもなくなった。

## コスト

| 項目 | 月額（お中元ピーク月） |
|------|----------------------|
| Claude API（熨斗生成、月300件） | 約45円 |
| Shopify カスタムフィールド | 追加費用なし |
| PDF生成（Puppeteer、Vercel） | 無料枠内 |
| **合計** | **約45円** |

1件あたり0.15円。熨斗対応の問い合わせを1件さばくコストより圧倒的に安い。

## まとめ

熨斗の表書きルールとメッセージの文体は、送り主・用途・関係性がわかれば全部パターン化できる。Claude はその「パターン化できるけど毎回調べるのが面倒」という作業が得意だ。

地方の水産加工業者さんにとってギフト需要は売上の大事な柱だけど、熨斗まわりのマナー対応が「面倒だからギフト注文を取りたくない」という心理につながることがある。自動化でそのストレスをなくしたら、むしろ積極的に「ギフト特集ページ」を作る余裕が生まれた。

次はギフトボックスのメッセージカードに加えて、礼状（御礼の返信用ハガキ文）の自動生成も試す予定。

コードの利用・相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）へどうぞ。
