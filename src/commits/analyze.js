/**
 * Commit analysis engine
 * Token-efficient batching and analysis of commits
 */

import ora from 'ora';
import chalk from 'chalk';
import { fetchCommitDetails, fetchCommitComparison } from './fetch.js';
import { generateJSON, generate, getUsageReport } from '../llm/openrouter.js';
import { batchCategorizationPrompt, detailedAnalysisPrompt, portfolioSummaryPrompt } from '../llm/prompts.js';

// Time window for batching commits (in hours)
const DEFAULT_TIME_WINDOW_HOURS = 4;

// Maximum commits per batch
const DEFAULT_MAX_BATCH_SIZE = 10;

// Importance threshold for detailed analysis
const IMPORTANCE_THRESHOLD = 3;

/**
 * Batch commits by time proximity and related changes
 * Groups commits that are within timeWindow and touch similar files
 * @param {Object[]} commits - Array of commits (should be sorted by date)
 * @param {Object} options - Batching options
 * @param {number} options.timeWindowHours - Max hours between commits in batch (default: 4)
 * @param {number} options.maxBatchSize - Max commits per batch (default: 10)
 * @returns {Object[]} Array of commit batches
 */
export function batchCommitsByFeature(commits, options = {}) {
  const timeWindowMs = (options.timeWindowHours || DEFAULT_TIME_WINDOW_HOURS) * 60 * 60 * 1000;
  const maxBatchSize = options.maxBatchSize || DEFAULT_MAX_BATCH_SIZE;

  if (commits.length === 0) {
    return [];
  }

  // Sort commits by date (newest first)
  const sortedCommits = [...commits].sort((a, b) => {
    const dateA = new Date(a.commit?.author?.date || 0);
    const dateB = new Date(b.commit?.author?.date || 0);
    return dateB - dateA;
  });

  const batches = [];
  let currentBatch = {
    commits: [],
    startDate: null,
    endDate: null,
    files: new Set(),
    category: null,
  };

  for (const commit of sortedCommits) {
    const commitDate = new Date(commit.commit?.author?.date);
    const message = commit.commit?.message || '';

    // Check if this commit should start a new batch
    const shouldStartNewBatch =
      currentBatch.commits.length === 0 ||
      currentBatch.commits.length >= maxBatchSize ||
      (currentBatch.startDate && (currentBatch.startDate - commitDate) > timeWindowMs);

    if (shouldStartNewBatch) {
      // Save current batch if not empty
      if (currentBatch.commits.length > 0) {
        currentBatch.files = Array.from(currentBatch.files);
        batches.push(currentBatch);
      }

      // Start new batch
      currentBatch = {
        commits: [commit],
        startDate: commitDate,
        endDate: commitDate,
        files: new Set(),
        category: detectCategory(message),
      };
    } else {
      // Add to current batch
      currentBatch.commits.push(commit);
      currentBatch.endDate = commitDate;

      // Update category if current is more specific
      const newCategory = detectCategory(message);
      if (newCategory !== 'other' && currentBatch.category === 'other') {
        currentBatch.category = newCategory;
      }
    }
  }

  // Don't forget the last batch
  if (currentBatch.commits.length > 0) {
    currentBatch.files = Array.from(currentBatch.files);
    batches.push(currentBatch);
  }

  return batches;
}

/**
 * Detect category from commit message
 * @param {string} message - Commit message
 * @returns {string} Category name
 */
function detectCategory(message) {
  const lower = message.toLowerCase();

  if (lower.startsWith('feat') || lower.includes('add ') || lower.includes('implement') || lower.includes('new ')) {
    return 'feature';
  }
  if (lower.startsWith('fix') || lower.includes('bug') || lower.includes('patch') || lower.includes('hotfix')) {
    return 'bugfix';
  }
  if (lower.startsWith('refactor') || lower.includes('refactor') || lower.includes('restructure')) {
    return 'refactor';
  }
  if (lower.startsWith('doc') || lower.includes('readme') || lower.includes('comment')) {
    return 'docs';
  }
  if (lower.startsWith('test') || lower.includes('test') || lower.includes('spec')) {
    return 'test';
  }
  if (lower.startsWith('chore') || lower.startsWith('build') || lower.includes('deps') || lower.includes('ci')) {
    return 'chore';
  }
  if (lower.startsWith('style') || lower.includes('format') || lower.includes('lint')) {
    return 'style';
  }
  if (lower.startsWith('perf') || lower.includes('optim') || lower.includes('performance')) {
    return 'performance';
  }

  return 'other';
}

/**
 * Extract effective changes from a batch
 * For multi-commit batches, compares first and last commit state
 * @param {Object} batch - A batch of related commits
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @returns {Promise<Object>} Aggregated changes
 */
export async function extractEffectiveChanges(batch, owner, repo) {
  const commits = batch.commits;

  if (commits.length === 0) {
    return null;
  }

  // For single commit, just get its details
  if (commits.length === 1) {
    const details = await fetchCommitDetails(owner, repo, commits[0].sha);
    return {
      type: 'single',
      commit: details,
      files: details.files,
      stats: details.stats,
    };
  }

  // For multiple commits, compare first and last
  const oldestSha = commits[commits.length - 1].sha;
  const newestSha = commits[0].sha;

  try {
    const comparison = await fetchCommitComparison(owner, repo, oldestSha, newestSha);
    return {
      type: 'range',
      startSha: oldestSha,
      endSha: newestSha,
      commitCount: commits.length,
      files: comparison.files,
      stats: comparison.stats,
    };
  } catch (error) {
    // Fallback to just using commit messages if comparison fails
    return {
      type: 'messages_only',
      commits: commits.map(c => ({
        sha: c.sha,
        message: c.commit?.message,
        date: c.commit?.author?.date,
      })),
    };
  }
}

