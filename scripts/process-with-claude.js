#!/usr/bin/env node

/**
 * Claude API processing script
 * Processes fetched news articles using Claude API
 */

const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const client = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

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

    console.log(`Processing ${articles.length} articles with Claude...`);

    // Prepare articles summary for Claude
    const articlesSummary = articles
      .map((a, i) => `Article ${i + 1}:\nTitle: ${a.title}\nDescription: ${a.description}\nSource: ${a.source}\nDate: ${a.publishedAt}`)
      .join('\n\n');

    const prompt = `Please analyze and summarize the following news articles:

${articlesSummary}

Provide:
1. A brief overview of the main trends
2. Key points from each article
3. Importance level (High/Medium/Low) for each
4. Related keywords
5. Overall summary

Format the response in clear markdown.`;

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

    console.log('Claude processing completed');
    console.log('\nGenerated Summary:\n');
    console.log(summary);

    // Save summary to file
    const outputDir = path.join(__dirname, '..', 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const summaryFile = path.join(outputDir, 'news-summary.md');
    fs.writeFileSync(summaryFile, summary);
    console.log(`\nSummary saved to: ${summaryFile}`);

    // Set GitHub Actions output
    const gitHubOutput = process.env.GITHUB_OUTPUT;
    if (gitHubOutput) {
      fs.appendFileSync(gitHubOutput, `summary<<EOF\n${summary}\nEOF\n`);
    }

    return summary;

  } catch (error) {
    console.error('Error processing news:', error.message);
    process.exit(1);
  }
}

// Run
processNews().then(() => {
  console.log('All processing complete');
}).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
