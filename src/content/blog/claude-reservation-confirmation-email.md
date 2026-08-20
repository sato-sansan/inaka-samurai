---
title: "Claude APIで民宿・体験農業の予約確認メールを自動生成した話【三陸の観光業者での実装例】"
description: "宮城・岩手の民宿や体験農園を運営する事業者さん向けに、Claude APIで予約確認メールを自動生成するツールを作りました。手書きのコピペ作業が消え、誤送信リスクもゼロに。"
pubDate: 2026-08-20
author: sam
category: "Claude活用"
tags: ["Claude", "観光業", "民宿", "自動化", "メール", "体験農業", "三陸"]
readingTime: 6
---

## きっかけ

三陸海岸沿いで民宿と磯遊び体験を営んでいる事業者さんから相談を受けた。

「予約が入るたびにメールを手打ちしてるんだけど、名前と日程を間違えて送ってしまって…。繁忙期は1日10件以上来るから追いつかない」

聞けば、過去に「Aさん宛のメールにBさんの名前が入っていた」という失敗もあったとのこと。誤送信は信頼に直結する。

これ、Claude APIで解決できると思った。

## 作ったもの

予約フォームから飛んでくる情報（氏名・人数・日程・プラン・特記事項）を受け取り、その宿のトーンに合った予約確認メールを自動生成するツール。

**出力内容：**
- 件名（日程と宿名を含む）
- 本文（冒頭挨拶 → 予約内容確認 → 持ち物・注意事項 → アクセス案内 → 締め）
- 予約情報のサマリー（確認用）

## 実装コード

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface ReservationInfo {
  guestName: string;       // 予約者氏名
  numberOfGuests: number;  // 人数
  checkIn: string;         // チェックイン日（例: "2026-09-15"）
  checkOut: string;        // チェックアウト日
  planName: string;        // プラン名
  specialRequests?: string; // 特記事項・アレルギー等
  innName: string;         // 宿・施設名
  innContact: string;      // 問い合わせ先電話番号
}

async function generateConfirmationEmail(reservation: ReservationInfo): Promise<{
  subject: string;
  body: string;
}> {
  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `あなたは地方の小規模宿泊施設・体験農園のスタッフです。
以下の予約情報をもとに、温かみのある予約確認メールを日本語で作成してください。

【予約情報】
施設名: ${reservation.innName}
予約者氏名: ${reservation.guestName} 様
人数: ${reservation.numberOfGuests}名
チェックイン: ${reservation.checkIn}
チェックアウト: ${reservation.checkOut}
プラン: ${reservation.planName}
特記事項: ${reservation.specialRequests ?? 'なし'}
お問い合わせ先: ${reservation.innContact}

【出力フォーマット】
件名: （日程と施設名を含む、30字以内）
本文:
（以下の構成で書いてください）
1. 感謝と歓迎の挨拶（2〜3文）
2. 予約内容の確認（箇条書き）
3. ご来訪前のご案内（持ち物・服装・注意事項など、プランに合わせて）
4. アクセスと駐車場の案内（三陸エリアを想定した簡潔な一文）
5. 締め・連絡先案内

全体的に丁寧だが堅すぎず、地域の温かみが伝わるトーンにしてください。`,
      },
    ],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '';

  // 件名と本文を分割
  const subjectMatch = text.match(/件名[:：]\s*(.+)/);
  const bodyMatch = text.match(/本文[:：]?\s*([\s\S]+)/);

  return {
    subject: subjectMatch?.[1]?.trim() ?? `【${reservation.innName}】ご予約確認`,
    body: bodyMatch?.[1]?.trim() ?? text,
  };
}

// 使用例
const result = await generateConfirmationEmail({
  guestName: '田中 花子',
  numberOfGuests: 4,
  checkIn: '2026-09-15',
  checkOut: '2026-09-16',
  planName: '磯遊び体験＋夕食付き（カキ・ホヤの浜焼き）',
  specialRequests: '甲殻類アレルギー（1名）',
  innName: '三陸の宿 潮風荘',
  innContact: '0192-XX-XXXX',
});

