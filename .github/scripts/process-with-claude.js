#!/usr/bin/env node

/**
 * Claude API 処理スクリプト
 * 取得したニュース記事をClaudeで要約・分類
 */

const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const client = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

async function processNews() {
  try {
    // 取得したニュースを読み込み
    const newsFilePath = process.env.FETCHED_NEWS_FILE || 
      path.join(__dirname, '..', 'output', 'raw-news.json');

    if (!fs.existsSync(newsFilePath)) {
      throw new Error(`News file not found: ${newsFilePath}`);
    }

    const newsData = JSON.parse(fs.readFileSync(newsFilePath, 'utf-8'));
    const articles = newsData.articles || [];

    console.log(`📚 Processing ${articles.length} articles with Claude...`);

    // Claudeへのプロンプト
    const articlesSummary = articles
      .map((a, i) => `【記事 ${i + 1}】\nタイトル: ${a.title}\n説明: ${a.description}\nソース: ${a.source}\n日時: ${a.publishedAt}`)
      .join('\n\n');

    const prompt = `以下のニュース記事を分析してください：

${articlesSummary}

以下の形式で出力してください：

## ニュース要約（トピック: ${newsData.topic}）

### 概要
このセクションでは全体的な傾向を1-2文で説明

### 記事別分析
各記事について以下の情報を提供：
- **タイトル**: [元のタイトル]
- **要点**: [2-3文の要約]
- **重要度**: 🔴高 / 🟡中 / 🟢低
- **関連キーワード**: [3-5個のキーワード]

### まとめと推奨アクション
- 注目すべき傾向
- 推奨される対応
- 次のステップ`;

    const message = await client.messages.create({
      model: 'claude-opus-4-1',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: prompt,
        }
      ],
    });

    const summary = message.content[0].type === 'text' ? message.content[0].text : '';

    console.log('✅ Claude processing completed');
    console.log('\n📋 Generated Summary:\n');
    console.log(summary);

    // GitHub Actions の出力に設定
    // 複数行文字列の場合は特別な処理が必要
    const summaryForOutput = summary.replace(/\n/g, '%0A');
    const gitHubOutput = process.env.GITHUB_OUTPUT;
    if (gitHubOutput) {
      fs.appendFileSync(gitHubOutput, `summary<<EOF\n${summary}\nEOF\n`);
    }

    return summary;

  } catch (error) {
    console.error('❌ Error processing news:', error.message);
    process.exit(1);
  }
}

// 実行
processNews().then(() => {
  console.log('✅ All processing complete');
}).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});