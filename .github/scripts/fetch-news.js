#!/usr/bin/env node

/**
 * ニュース取得スクリプト
 * News API（https://newsapi.org）から記事を取得して JSON に保存
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.NEWS_API_KEY || 'YOUR_NEWS_API_KEY';
const TOPIC = process.argv[2] || 'security';
const MAX_RESULTS = parseInt(process.argv[3] || '5');

// News API エンドポイント
const API_URL = `https://newsapi.org/v2/everything`;

// トピックごとの検索キーワード
const TOPIC_KEYWORDS = {
  security: 'cybersecurity vulnerability',
  automotive: 'automotive vehicle manufacturing',
  ai: 'artificial intelligence machine learning',
  cloud: 'cloud infrastructure AWS Azure'
};

const query = TOPIC_KEYWORDS[TOPIC] || TOPIC;

console.log(`📰 Fetching news for topic: ${TOPIC}`);
console.log(`🔍 Query: "${query}"`);
console.log(`📊 Max results: ${MAX_RESULTS}`);

const params = new URLSearchParams({
  q: query,
  sortBy: 'publishedAt',
  language: 'en',
  pageSize: MAX_RESULTS,
  apiKey: API_KEY
});

const url = `${API_URL}?${params.toString()}`;

https.get(url, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      const jsonData = JSON.parse(data);

      if (jsonData.status !== 'ok') {
        throw new Error(`API Error: ${jsonData.message}`);
      }

      const articles = jsonData.articles.slice(0, MAX_RESULTS).map(article => ({
        title: article.title,
        description: article.description,
        url: article.url,
        source: article.source.name,
        publishedAt: article.publishedAt,
        content: article.content
      }));

      // 出力ディレクトリを作成
      const outputDir = path.join(__dirname, '..', 'output');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // JSON ファイルに保存
      const outputPath = path.join(outputDir, 'raw-news.json');
      fs.writeFileSync(outputPath, JSON.stringify({ topic: TOPIC, articles }, null, 2));

      console.log(`✅ Successfully fetched ${articles.length} articles`);
      console.log(`💾 Saved to: ${outputPath}`);

      // GitHub Actions の出力として設定
      fs.appendFileSync(process.env.GITHUB_OUTPUT || '/dev/null', 
        `articles_count=${articles.length}\n`);

    } catch (error) {
      console.error('❌ Error:', error.message);
      process.exit(1);
    }
  });
}).on('error', (error) => {
  console.error('❌ Network error:', error.message);
  process.exit(1);
});