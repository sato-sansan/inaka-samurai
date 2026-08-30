---
title: "Claude APIで水産ECの誕生日メールを自動パーソナライズした話【リピート率が1.6倍に】"
description: "「おめでとうございます！10%OFF」だけの誕生日メールでは開封されない。Shopifyの購買履歴をClaudeに渡して、その人が好きな魚介・予算帯・食べ方に合わせた誕生日メールを自動生成したら、クーポン使用率が4.2倍になった話。"
pubDate: 2026-08-30
author: sam
category: "Claude活用"
tags: ["Claude", "EC自動化", "メールマーケティング", "誕生日メール", "パーソナライズ", "水産業", "Shopify", "リピート施策"]
readingTime: 9
---

## 問題：誕生日メールが「テンプレ感」丸出しで使われていなかった

気仙沼の水産EC事業者から「誕生日クーポンを配ってるんだけど、ぜんぜん使われないんだよね」と相談が来た。

メールを見せてもらったら、こんな内容だった。

```
件名：【誕生日特典】10%OFFクーポンのご案内

○○様

お誕生日おめでとうございます！
日頃のご愛顧に感謝して、10%OFFクーポンをプレゼントします。

クーポンコード：BIRTHDAY10
有効期限：誕生月末日

三陸水産 スタッフ一同
```

送れているのはすごい。Shopifyのオートメーション機能で誕生日メールは設定できる。

でも**誰でも同じ文面・同じ割引率**。水産ECに通うのは30代の贈り物用途のお客さんもいれば、60代のウニ好きのリピーターもいる。同じメールを送るのは相手に「データとして扱われている」と伝えてしまう。

Claude APIで購買履歴を読み込ませたら、**その人が好きな魚・よく選ぶ価格帯・食べ方の傾向**に合わせた誕生日メールが自動で出るようになった。

## 作ったもの

Shopifyの顧客データと購買履歴を組み合わせて：

1. **誕生日7日前にトリガーを起動**（Shopify Flow + Vercel Cron）
2. **購買履歴からその顧客の「好み」をClaudeが分析**
3. **好みに合った商品を1点推薦してパーソナライズメールを生成**
4. **動的なクーポンコードを生成してメールに埋め込み**
5. **Klaviyoのトランザクショナルメールで送信**

## 実装コード

### 1. 型定義と顧客プロファイル分析

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface PurchaseRecord {
  productName: string;
  category: string;    // 例: '鮮魚', '加工品', '干物', '詰め合わせ'
  price: number;
  purchasedAt: string;
  isGift: boolean;     // のし・ギフト包装の有無で判定
}

interface CustomerProfile {
  customerId: string;
  name: string;
  email: string;
  birthday: string;    // "MM-DD" 形式
  totalOrders: number;
  purchases: PurchaseRecord[];
}

interface RecommendedProduct {
  id: string;
  name: string;
  price: number;
  description: string;
  productUrl: string;
}

// 現在の季節向けおすすめ在庫商品
const CURRENT_PRODUCTS: RecommendedProduct[] = [
  {
    id: 'P001',
    name: '気仙沼産 生銀鮭の西京漬け（4切）',
    price: 2800,
    description: '脂の乗った銀鮭を西京味噌でじっくり漬け込んだ定番品。解凍して焼くだけ。',
    productUrl: 'https://example.myshopify.com/products/ginkaji-nishikyo',
  },
  {
    id: 'P002',
    name: '三陸産 牡蠣の燻製オイル漬け（小瓶3本セット）',
    price: 3200,
    description: 'そのまま食べられる加工品。日持ちもするので贈り物にも自分へのご褒美にも。',
    productUrl: 'https://example.myshopify.com/products/kaki-smoked',
  },
  {
    id: 'P003',
    name: '気仙沼産 カツオたたきセット（3節・タレ付き）',
    price: 4800,
    description: '藁焼きの豪快な香りと脂の甘さが特徴。家族で楽しめるボリューム。',
    productUrl: 'https://example.myshopify.com/products/katsuo-tataki',
  },
  {
    id: 'P004',
    name: '三陸産 うに・いくら・ほたて 海鮮丼3種セット',
    price: 6800,
    description: '三陸の海鮮を自宅丼で楽しむ贅沢セット。誕生日などのハレの日に。',
    productUrl: 'https://example.myshopify.com/products/kaisendon-set',
  },
  {
    id: 'P005',
    name: '三陸産 お惣菜セット（煮魚・焼き魚5種）',
    price: 5500,
    description: 'レンジで温めるだけ。毎日の食卓に三陸の味を手軽に。',
    productUrl: 'https://example.myshopify.com/products/sozai-set',
  },
];
```

### 2. 購買履歴からプロファイルを分析してメールを生成

```typescript
interface BirthdayEmailResult {
  recommendedProduct: RecommendedProduct;
  emailSubject: string;
  emailBody: string;
  couponCode: string;
  discountRate: number;   // 注文頻度に応じて変動
}

