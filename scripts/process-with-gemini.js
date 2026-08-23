#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TOPICS = ['security', 'automotive', 'ai', 'cloud'];
const MAX_KEEP_DAYS = 30;

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function callGemini(prompt, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const result = await new Promise((resolve, reject) => {
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
          res.on('data', chunk => { data += chunk; });
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

      return result;

    } catch (error) {
      const retryMatch = error.message.match(/Please retry in (\d+\.?\d*)/);
      if (retryMatch && attempt < retries - 1) {
        const waitMs = Math.ceil(parseFloat(retryMatch[1])) * 1000 + 3000;
        console.log(`    Rate limited. Waiting ${Math.ceil(waitMs/1000)}s...`);
        await sleep(waitMs);
      } else {
        throw error;
      }
    }
  }
}

function loadAllNews(docsDataDir) {
  const filePath = path.join(docsDataDir, 'all-news.json');
  if (!fs.existsSync(filePath)) return { dates: [], data: {} };
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return { dates: [], data: {} };
  }
}

function getPrevArticles(allNews, today) {
  const dates = allNews.dates || [];
  const prevDates = dates.filter(d => d !== today).sort().reverse();
  if (prevDates.length === 0) return [];
  return allNews.data?.[prevDates[0]]?.articles || [];
}

function checkDuplicate(article, prevArticles) {
  if (prevArticles.some(p => p.url === article.url)) {
    return { type: 'same', prev: prevArticles.find(p => p.url === article.url) };
  }
  const title = article.title || '';
  const words = title.toLowerCase().split(/\s+/).filter(w => w.length > 4);
  for (const prev of prevArticles) {
    const prevWords = (prev.title_en || prev.title || '').toLowerCase().split(/\s+/);
    const common = words.filter(w => prevWords.includes(w));
    if (common.length >= 3) return { type: 'similar', prev };
  }
  return { type: 'new', prev: null };
}

async function analyzeArticle(article, prevArticle = null) {
  const prompt = prevArticle
    ? `以下の2つのニュース記事を比較して、新しい進展・変化点だけを日本語でまとめてください。

【前回の記事】
タイトル: ${prevArticle.title_en || prevArticle.title}
要約: ${prevArticle.summary}

【今回の記事（最新）】
タイトル（英語）: ${article.title}
内容: ${article.description || ''}
ソース: ${article.source}

以下のJSON形式のみで回答してください（コードブロックなし）:
{
  "title_ja": "今回の記事タイトルを日本語に翻訳",
  "summary": "前回から新たに判明した情報・進展を2-3文で日本語要約",
  "importance": "高/中/低のいずれか",
  "keywords": ["日本語キーワード1", "日本語キーワード2", "日本語キーワード3"],
  "is_followup": true,
  "progress": "前回比: [具体的な変化点を1文で]"
}`
    : `以下のニュース記事を分析してください。

タイトル（英語）: ${article.title}
内容: ${article.description || ''}
ソース: ${article.source}

以下のJSON形式のみで回答してください（コードブロックなし）:
{
  "title_ja": "タイトルを自然な日本語に翻訳",
  "summary": "記事の要点を2-3文で日本語要約",
  "importance": "高/中/低のいずれか",
  "keywords": ["日本語キーワード1", "日本語キーワード2", "日本語キーワード3"],
  "is_followup": false
}`;

  try {
    const result = await callGemini(prompt);
    let cleaned = result.replace(/```json|```/g, '').trim();
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) {
      cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
    }
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('    Analysis error:', e.message);
    return {
      title_ja: article.title || '（タイトルなし）',
      summary: article.description || '',
      importance: '中',
      keywords: [],
      is_followup: !!prevArticle,
      progress: prevArticle ? '前回から更新あり' : null
    };
  }
}

async function processNews() {
  try {
    const outputDir = path.join(__dirname, '..', 'output');
    const docsDataDir = path.join(__dirname, '..', 'docs', 'data');
    [outputDir, docsDataDir].forEach(d => {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    });

    const allNews = loadAllNews(docsDataDir);
    const today = new Date().toISOString().split('T')[0];
    const prevArticles = getPrevArticles(allNews, today);
    console.log(`Previous articles: ${prevArticles.length}`);

    let todayArticles = [];
    let stats = { new: 0, followup: 0, skipped: 0 };

    for (const topic of TOPICS) {
      const filePath = path.join(outputDir, `raw-news-${topic}.json`);
      if (!fs.existsSync(filePath)) {
        console.log(`Skipping ${topic}: file not found`);
        continue;
      }

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const articles = data.articles || [];
      console.log(`\nProcessing ${articles.length} articles for: ${topic}`);

      for (let i = 0; i < articles.length; i++) {
        const article = articles[i];

        if (!article || !article.title) {
          console.log(`  [${i + 1}/${articles.length}] → Skipped (no title)`);
          stats.skipped++;
          continue;
        }

        console.log(`  [${i + 1}/${articles.length}] ${article.title.substring(0, 50)}...`);

        const duplicate = checkDuplicate(article, prevArticles);

        if (duplicate.type === 'same') {
          console.log(`    → Skipped (duplicate)`);
          stats.skipped++;
          continue;
        }

        const isPrevArticle = duplicate.type === 'similar' ? duplicate.prev : null;
        const analysis = await analyzeArticle(article, isPrevArticle);

        if (duplicate.type === 'similar') {
          console.log(`    → Follow-up`);
          stats.followup++;
        } else {
          stats.new++;
        }

        todayArticles.push({
          id: `${topic}-${Date.now()}-${i}`,
          title_en: article.title,
          title: analysis.title_ja,
          summary: analysis.summary,
          importance: analysis.importance,
          keywords: analysis.keywords || [],
          is_followup: analysis.is_followup || false,
          progress: analysis.progress || null,
          source: article.source,
          url: article.url,
          publishedAt: article.publishedAt,
          topic,
          upCount: 0,
          downCount: 0
        });

        // レート制限対策：3.5秒待機（1分20件制限に対応）
        await sleep(3500);
      }
    }

    const order = { '高': 0, '中': 1, '低': 2 };
    todayArticles.sort((a, b) => {
      if (a.is_followup !== b.is_followup) return a.is_followup ? 1 : -1;
      return (order[a.importance] || 1) - (order[b.importance] || 1);
    });

    allNews.data = allNews.data || {};
    allNews.data[today] = {
      date: today,
      generatedAt: new Date().toISOString(),
      stats,
      articles: todayArticles
    };

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - MAX_KEEP_DAYS);
    const cutoff = cutoffDate.toISOString().split('T')[0];

    Object.keys(allNews.data).forEach(date => {
      if (date < cutoff) {
        delete allNews.data[date];
        console.log(`Removed old data: ${date}`);
      }
    });

    allNews.dates = Object.keys(allNews.data).sort().reverse();
    allNews.lastUpdated = new Date().toISOString();

    fs.writeFileSync(
      path.join(docsDataDir, 'all-news.json'),
      JSON.stringify(allNews, null, 2)
    );

    fs.writeFileSync(
      path.join(docsDataDir, 'latest.json'),
      JSON.stringify({ date: today, articles: todayArticles, stats }, null, 2)
    );

    console.log(`\n✅ Done!`);
    console.log(`   新規: ${stats.new}件 / 続報: ${stats.followup}件 / スキップ: ${stats.skipped}件`);
    console.log(`   保存日付数: ${allNews.dates.length}日分`);

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

processNews();