#!/usr/bin/env node

/**
 * Gemini API processing script - 4トピック対応版
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TOPICS = ['security', 'automotive', 'ai', 'cloud'];

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
          if (json.error) { reject(new Error(json.error.message)); return; }
          resolve(json.candidates?.[0]?.content?.parts?.[0]?.text || '');
        } catch (e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function analyzeArticle(article, topic) {
  const prompt = `以下のニュース記事を日本語で分析してください。

タイトル: ${article.title}
内容: ${article.description || ''}
ソース: ${article.source}

以下のJSON形式のみで回答してください（コードブロックなし）:
{
  "summary": "2-3文の日本語要約",
  "importance": "高/中/低のいずれか",
  "keywords": ["キーワード1", "キーワード2", "キーワード3"]
}`;

  try {
    const result = await callGemini(prompt);
    const cleaned = result.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return { summary: article.description || '', importance: '中', keywords: [] };
  }
}

async function processNews() {
  try {
    const outputDir = path.join(__dirname, '..', 'output');
    const docsDataDir = path.join(__dirname, '..', 'docs', 'data');
    [outputDir, docsDataDir].forEach(d => {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    });

    // 全トピックの記事を収集
    let allArticles = [];

    for (const topic of TOPICS) {
      const filePath = path.join(outputDir, `raw-news-${topic}.json`);
      if (!fs.existsSync(filePath)) {
        console.log(`Skipping ${topic}: file not found`);
        continue;
      }

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const articles = data.articles || [];
      console.log(`Processing ${articles.length} articles for topic: ${topic}`);

      for (let i = 0; i < articles.length; i++) {
        const article = articles[i];
        console.log(`  [${topic}] ${i + 1}/${articles.length}: ${article.title?.substring(0, 40)}...`);

        const analysis = await analyzeArticle(article, topic);

        allArticles.push({
          id: `${topic}-${i}`,
          title: article.title,
          summary: analysis.summary,
          importance: analysis.importance,
          keywords: analysis.keywords,
          source: article.source,
          url: article.url,
          publishedAt: article.publishedAt,
          topic: topic,
          upCount: 0,
          downCount: 0
        });

        // API レート制限対策（少し待つ）
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // 重要度順にソート
    const importanceOrder = { '高': 0, '中': 1, '低': 2 };
    allArticles.sort((a, b) =>
      (importanceOrder[a.importance] || 1) - (importanceOrder[b.importance] || 1)
    );

    // JSON を保存
    const date = new Date().toISOString().split('T')[0];
    const outputData = {
      date,
      generatedAt: new Date().toISOString(),
      totalArticles: allArticles.length,
      topics: TOPICS,
      articles: allArticles
    };

    fs.writeFileSync(
      path.join(docsDataDir, `news-${date}.json`),
      JSON.stringify(outputData, null, 2)
    );
    fs.writeFileSync(
      path.join(docsDataDir, 'latest.json'),
      JSON.stringify(outputData, null, 2)
    );

    console.log(`\nDone! ${allArticles.length} articles saved to docs/data/news-${date}.json`);

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

processNews();