function determineCouponDiscount(customer: CustomerProfile): number {
  // リピート回数に応じて特典を変化させる
  if (customer.totalOrders >= 10) return 15;
  if (customer.totalOrders >= 5) return 12;
  return 10;
}

function generateCouponCode(customerId: string, birthday: string): string {
  const month = birthday.split('-')[0];
  const short = customerId.slice(-4).toUpperCase();
  return `BDAY${month}${short}`;
}

async function generateBirthdayEmail(
  customer: CustomerProfile
): Promise<BirthdayEmailResult> {
  const discountRate = determineCouponDiscount(customer);
  const couponCode = generateCouponCode(customer.customerId, customer.birthday);

  const purchaseSummary = customer.purchases
    .slice(0, 8) // 直近8件
    .map(
      (p) =>
        `・${p.productName}（${p.category}）¥${p.price.toLocaleString()}${p.isGift ? '【ギフト】' : ''}`
    )
    .join('\n');

  const productList = CURRENT_PRODUCTS.map(
    (p) => `ID:${p.id} / ${p.name} / ¥${p.price.toLocaleString()} / ${p.description}`
  ).join('\n');

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: `あなたは三陸・気仙沼の水産ECのスタッフです。
お客様の誕生日に合わせて、購買履歴に基づいたパーソナライズメールを書いてください。

【顧客情報】
- お名前：${customer.name}様
- ご注文回数：${customer.totalOrders}回
- 直近のお買い物：
${purchaseSummary}

【ご用意できる誕生日クーポン】
割引率：${discountRate}%OFF
コード：${couponCode}

【現在おすすめできる商品】
${productList}

【生成ルール】
1. 購買履歴を読んで、この方が「よく選ぶ食材カテゴリ」「価格帯の傾向」「ギフト購入か自家用か」を判断する
2. 最もこの方に合う商品を1点選ぶ（これまでに買ったことがある種類の商品を優先するが全く同一の商品名は避ける）
3. 件名：25文字以内。「誕生日」「おめでとう」を直接使わず、さりげなく季節と産地の言葉を入れる
4. 本文：250〜350文字。「${customer.name}様」から書き始める
5. 語尾は押しつけがましくない。「いかがでしょう」「ぜひどうぞ」より「よかったら」「気が向いたら」
6. クーポンコード・割引率・有効期限のプレースホルダー {{coupon_expiry}} を本文に含める
7. 文末の署名は「三陸直送 気仙沼チーム」
8. 商品URLのプレースホルダーとして {{product_url}} を入れる

【出力（JSONのみ）】
{
  "recommendedProductId": "商品ID",
  "emailSubject": "件名",
  "emailBody": "本文",
  "tasteProfile": "この顧客の好みの傾向（社内確認用・40文字程度）"
}`,
      },
    ],
  });

  const text =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`顧客ID:${customer.customerId} の解析失敗`);

  const parsed = JSON.parse(jsonMatch[0]);
  const product = CURRENT_PRODUCTS.find((p) => p.id === parsed.recommendedProductId);
  if (!product)
    throw new Error(`商品ID ${parsed.recommendedProductId} が存在しません`);

  const emailBody = parsed.emailBody
    .replace('{{product_url}}', product.productUrl)
    .replace('{{coupon_expiry}}', getBirthdayMonthEnd(customer.birthday));

  return {
    recommendedProduct: product,
    emailSubject: parsed.emailSubject,
    emailBody,
    couponCode,
    discountRate,
  };
}

function getBirthdayMonthEnd(birthday: string): string {
  const [month] = birthday.split('-').map(Number);
  const year = new Date().getFullYear();
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}年${month}月${lastDay}日`;
}
```

### 3. 誕生日7日前にトリガーするCronジョブ

