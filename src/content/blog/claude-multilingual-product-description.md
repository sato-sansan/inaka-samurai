---
title: "Claude APIでShopify商品説明文を英語・中国語に自動翻訳した話【インバウンド対応】"
description: "前回の商品説明文自動生成の続き。Claude APIで日本語の商品説明を英語・簡体字中国語に翻訳。EC多言語化のコストを1/10にした実装例を全公開。"
pubDate: 2026-08-02
author: sam
category: "Claude活用"
tags: ["Claude", "Shopify", "多言語対応", "インバウンド", "翻訳", "自動化", "水産業"]
readingTime: 8
---

## 前回の続き

[前回の記事](/blog/claude-shopify-product-description)で、気仙沼の水産加工業者さんのShopify商品説明文をClaude APIで自動生成した。

あの記事の最後に「次は多言語対応を試す予定」と書いたので、今回はその実装レポート。

## なぜ多言語対応が必要になったか

ECサイトを公開してから、業者さんから連絡が来た。

「外国人のお客さんから英語でメッセージが来るんだけど、どうしたらいい？」

調べてみると、気仙沼産カツオや牡蠣はアジア圏の旅行者・在日外国人にも需要がある。地方の海産物ECはインバウンド需要を全然取りこぼしている。

やるなら英語と中国語（簡体字）の2言語から。

## 実装コード

### 1. 翻訳関数

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

type SupportedLanguage = 'en' | 'zh-CN';

interface TranslationResult {
  language: SupportedLanguage;
  catchphrase: string;
  description: string;
  howToEat: string[];
  detailedDescription: string;
}

async function translateProductDescription(
  japaneseContent: {
    catchphrase: string;
    description: string;
    howToEat: string[];
    detailedDescription: string;
  },
  targetLang: SupportedLanguage
): Promise<TranslationResult> {
  const langInstruction =
    targetLang === 'en'
      ? '英語（自然なネイティブ表現で、食品ECに合ったトーン）'
      : '中国語簡体字（中国本土の消費者向け、日本産食品に対して自然な表現）';

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: `あなたは日本の食品ECサイトの多言語化専門コピーライターです。
以下の日本語商品説明を${langInstruction}に翻訳してください。

【翻訳元（日本語）】
キャッチコピー: ${japaneseContent.catchphrase}
商品説明: ${japaneseContent.description}
おすすめの食べ方:
${japaneseContent.howToEat.map((h, i) => `${i + 1}. ${h}`).join('\n')}
詳細説明: ${japaneseContent.detailedDescription}

【重要な指示】
- 直訳ではなく、ターゲット市場の消費者に響く表現を選ぶ
- 日本の食品・産地ブランドへの誇りを自然に伝える
- Shopifyの商品ページに使える長さ・トーンにする

【出力フォーマット（JSONのみ）】
{
  "catchphrase": "翻訳後のキャッチコピー",
  "description": "翻訳後の商品説明",
  "howToEat": ["食べ方1", "食べ方2", "食べ方3"],
  "detailedDescription": "翻訳後の詳細説明"
}`,
      },
    ],
  });

  const responseText =
    message.content[0].type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON解析失敗');

  const parsed = JSON.parse(jsonMatch[0]);
  return { language: targetLang, ...parsed };
}
```

### 2. 一括翻訳（50商品 × 2言語）

```typescript
interface ProductContent {
  productId: string;
  ja: {
    catchphrase: string;
    description: string;
    howToEat: string[];
    detailedDescription: string;
  };
}

async function translateAllProducts(
  products: ProductContent[]
): Promise<void> {
  const results = await Promise.all(
    products.flatMap((product) =>
      (['en', 'zh-CN'] as SupportedLanguage[]).map(async (lang) => {
        const translated = await translateProductDescription(product.ja, lang);
        return {
          productId: product.productId,
          ...translated,
        };
      })
    )
  );

  // Shopify CSVフォーマットで出力
  const csvRows = results.map((r) => ({
    Handle: r.productId,
    'Body (HTML)': buildShopifyHtml(r),
    'Metafield: language [single_line_text_field]': r.language,
  }));

  console.log(JSON.stringify(csvRows, null, 2));
}

