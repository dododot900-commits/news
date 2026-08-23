#!/usr/bin/env node

/**
 * Gemini API processing script - バッチ処理版
 * 全記事を2〜3リクエストにまとめて処理（レート制限対策）
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TOPICS = ['security', 'automotive', 'ai', 'cloud'];
const MAX_KEEP_DAYS = 30;
const BATCH_SIZE = 8; // 1リクエストで処理する記事数

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

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
}

// 複数記事をまとめて1リクエストで処理
async function analyzeBatch(articles) {
  const articleList = articles.map((a, i) => `
記事${i + 1}:
タイトル（英語）: ${a.title || ''}
内容: ${a.description || ''}
ソース: ${a.source || ''}
`).join('\n---\n');

  const prompt = `以下の${articles.length}件のニュース記事を分析してください。

${articleList}

各記事について以下のJSON配列形式のみで回答してください（コードブロックなし）。配列の順番は記事の順番と一致させてください:
[
  {
    "title_ja": "記事1のタイトルを自然な日本語に翻訳",
    "summary": "記事1の要点を2-3文で日本語要約",
    "importance": "高/中/低のいずれか",
    "keywords": ["日本語キーワード1", "日本語キーワード2", "日本語キーワード3"]
  },
  {
    "title_ja": "記事2のタイトルを自然な日本語に翻訳",
    "summary": "記事2の要点を2-3文で日本語要約",
    "importance": "高/中/低のいずれか",
    "keywords": ["日本語キーワード1", "日本語キーワード2", "日本語キーワード3"]
  }
]`;

  try {
    const result = await callGemini(prompt);
    let cleaned = result.replace(/```json|```/g, '').trim();
    const arrStart = cleaned.indexOf('[');
    const arrEnd = cleaned.lastIndexOf(']');
    if (arrStart !== -1 && arrEnd !== -1) {
      cleaned = cleaned.substring(arrStart, arrEnd + 1);
    }
    const parsed = JSON.parse(cleaned);
    console.log(`  ✅ Batch of ${articles.length} articles processed`);
    return parsed;
  } catch (e) {
    console.error(`  ❌ Batch error: ${e.message}`);
    // 失敗した場合は英語のままで返す
    return articles.map(a => ({
      title_ja: a.title || '（タイトルなし）',
      summary: a.description || '',
      importance: '中',
      keywords: []
    }));
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

    // まず全トピックの記事を収集
    let rawArticles = [];
    let stats = { new: 0, followup: 0, skipped: 0 };

    for (const topic of TOPICS) {
      const filePath = path.join(outputDir, `raw-news-${topic}.json`);
      if (!fs.existsSync(filePath)) {
        console.log(`Skipping ${topic}: file not found`);
        continue;
      }

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const articles = data.articles || [];

      for (const article of articles) {
        if (!article || !article.title) {
          stats.skipped++;
          continue;
        }

        const duplicate = checkDuplicate(article, prevArticles);

        if (duplicate.type === 'same') {
          stats.skipped++;
          continue;
        }

        rawArticles.push({
          ...article,
          topic,
          is_followup: duplicate.type === 'similar',
          prev: duplicate.prev || null
        });
      }
    }

    console.log(`\nTotal articles to process: ${rawArticles.length}`);

    // バッチ処理（BATCH_SIZE件ずつまとめてGeminiに送る）
    const todayArticles = [];
    const batches = [];
    for (let i = 0; i < rawArticles.length; i += BATCH_SIZE) {
      batches.push(rawArticles.slice(i, i + BATCH_SIZE));
    }

    console.log(`Processing in ${batches.length} batches of up to ${BATCH_SIZE} articles each\n`);

    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi];
      console.log(`Batch ${bi + 1}/${batches.length} (${batch.length} articles)...`);

      const results = await analyzeBatch(batch);

      for (let i = 0; i < batch.length; i++) {
        const article = batch[i];
        const analysis = results[i] || {
          title_ja: article.title,
          summary: article.description || '',
          importance: '中',
          keywords: []
        };

        if (article.is_followup) {
          stats.followup++;
        } else {
          stats.new++;
        }

        todayArticles.push({
          id: `${article.topic}-${Date.now()}-${i}`,
          title_en: article.title,
          title: analysis.title_ja || article.title,
          summary: analysis.summary || article.description || '',
          importance: analysis.importance || '中',
          keywords: analysis.keywords || [],
          is_followup: article.is_followup,
          progress: article.is_followup ? '前回から更新あり' : null,
          source: article.source,
          url: article.url,
          publishedAt: article.publishedAt,
          topic: article.topic,
          upCount: 0,
          downCount: 0
        });
      }

      // バッチ間は4秒待機
      if (bi < batches.length - 1) {
        console.log('  Waiting 4s before next batch...');
        await sleep(4000);
      }
    }

    // 重要度順にソート
    const order = { '高': 0, '中': 1, '低': 2 };
    todayArticles.sort((a, b) => {
      if (a.is_followup !== b.is_followup) return a.is_followup ? 1 : -1;
      return (order[a.importance] || 1) - (order[b.importance] || 1);
    });

    // allNews に保存
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
    console.log(`   Gemini リクエスト数: ${batches.length}回`);
    console.log(`   保存日付数: ${allNews.dates.length}日分`);

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

processNews();