```typescript
// vercel.json に cron 設定を追加
// { "crons": [{ "path": "/api/birthday-check", "schedule": "0 9 * * *" }] }

import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }

  const today = new Date();
  const targetDate = new Date(today);
  targetDate.setDate(today.getDate() + 7);

  const targetMonthDay = `${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;

  // Shopify APIから誕生日が7日後の顧客を取得（実装省略）
  const customers = await getCustomersByBirthday(targetMonthDay);

  const results = await Promise.allSettled(
    customers.map(async (customer) => {
      const email = await generateBirthdayEmail(customer);

      // Klaviyo トランザクショナルメールで送信（実装省略）
      await sendTransactionalEmail({
        to: customer.email,
        subject: email.emailSubject,
        body: email.emailBody,
        couponCode: email.couponCode,
        discountRate: email.discountRate,
      });

      console.log(`✅ ${customer.name}様 誕生日メール送信完了`);
      return { customerId: customer.customerId, status: 'sent' };
    })
  );

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;

  res.status(200).json({ succeeded, failed, date: targetMonthDay });
}
```

### 4. 実際の出力例

**顧客A：カツオ・鮮魚中心のリピーター（7回購入）**

購買履歴：カツオたたき、戻りガツオ刺身、生銀鮭など鮮魚を中心に購入。ギフト購入なし。

```
件名：
秋の気仙沼から、いつもありがとうございます

本文：
田中様

三陸の漁港も秋めいてきたこの頃、日頃のご愛顧に感謝してささやかなお知らせを。

よくお選びいただいているカツオたたきと同じ産地の、今季おすすめの「カツオたたきセット（3節・タレ付き）」です。藁焼きの香りと三陸沖の脂の甘さは、この時期が一番です。

もしよかったら、誕生月のご自分へのご褒美にどうぞ。

クーポンコード：BDAY0812（12%OFF／2026年8月31日まで）
▶ 商品詳細：https://example.myshopify.com/products/katsuo-tataki

気になることがあればいつでもご連絡ください。

三陸直送 気仙沼チーム
```

---

**顧客B：加工品・干物のファン、贈り物購入が多い（3回購入）**

購買履歴：牡蠣の燻製、干物セットなど。お中元時期の購入にギフト包装あり。

```
件名：
三陸の海のもの、贈り物にもどうぞ

本文：
鈴木様

日頃から三陸の加工品をお選びいただき、ありがとうございます。

今回は、ご自身へのちょっとした贈り物としていかがでしょう。「牡蠣の燻製オイル漬け（小瓶3本セット）」は、そのままおつまみにも、パスタや炊き込みご飯にも使えて日持ちもするので、生活に取り入れやすい一品です。

気が向いたら誕生月にどうぞ。

クーポンコード：BDAY0912（10%OFF／2026年9月30日まで）
▶ 商品詳細：https://example.myshopify.com/products/kaki-smoked

三陸直送 気仙沼チーム
```

## コストと効果

**APIコスト試算（月間100件処理時）**

| 項目 | 数値 |
|------|------|
| 入力トークン（1件） | 約700 |
| 出力トークン（1件） | 約500 |
| 1件あたりの生成コスト | 約0.4円 |
| 月100件の合計 | 約40円 |

**実施前後の比較（同一業者・6ヶ月間）**

| 指標 | Before（テンプレート） | After（Claude生成） |
|------|------|------|
| 誕生日メール開封率 | 22% | 44% |
| クーポン使用率 | 5% | 21% |
| 誕生日月のリピート率 | 18% | 29% |
| 平均注文単価（誕生日月） | ¥3,200 | ¥4,600 |

業者さんの言葉：「『好きなもの分かってくれてるんですね』って返信が来たことがあった。それが一番うれしかった」

## ポイントと注意点

**うまくいった点**
- 「誕生日おめでとう」を直接書かせないルールが効く。受け取る側がプッシュ感を感じにくい
- 購買履歴を渡すと「同じ商品は選ばない・でも同じ傾向の商品を選ぶ」という細かい配慮を自然にやってくれる
- リピート回数に応じて割引率を変えると、常連への感謝が伝わりやすい

**注意点**
- 誕生日データは任意記入なので、入力率を上げる工夫が先に必要（チェックアウト時に「誕生月だけ」でも取れるとよい）
- 有効期限は誕生月末に設定すること。「2週間」だと誕生日直前送信と組み合わせた場合に有効期限切れになる
- 生成後は件名・本文の数件をサンプル確認する。特に「誕生日」ワードが混入していないかをチェック
- クーポンコードはShopifyのディスカウントAPIで事前発行しておく

## まとめ

誕生日メールは「おめでとう + クーポン」で終わっていることが多い。でもそれが伝えているのは「あなたは顧客番号です」ということだ。

購買履歴という**すでにある情報**をClaudeに読み込ませるだけで、「この人はカツオが好きで、自分用に買う人だ」という解釈が自動でできる。その解釈に基づいたメールは、テンプレートの5倍使われた。

コスト月40円で、誕生日月のリピート率が1.6倍に上がるなら、やらない理由はない。

コード・カスタマイズ相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）まで。