console.log('【件名】', result.subject);
console.log('【本文】', result.body);
```

## 実際の出力例

```
【件名】
【潮風荘】9/15ご予約ありがとうございます

【本文】
田中 花子 様

この度は「三陸の宿 潮風荘」にご予約いただき、誠にありがとうございます。
ご家族・ご友人とのひとときを、スタッフ一同心よりお待ちしております。

■ご予約内容のご確認
━━━━━━━━━━━━━━━━━━
・チェックイン：2026年9月15日
・チェックアウト：2026年9月16日
・ご利用人数：4名様
・プラン：磯遊び体験＋夕食付き（カキ・ホヤの浜焼き）
・特記事項：甲殻類アレルギー（1名様）
━━━━━━━━━━━━━━━━━━

■ご来訪前のご案内
甲殻類アレルギーの方がいらっしゃるとのこと、承知いたしました。
夕食では該当食材を除いたお料理をご用意いたします。当日ご到着の際に
スタッフへもお声がけください。

磯遊び体験では、岩場を歩きますので動きやすい靴をおすすめします。
濡れても良い服装、着替え、タオルをお持ちください。

■アクセス・駐車場
三陸道ICから車で約15分です。無料駐車場を完備しております。
（詳細マップはこちら: [GoogleMapsリンク]）

ご不明な点は下記までお気軽にどうぞ。
TEL: 0192-XX-XXXX（受付時間 9:00〜20:00）

ご来訪を楽しみにしております。
三陸の宿 潮風荘 スタッフ一同
```

特記事項（アレルギー）が本文にしっかり反映されているのがポイント。コピペミスではなく、AIが文脈を読んで組み込んでくれる。

## 予約フォームと連携する

実際の運用ではGoogleフォームとGASを組み合わせて自動化した。

```javascript
// Google Apps Script（予約フォーム送信時に発火）
function onFormSubmit(e) {
  const responses = e.namedValues;

  const reservationJson = JSON.stringify({
    guestName: responses['お名前'][0],
    numberOfGuests: parseInt(responses['人数'][0]),
    checkIn: responses['チェックイン'][0],
    checkOut: responses['チェックアウト'][0],
    planName: responses['プラン'][0],
    specialRequests: responses['特記事項（アレルギー等）'][0] || 'なし',
    innName: '三陸の宿 潮風荘',
    innContact: '0192-XX-XXXX',
  });

  // Cloud Functionsにポスト → Claude APIで本文生成 → SendGridでメール送信
  const apiUrl = 'https://YOUR_FUNCTION_URL/generate-confirmation';
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: reservationJson,
  };
  UrlFetchApp.fetch(apiUrl, options);
}
```

Googleフォームに予約が入った瞬間、Claude APIが文章を作り、SendGridが送信する。オーナーさんはメールを「確認」するだけでよくなった。

## 結果

| 作業 | Before | After |
|------|--------|-------|
| 確認メール1件あたりの作業時間 | 5〜10分 | 30秒（目視確認のみ） |
| 繁忙期（10件/日）の合計時間 | 約1.5時間 | 約5分 |
| 誤送信・記入ミス | 月1〜2件 | ゼロ |

オーナーさんの感想：「繁忙期に子どもの世話をしながらメール対応していたのが本当につらかった。これで夕方の時間が返ってきた」

## まとめ

予約確認メールは「定型 × 個別情報の差し込み」という点でAI生成がもっとも向いているユースケースの一つ。特に特記事項（アレルギー・記念日・子供の年齢など）を文章に自然に組み込んでくれる点が、単純なテンプレート差し込みとの大きな違いです。

民宿・農家民宿・体験農園・釣り船など、繁忙期に予約対応が集中する地方の観光業者さんにそのまま使ってもらえるはずです。

実装の相談はX（[@sam_sanrikutech](https://x.com/sam_sanrikutech)）までどうぞ。
