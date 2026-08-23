#!/usr/bin/env node

/**
 * News fetch script
 * Fetches articles from News API (https://newsapi.org)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.NEWS_API_KEY || 'YOUR_NEWS_API_KEY';
const TOPIC = process.argv[2] || 'security';
const MAX_RESULTS = parseInt(process.argv[3] || '5');

// News API endpoint
const API_URL = `https://newsapi.org/v2/everything`;

// Topic keywords mapping
const TOPIC_KEYWORDS = {
  security: 'cybersecurity vulnerability',
  automotive: 'automotive vehicle manufacturing',
  ai: 'artificial intelligence machine learning',
  cloud: 'cloud infrastructure AWS Azure'
};

const query = TOPIC_KEYWORDS[TOPIC] || TOPIC;

console.log(`Fetching news for topic: ${TOPIC}`);
console.log(`Query: "${query}"`);
console.log(`Max results: ${MAX_RESULTS}`);

const params = new URLSearchParams({
  q: query,
  sortBy: 'publishedAt',
  language: 'en',
  pageSize: MAX_RESULTS,
  apiKey: API_KEY
});

const url = `${API_URL}?${params.toString()}`;

const options = {
  hostname: 'newsapi.org',
  path: `/v2/everything?${params.toString()}`,
  headers: {
    'User-Agent': 'claude-news-app/1.0',
    'X-Api-Key': API_KEY
  }
};

https.get(options, (res) => {
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

      // Create output directory
      const outputDir = path.join(__dirname, '..', 'output');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Save to JSON file
      const outputPath = path.join(outputDir, 'raw-news.json');
      fs.writeFileSync(outputPath, JSON.stringify({ topic: TOPIC, articles }, null, 2));

      console.log(`Successfully fetched ${articles.length} articles`);
      console.log(`Saved to: ${outputPath}`);

      // Set GitHub Actions output
      fs.appendFileSync(process.env.GITHUB_OUTPUT || '/dev/null',
        `articles_count=${articles.length}\n`);

    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });
}).on('error', (error) => {
  console.error('Network error:', error.message);
  process.exit(1);
});
