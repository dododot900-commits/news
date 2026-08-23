#!/usr/bin/env node

/**
 * Gemini API processing script
 * Processes fetched news articles using Google Gemini API (Free tier)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = 'generativelanguage.googleapis.com';

async function callGemini(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }]
    });

    const options = {
      hostname: GEMINI_API_URL,
      path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            reject(new Error(json.error.message));
            return;
          }
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
          resolve(text);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function processNews() {
  try {
    // Read fetched news
    const newsFilePath = process.env.FETCHED_NEWS_FILE ||
      path.join(__dirname, '..', 'output', 'raw-news.json');

    if (!fs.existsSync(newsFilePath)) {
      throw new Error(`News file not found: ${newsFilePath}`);
    }

    const newsData = JSON.parse(fs.readFileSync(newsFilePath, 'utf-8'));
    const articles = newsData.articles || [];

    console.log(`Processing ${articles.length} articles with Gemini...`);

    // Prepare articles summary
    const articlesSummary = articles
      .map((a, i) => `Article ${i + 1}:\nTitle: ${a.title}\nDescription: ${a.description}\nSource: ${a.source}\nDate: ${a.publishedAt}`)
      .join('\n\n');

    const prompt = `以下のニュース記事を日本語で分析・要約してください：

${articlesSummary}

以下の形式で出力してください：

## ニュース要約 - ${new Date().toLocaleDateString('ja-JP')}

### 全体的なトレンド
（全体の傾向を2-3文で）

### 記事別サマリー
各記事について：
- **タイトル**: （原題）
- **要点**: （日本語で2-3文）
- **重要度**: 高/中/低
- **キーワード**: （3-5個）

### まとめ・注目ポイント
（重要なポイントと推奨アクションを箇条書きで）`;

    const summary = await callGemini(prompt);

    console.log('Gemini processing completed');
    console.log('\nGenerated Summary:\n');
    console.log(summary);

    // Save summary to file
    const outputDir = path.join(__dirname, '..', 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const date = new Date().toISOString().split('T')[0];
    const summaryFile = path.join(outputDir, `news-summary-${date}.md`);
    fs.writeFileSync(summaryFile, summary);
    console.log(`\nSummary saved to: ${summaryFile}`);

    // Also save as latest
    fs.writeFileSync(path.join(outputDir, 'news-summary.md'), summary);

    // Set GitHub Actions output
    const gitHubOutput = process.env.GITHUB_OUTPUT;
    if (gitHubOutput) {
      fs.appendFileSync(gitHubOutput, `summary<<EOF\n${summary}\nEOF\n`);
    }

  } catch (error) {
    console.error('Error processing news:', error.message);
    process.exit(1);
  }
}

processNews().then(() => {
  console.log('All processing complete');
}).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
