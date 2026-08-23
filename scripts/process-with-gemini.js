#!/usr/bin/env node

/**
 * Gemini API processing script
 * Processes news articles and outputs structured JSON for GitHub Pages UI
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function callGemini(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    });

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-3.6-flash:generateContent?key=${GEMINI_API_KEY}`,
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
    const newsFilePath = process.env.FETCHED_NEWS_FILE ||
      path.join(__dirname, '..', 'output', 'raw-news.json');

    if (!fs.existsSync(newsFilePath)) {
      throw new Error(`News file not found: ${newsFilePath}`);
    }

    const newsData = JSON.parse(fs.readFileSync(newsFilePath, 'utf-8'));
    const articles = newsData.articles || [];
    const topic = newsData.topic || 'security';

    console.log(`Processing ${articles.length} articles with Gemini...`);

    // 各記事を Gemini で分析
    const processedArticles = [];

    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      console.log(`Analyzing article ${i + 1}/${articles.length}: ${article.title}`);

      const prompt = `以下のニュース記事を日本語で分析してください。

タイトル: ${article.title}
内容: ${article.description || ''}
ソース: ${article.source}
日付: ${article.publishedAt}

以下のJSON形式のみで回答してください（マークダウンコードブロックなし）:
{
  "summary": "記事の要点を2-3文で日本語要約",
  "importance": "高/中/低のいずれか",
  "keywords": ["キーワード1", "キーワード2", "キーワード3"]
}`;

      try {
        const result = await callGemini(prompt);
        const cleaned = result.replace(/```json|```/g, '').trim();
        const analysis = JSON.parse(cleaned);

        processedArticles.push({
          id: `article-${i}`,
          title: article.title,
          summary: analysis.summary || '',
          importance: analysis.importance || '中',
          keywords: analysis.keywords || [],
          source: article.source,
          url: article.url,
          publishedAt: article.publishedAt,
          topic: topic,
          upCount: 0,
          downCount: 0
        });
      } catch (e) {
        console.error(`Error analyzing article ${i + 1}:`, e.message);
        processedArticles.push({
          id: `article-${i}`,
          title: article.title,
          summary: article.description || '',
          importance: '中',
          keywords: [],
          source: article.source,
          url: article.url,
          publishedAt: article.publishedAt,
          topic: topic,
          upCount: 0,
          downCount: 0
        });
      }
    }

    // 出力ディレクトリを準備
    const date = new Date().toISOString().split('T')[0];
    const outputDir = path.join(__dirname, '..', 'output');
    const docsDataDir = path.join(__dirname, '..', 'docs', 'data');

    [outputDir, docsDataDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });

    // JSON データを保存（GitHub Pages 用）
    const outputData = {
      date,
      topic,
      generatedAt: new Date().toISOString(),
      articles: processedArticles
    };

    // docs/data/ に保存（GitHub Pages から参照）
    fs.writeFileSync(
      path.join(docsDataDir, `news-${date}.json`),
      JSON.stringify(outputData, null, 2)
    );
    fs.writeFileSync(
      path.join(docsDataDir, 'latest.json'),
      JSON.stringify(outputData, null, 2)
    );

    // output/ にも Markdown で保存
    const markdown = processedArticles.map((a, i) => `
## ${i + 1}. ${a.title}

- **要点**: ${a.summary}
- **重要度**: ${a.importance}
- **キーワード**: ${a.keywords.join(', ')}
- **ソース**: ${a.source}
- **URL**: ${a.url}
`).join('\n');

    fs.writeFileSync(
      path.join(outputDir, `news-summary-${date}.md`),
      `# ニュース要約 - ${date}\n\n${markdown}`
    );
    fs.writeFileSync(
      path.join(outputDir, 'news-summary.md'),
      `# ニュース要約 - ${date}\n\n${markdown}`
    );

    console.log(`✅ Saved ${processedArticles.length} articles to docs/data/news-${date}.json`);
    console.log(`✅ Latest data saved to docs/data/latest.json`);

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
