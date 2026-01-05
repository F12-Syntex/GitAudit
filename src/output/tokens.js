/**
 * Token counting utilities for report files
 */

import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';
import { encode } from 'gpt-tokenizer';
import chalk from 'chalk';

/**
 * Count tokens in a string using GPT tokenizer
 * @param {string} text - Text to count tokens for
 * @returns {number} Token count
 */
export function countTokens(text) {
  return encode(text).length;
}

/**
 * Get token count for a single file
 * @param {string} filePath - Path to file
 * @returns {Promise<Object>} File info with token count
 */
async function getFileTokens(filePath) {
  const content = await readFile(filePath, 'utf-8');
  const tokens = countTokens(content);
  const lines = content.split('\n').length;
  const chars = content.length;

  return {
    path: filePath,
    tokens,
    lines,
    chars,
  };
}

/**
 * Recursively get all markdown files in a directory
 * @param {string} dir - Directory path
 * @returns {Promise<string[]>} List of markdown file paths
 */
async function getMarkdownFiles(dir) {
  const files = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        const subFiles = await getMarkdownFiles(fullPath);
        files.push(...subFiles);
      } else if (entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    // Directory doesn't exist
    return [];
  }

  return files;
}

/**
 * Count tokens across all report files
 * @param {string} reportsDir - Path to reports directory
 * @returns {Promise<Object>} Token statistics
 */
export async function countReportTokens(reportsDir = 'reports') {
  const files = await getMarkdownFiles(reportsDir);

  if (files.length === 0) {
    return {
      files: [],
      summary: null,
      repositories: [],
      totals: {
        totalFiles: 0,
        totalTokens: 0,
        totalLines: 0,
        totalChars: 0,
      },
    };
  }

  const results = {
    files: [],
    summary: null,
    bigExport: null,
    repositories: [],
    totals: {
      totalFiles: 0,
      totalTokens: 0,
      totalLines: 0,
      totalChars: 0,
    },
  };

  for (const filePath of files) {
    const fileInfo = await getFileTokens(filePath);
    results.files.push(fileInfo);

    // Categorize
    if (filePath.endsWith('report.md') && !filePath.includes('repositories')) {
      results.bigExport = fileInfo;
    } else if (filePath.includes('summary.md')) {
      results.summary = fileInfo;
    } else if (filePath.includes('repositories')) {
      results.repositories.push(fileInfo);
    }

    // Aggregate totals
    results.totals.totalFiles++;
    results.totals.totalTokens += fileInfo.tokens;
    results.totals.totalLines += fileInfo.lines;
    results.totals.totalChars += fileInfo.chars;
  }

  // Sort repositories by token count (largest first)
  results.repositories.sort((a, b) => b.tokens - a.tokens);

  return results;
}

/**
 * Format number with commas
 * @param {number} num - Number to format
 * @returns {string} Formatted number
 */
function formatNumber(num) {
  return num.toLocaleString();
}

/**
 * Display token count report in terminal
 * @param {Object} tokenStats - Token statistics from countReportTokens
 */
export function displayTokenReport(tokenStats) {
  const { summary, bigExport, repositories, totals } = tokenStats;

  console.log(chalk.bold.cyan('\n  Token Count Report\n'));
  console.log(chalk.cyan('='.repeat(60)));

  // Big export file
  if (bigExport) {
    console.log(chalk.bold('\nBig Export (Combined):'));
    console.log(`  ${chalk.dim('reports/report.md')}`);
    console.log(`  ${chalk.yellow(formatNumber(bigExport.tokens))} tokens | ${formatNumber(bigExport.lines)} lines | ${formatNumber(bigExport.chars)} chars`);
  }

  // Summary file
  if (summary) {
    console.log(chalk.bold('\nSummary File:'));
    console.log(`  ${chalk.dim('reports/summary.md')}`);
    console.log(`  ${chalk.yellow(formatNumber(summary.tokens))} tokens | ${summary.lines} lines | ${formatNumber(summary.chars)} chars`);
  }

  // Repository files
  if (repositories.length > 0) {
    console.log(chalk.bold(`\nRepository Reports (${repositories.length}):`));

    // Calculate totals for repos only
    const repoTotalTokens = repositories.reduce((sum, r) => sum + r.tokens, 0);

    for (const repo of repositories) {
      const name = repo.path.split(/[/\\]/).pop().replace('.md', '');
      const percentage = ((repo.tokens / repoTotalTokens) * 100).toFixed(1);
      console.log(`  ${chalk.bold(name.padEnd(30))} ${chalk.yellow(formatNumber(repo.tokens).padStart(8))} tokens (${percentage}%)`);
    }
  }

  // Totals
  console.log(chalk.cyan('\n' + '='.repeat(60)));
  console.log(chalk.bold('Totals:'));
  console.log(`  Files:    ${chalk.yellow(totals.totalFiles)}`);
  console.log(`  Tokens:   ${chalk.yellow(formatNumber(totals.totalTokens))}`);
  console.log(`  Lines:    ${chalk.yellow(formatNumber(totals.totalLines))}`);
  console.log(`  Chars:    ${chalk.yellow(formatNumber(totals.totalChars))}`);

  // Cost estimate (rough, based on GPT-4 pricing)
  const estimatedCost = (totals.totalTokens / 1000) * 0.03; // $0.03 per 1K tokens (GPT-4 input)
  console.log(chalk.dim(`\n  Est. cost to process (GPT-4): ~$${estimatedCost.toFixed(4)}`));

  console.log(chalk.cyan('='.repeat(60) + '\n'));
}