/**
 * Analyze commit batches using tiered LLM approach
 * Pass 1: Cheap model for categorization
 * Pass 2: Better model for important batches
 * @param {Object[]} batches - Batched commits
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {Object} options - Analysis options
 * @returns {Promise<Object[]>} Analysis results
 */
export async function analyzeCommitBatches(batches, owner, repo, options = {}) {
  const spinner = options.showProgress !== false ? ora('Analyzing commits...').start() : null;
  const analyses = [];

  try {
    // PASS 1: Quick categorization with cheap model
    if (spinner) spinner.text = 'Pass 1: Categorizing batches...';

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      if (spinner) spinner.text = `Pass 1: Categorizing batch ${i + 1}/${batches.length}...`;

      try {
        const prompt = batchCategorizationPrompt(batch);
        const result = await generateJSON(prompt, 'VERY_FAST');

        analyses.push({
          batch,
          category: result.data.category || batch.category,
          description: result.data.description,
          importance: result.data.importance || 1,
          tokensUsed: result.usage,
        });
      } catch (error) {
        // Fallback to local detection if LLM fails
        analyses.push({
          batch,
          category: batch.category,
          description: summarizeCommitMessages(batch.commits),
          importance: 2,
          error: error.message,
        });
      }
    }

    // PASS 2: Detailed analysis for important batches
    const importantBatches = analyses.filter(a => a.importance >= IMPORTANCE_THRESHOLD);

    if (importantBatches.length > 0 && options.detailed !== false) {
      if (spinner) spinner.text = `Pass 2: Detailed analysis of ${importantBatches.length} important batches...`;

      for (let i = 0; i < importantBatches.length; i++) {
        const analysis = importantBatches[i];
        if (spinner) spinner.text = `Pass 2: Analyzing batch ${i + 1}/${importantBatches.length}...`;

        try {
          // Fetch effective changes for this batch
          const changes = await extractEffectiveChanges(analysis.batch, owner, repo);

          // Generate detailed analysis with diff
          const prompt = detailedAnalysisPrompt(analysis.batch, changes);
          const result = await generate(prompt, 'HIGH_REASONING');

          analysis.detailedAnalysis = result.text;
          analysis.changes = changes;
          analysis.tokensUsed = {
            ...analysis.tokensUsed,
            detailed: result.usage,
          };
        } catch (error) {
          analysis.detailedError = error.message;
        }
      }
    }

    if (spinner) spinner.succeed(`Analyzed ${batches.length} batches (${importantBatches.length} detailed)`);

    return analyses;
  } catch (error) {
    if (spinner) spinner.fail(chalk.red('Analysis failed'));
    throw error;
  }
}

/**
 * Summarize commit messages (fallback when LLM unavailable)
 * @param {Object[]} commits - Array of commits
 * @returns {string} Summary
 */
function summarizeCommitMessages(commits) {
  if (commits.length === 0) return '';
  if (commits.length === 1) return commits[0].commit?.message?.split('\n')[0] || '';

  const firstMessage = commits[0].commit?.message?.split('\n')[0] || '';
  return `${firstMessage} (and ${commits.length - 1} more commits)`;
}

/**
 * Generate final portfolio summary from all analyses
 * @param {Object[]} analyses - All batch analyses
 * @param {Object} repoInfo - Repository information
 * @param {Object} options - Generation options
 * @returns {Promise<Object>} Portfolio summary
 */
export async function generatePortfolioSummary(analyses, repoInfo, options = {}) {
  const spinner = options.showProgress !== false ? ora('Generating summary...').start() : null;

  try {
    const prompt = portfolioSummaryPrompt(analyses, repoInfo);
    const result = await generate(prompt, 'BALANCED');

    if (spinner) spinner.succeed('Summary generated');

    return {
      summary: result.text,
      usage: result.usage,
      totalUsage: getUsageReport(),
    };
  } catch (error) {
    if (spinner) spinner.fail(chalk.red('Summary generation failed'));
    throw error;
  }
}

/**
 * Categorize work by type from analyses
 * @param {Object[]} analyses - Batch analyses
 * @returns {Object} Work organized by category
 */
export function categorizeWork(analyses) {
  const categories = {
    feature: [],
    bugfix: [],
    refactor: [],
    docs: [],
    test: [],
    performance: [],
    chore: [],
    style: [],
    other: [],
  };

  for (const analysis of analyses) {
    const category = analysis.category || 'other';
    if (categories[category]) {
      categories[category].push(analysis);
    } else {
      categories.other.push(analysis);
    }
  }

  return categories;
}

/**
 * Get analysis statistics
 * @param {Object[]} analyses - All analyses
 * @returns {Object} Statistics
 */
export function getAnalysisStats(analyses) {
  const categorized = categorizeWork(analyses);

  return {
    totalBatches: analyses.length,
    totalCommits: analyses.reduce((sum, a) => sum + a.batch.commits.length, 0),
    byCategory: Object.entries(categorized).reduce((acc, [cat, items]) => {
      acc[cat] = items.length;
      return acc;
    }, {}),
    importantCount: analyses.filter(a => a.importance >= IMPORTANCE_THRESHOLD).length,
    detailedCount: analyses.filter(a => a.detailedAnalysis).length,
  };
}
