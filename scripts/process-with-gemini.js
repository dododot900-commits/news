#!/usr/bin/env node

/**
 * Gemini API processing script
 * - 全記事を日本語化
 * - 前回との重複検出・差分のみ表示
 * - 複数日分を1つのJSONファイルで管理
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TOPICS = ['security', 'automotive', 'ai', 'cloud'];
const MAX_KEEP_DAYS = 30;

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

function loadAllNews(docsDataDir) {
  const filePath = path.join(docsDataDir, 'all-news.json');
  if (!fs.existsSync(filePath)) {
    return { dates: [], data: {} };
  }
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
  const prevDate = prevDates[0];
  return allNews.data?.[prevDate]?.articles || [];
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
    if (common.length >= 3) {
      return { type: 'similar', prev };
    }
  }

  return { type: 'new', prev: null };
}

async function analyzeNewArticle(article) {
  const prompt = `以下のニュース記事を分析してください。

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
    const cleaned = result.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return {
      title_ja: article.title || '（タイトルなし）',
      summary: article.description || '',
      importance: '中',
      keywords: [],
      is_followup: false
    };
  }
}

async function analyzeFollowupArticle(article, prevArticle) {
  const prompt = `以下の2つのニュース記事を比較して、新しい進展・変化点だけを日本語でまとめてください。

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
  "summary": "前回から新たに判明した情報・進展を2-3文で日本語要約。変化がない場合は「前回から大きな変化なし」と記載",
  "importance": "高/中/低のいずれか",
  "keywords": ["日本語キーワード1", "日本語キーワード2", "日本語キーワード3"],
  "is_followup": true,
  "progress": "前回比: [具体的な変化点を1文で]"
}`;

  try {
    const result = await callGemini(prompt);
    const cleaned = result.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return {
      title_ja: article.title || '（タイトルなし）',
      summary: article.description || '',
      importance: '中',
      keywords: [],
      is_followup: true,
      progress: '前回から更新あり'
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

        let analysis;
        if (duplicate.type === 'similar') {
          console.log(`    → Follow-up detected`);
          analysis = await analyzeFollowupArticle(article, duplicate.prev);
          stats.followup++;
        } else {
          analysis = await analyzeNewArticle(article);
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

        await new Promise(r => setTimeout(r, 600));
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