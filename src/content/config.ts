import { defineCollection, z, reference } from 'astro:content';

// ── 著者定義（将来の複数人化に対応）────────────────────────────
const authors = defineCollection({
  type: 'data',
  schema: z.object({
    name:       z.string(),
    nameEn:     z.string().optional(),
    bio:        z.string(),
    avatar:     z.string().optional(),
    role:       z.string(),
    twitter:    z.string().optional(),
    instagram:  z.string().optional(),
  }),
});

// ── 共通フィールド ─────────────────────────────────────────────
const baseFields = z.object({
  title:       z.string(),
  description: z.string(),
  pubDate:     z.coerce.date(),
  updatedDate: z.coerce.date().optional(),
  author:      reference('authors').default('sam'),
  tags:        z.array(z.string()).default([]),
  draft:       z.boolean().default(false),
  ogImage:     z.string().optional(),
});

// ── 1. ワンコインSaaS ─────────────────────────────────────────
const saas = defineCollection({
  type: 'content',
  schema: baseFields.extend({
    appName:      z.string(),
    price:        z.string(),          // 例: "月500円〜"
    priceNote:    z.string().optional(),
    category:     z.enum(['在庫管理', '議事録', 'CRM', 'その他']),
    appUrl:       z.string().url().optional(),
    isFeatured:   z.boolean().default(false),
    oneCoin:      z.boolean().default(true), // バッジ表示フラグ
  }),
});

// ── 2. AI・テックログ ─────────────────────────────────────────
const blog = defineCollection({
  type: 'content',
  schema: baseFields.extend({
    category: z.enum(['Claude活用', 'Notion', 'Shopify', 'その他テック']),
    readingTime: z.number().optional(), // 分
  }),
});

// ── 3. パフォーマンスログ（分子栄養学）────────────────────────
const performance = defineCollection({
  type: 'content',
  schema: baseFields.extend({
    category: z.enum(['栄養', '睡眠', '運動', 'サプリ', 'メンタル', 'その他']),
    disclaimer: z.string().default(
      'この記事は医療アドバイスではありません。実践の際はかかりつけ医にご相談ください。'
    ),
  }),
});

// ── 4. お遊び・ゲーム ─────────────────────────────────────────
const game = defineCollection({
  type: 'content',
  schema: baseFields.extend({
    playUrl:  z.string().url().optional(), // ゲームのプレイURL
    techUsed: z.array(z.string()).default([]),
    status:   z.enum(['公開中', '開発中', 'アーカイブ']).default('公開中'),
  }),
});

export const collections = { authors, saas, blog, performance, game };
