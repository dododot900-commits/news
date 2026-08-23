#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.NEWS_API_KEY || '';
const TOPIC = process.argv[2] || 'security';
const MAX_RESULTS = parseInt(process.argv[3] || '5');

const TOPIC_KEYWORDS = {
  security: 'cybersecurity vulnerability',
  automotive: 'automotive vehicle manufacturing',
  ai: 'artificial intelligence machine learning',
  cloud: 'cloud infrastructure AWS Azure'
};

const query = TOPIC_KEYWORDS[TOPIC] || TOPIC;

console.log(`Fetching news for topic: ${TOPIC}`);
console.log(`Query: "${query}"`);

const params = new URLSearchParams({
  q: query,
  sortBy: 'publishedAt',
  language: 'en',
  pageSize: MAX_RESULTS,
  apiKey: API_KEY
});

const options = {
  hostname: 'newsapi.org',
  path: `/v2/everything?${params.toString()}`,
  headers: {
    'User-Agent': 'daily-news-brief/1.0',
    'X-Api-Key': API_KEY
  }
};

https.get(options, (res) => {
  let data = '';
  res.on('data', chunk => { data += chunk; });
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      if (json.status !== 'ok') throw new Error(`API Error: ${json.message}`);

      const articles = json.articles.slice(0, MAX_RESULTS).map(a => ({
        title: a.title,
        description: a.description,
        url: a.url,
        source: a.source.name,
        publishedAt: a.publishedAt,
        content: a.content
      }));

      const outputDir = path.join(__dirname, '..', 'output');
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

      // トピック別に保存
      const outputPath = path.join(outputDir, `raw-news-${TOPIC}.json`);
      fs.writeFileSync(outputPath, JSON.stringify({ topic: TOPIC, articles }, null, 2));

      console.log(`Saved ${articles.length} articles to ${outputPath}`);
    } catch (e) {
      console.error('Error:', e.message);
      process.exit(1);
    }
  });
}).on('error', e => {
  console.error('Network error:', e.message);
  process.exit(1);
});
