#!/usr/bin/env node

/**
 * Google ニュース RSS 取得スクリプト
 * 日本語の国内ニュースを取得（無料・登録不要）
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const TOPIC = process.argv[2] || 'security';
const MAX_RESULTS = parseInt(process.argv[3] || '10');

// トピックごとの検索クエリ（日本語）
const TOPIC_QUERIES = {
  security: [
    'サイバーセキュリティ 脆弱性',
    'セキュリティ 情報漏洩',
    'ランサムウェア 攻撃'
  ],
  vendor: [
    'Zscaler OR CrowdStrike OR ソリトン',
    'セキュリティベンダー 新製品 OR 買収',
    'EDR OR SASE OR ゼロトラスト 製品'
  ],
  ai: [
    'AI 人工知能 新技術 日本',
    '生成AI 企業 導入',
    '機械学習 製品'
  ],
  cloud: [
    'AWS OR Azure OR Google Cloud 新機能',
    'クラウド 障害 OR インフラ',
    'クラウドサービス 発表'
  ],
  network: [
    'Cisco OR Palo Alto OR Fortinet 製品',
    'ネットワーク機器 脆弱性 OR 新製品',
    'SD-WAN OR ファイアウォール 企業'
  ],
  enterprise: [
    'SaaS 企業 導入 OR 新機能',
    '情報システム DX 動向',
    'エンタープライズ IT 業務システム'
  ]
};

// RSS の XML をパース（簡易版）
function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];

    const getTag = (tag) => {
      const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`);
      const m = itemXml.match(re);
      if (!m) return '';
      return m[1]
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/<[^>]+>/g, '')
        .trim();
    };

    const title = getTag('title');
    const link = getTag('link');
    const pubDate = getTag('pubDate');
    const description = getTag('description');
    const source = getTag('source');

    if (title) {
      items.push({
        title,
        url: link,
        description: description.substring(0, 300),
        source: source || 'Google News',
        publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString()
      });
    }
  }

  return items;
}

// RSS を取得
function fetchRSS(query) {
  return new Promise((resolve, reject) => {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://news.google.com/rss/search?q=${encodedQuery}&hl=ja&gl=JP&ceid=JP:ja`;

    https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(parseRSS(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  const queries = TOPIC_QUERIES[TOPIC] || [TOPIC];

  console.log(`Fetching Google News RSS for topic: ${TOPIC}`);
  console.log(`Queries: ${queries.length}`);

  let allArticles = [];
  const seenUrls = new Set();
  const seenTitles = new Set();

  for (const query of queries) {
    console.log(`  Query: "${query}"`);
    try {
      const articles = await fetchRSS(query);
      console.log(`    → ${articles.length} articles`);

      for (const article of articles) {
        // 重複除去（URL・タイトル）
        if (seenUrls.has(article.url) || seenTitles.has(article.title)) continue;
        seenUrls.add(article.url);
        seenTitles.add(article.title);
        allArticles.push(article);
      }

      // RSS への負荷軽減
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.error(`    Error: ${e.message}`);
    }
  }

  // 新しい順にソートして上位を取得
  allArticles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  allArticles = allArticles.slice(0, MAX_RESULTS);

  const outputDir = path.join(__dirname, '..', 'output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, `raw-news-${TOPIC}.json`);
  fs.writeFileSync(outputPath, JSON.stringify({ topic: TOPIC, articles: allArticles }, null, 2));

  console.log(`Saved ${allArticles.length} articles to ${outputPath}`);
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});