function buildShopifyHtml(content: TranslationResult): string {
  return `<p><strong>${content.catchphrase}</strong></p>
<p>${content.description}</p>
<h3>${content.language === 'en' ? 'How to Enjoy' : '食用建议'}</h3>
<ul>${content.howToEat.map((h) => `<li>${h}</li>`).join('')}</ul>
<p>${content.detailedDescription}</p>`;
}
```

### 3. Shopify多言語対応の実際の設定

Shopifyで多言語対応するには「Markets」機能が必要。設定手順：

1. **Shopify管理画面** → 設定 → Markets で「International」を追加
2. **Shopify Translate & Adapt アプリ**（無料）をインストール
3. APIで生成した翻訳テキストをCSVでインポート、またはGraphQL APIで直接投入

今回はGraphQL APIで自動化した：

```typescript
const SHOPIFY_TRANSLATION_MUTATION = `
  mutation translationsRegister($resourceId: ID!, $translations: [TranslationInput!]!) {
    translationsRegister(resourceId: $resourceId, translations: $translations) {
      translations {
        key
        value
        locale
      }
    }
  }
`;

async function registerTranslation(
  productGid: string,
  locale: string,
  bodyHtml: string
): Promise<void> {
  const response = await fetch(
    `https://${process.env.SHOPIFY_STORE}.myshopify.com/admin/api/2024-01/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN!,
      },
      body: JSON.stringify({
        query: SHOPIFY_TRANSLATION_MUTATION,
        variables: {
          resourceId: productGid,
          translations: [
            { key: 'body_html', value: bodyHtml, locale },
          ],
        },
      }),
    }
  );
  const data = await response.json();
  console.log(`Translated product ${productGid} → ${locale}`, data);
}
```

## 実際の出力例

**日本語原文：**
> 三陸の海が育てた、藁焼き本カツオ

**英語：**
> Wild-Caught Katsuo from the Sanriku Sea — Straw-Smoked the Traditional Way

**中国語（簡体字）：**
> 三陆海域的野生鲣鱼，传统稻草熏烤工艺

単純な直訳ではなく、各言語圏の消費者に響く表現に整えてくれる。

## コストと効果

**翻訳コスト（50商品 × 2言語）**

| 項目 | 数値 |
|------|------|
| 平均入力トークン | 約700/商品 |
| 平均出力トークン | 約600/商品 |
| 50商品 × 2言語の合計コスト | 約320円 |
| 従来の翻訳会社への発注コスト | 約3〜5万円 |

**時間**

| 作業 | Before（外注） | After（Claude） |
|------|---------------|-----------------|
| 翻訳発注〜納品 | 1〜2週間 | 約5分（API実行） |
| 確認・修正 | 1〜2日 | 30分 |

業者さんの感想：「値段も速さも桁が違う。品質も十分」

## 注意点

**品質チェックは必須**

特に中国語は食品表示・景品表示の規制が日本と異なる。生成後は必ずネイティブスピーカーか専門家に確認してもらう。今回は中国語ネイティブの知人に30分見てもらって3箇所修正した。

**SEKIYUキーワードは手動で追加**

Claude はターゲット言語のSEOキーワードを考慮しないので、英語なら "Japanese wagyu" "umami" など、中国語なら "日本直邮" など、人気検索語は別途リサーチして差し込む。

## まとめ

日本語の商品説明が揃っていれば、多言語化は**APIコスト数百円・作業時間30分**で完結する。

地方の食品ECが多言語対応していないのは「お金と時間がかかる」と思っているから。今はそのハードルがほぼ消えている。

次は多言語のSNS投稿（Instagram・Xiaohongshu）自動生成を試す予定。

試してみたい方・自社に合わせたカスタマイズ相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）へどうぞ。
