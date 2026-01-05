/**
 * Commit fetching module
 * Handles fetching commits from GitHub API with pagination and filtering
 */

import ora from 'ora';
import chalk from 'chalk';
import { getAuthenticatedOctokit } from '../auth.js';
import { getUser } from '../storage.js';

/**
 * Fetch all commits by the authenticated user from a repository
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {Object} options - Fetch options
 * @param {string} options.since - ISO date string for start date
 * @param {string} options.until - ISO date string for end date
 * @param {boolean} options.showProgress - Show spinner (default: true)
 * @returns {Promise<Object[]>} Array of commit objects
 */
export async function fetchUserCommits(owner, repo, options = {}) {
  const spinner = options.showProgress !== false ? ora('Fetching commits...').start() : null;

  try {
    const octokit = await getAuthenticatedOctokit();
    const user = getUser();

    if (!user?.login) {
      throw new Error('User not authenticated. Please run auth first.');
    }

    const params = {
      owner,
      repo,
      author: user.login,
      per_page: 100,
    };

    // Add date filters if provided
    if (options.since) {
      params.since = options.since;
    }
    if (options.until) {
      params.until = options.until;
    }

    // Fetch all commits with pagination
    const commits = await octokit.paginate(
      octokit.repos.listCommits,
      params,
      (response, done) => {
        if (spinner) {
          spinner.text = `Fetching commits... (${response.data.length} so far)`;
        }
        return response.data;
      }
    );

    if (spinner) {
      spinner.succeed(`Found ${chalk.bold(commits.length)} commits by ${chalk.cyan(user.login)}`);
    }

    return commits;
  } catch (error) {
    if (spinner) {
      spinner.fail(chalk.red('Failed to fetch commits'));
    }

    // Handle specific error cases
    if (error.status === 404) {
      throw new Error(`Repository ${owner}/${repo} not found or not accessible.`);
    }
    if (error.status === 409) {
      throw new Error(`Repository ${owner}/${repo} is empty.`);
    }

    throw error;
  }
}

/**
 * Fetch detailed commit information including files changed
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} sha - Commit SHA
 * @returns {Promise<Object>} Detailed commit with files/stats
 */
export async function fetchCommitDetails(owner, repo, sha) {
  const octokit = await getAuthenticatedOctokit();

  const { data } = await octokit.repos.getCommit({
    owner,
    repo,
    ref: sha,
  });

  return {
    sha: data.sha,
    message: data.commit.message,
    author: data.commit.author,
    date: data.commit.author.date,
    stats: data.stats,
    files: data.files?.map(f => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      changes: f.changes,
      patch: f.patch, // The actual diff
    })) || [],
  };
}

/**
 * Fetch diff between two commits
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} base - Base commit SHA
 * @param {string} head - Head commit SHA
 * @returns {Promise<Object>} Comparison with diff
 */
export async function fetchCommitComparison(owner, repo, base, head) {
  const octokit = await getAuthenticatedOctokit();

  const { data } = await octokit.repos.compareCommits({
    owner,
    repo,
    base,
    head,
  });

  return {
    ahead_by: data.ahead_by,
    behind_by: data.behind_by,
    total_commits: data.total_commits,
    files: data.files?.map(f => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      changes: f.changes,
      patch: f.patch,
    })) || [],
    stats: {
      additions: data.files?.reduce((sum, f) => sum + f.additions, 0) || 0,
      deletions: data.files?.reduce((sum, f) => sum + f.deletions, 0) || 0,
    },
  };
}

/**
 * Filter commits to exclude merge commits, bot commits, and trivial changes
 * @param {Object[]} commits - Array of commits
 * @param {Object} options - Filter options
 * @param {boolean} options.includeMergeCommits - Include merge commits (default: false)
 * @param {boolean} options.includeBotCommits - Include bot commits (default: false)
 * @returns {Object[]} Filtered commits
 */
export function filterCommits(commits, options = {}) {
  return commits.filter(commit => {
    // Filter out merge commits (more than one parent)
    if (!options.includeMergeCommits && commit.parents?.length > 1) {
      return false;
    }

    // Filter out bot commits
    if (!options.includeBotCommits) {
      const authorLogin = commit.author?.login || '';
      const botPatterns = ['[bot]', 'dependabot', 'renovate', 'github-actions'];
      if (botPatterns.some(pattern => authorLogin.toLowerCase().includes(pattern))) {
        return false;
      }
    }

    // Filter out trivial commits based on message patterns
    const message = commit.commit?.message?.toLowerCase() || '';
    const trivialPatterns = [
      /^merge branch/,
      /^merge pull request/,
      /^bump version/,
      /^v?\d+\.\d+\.\d+$/,  // Version-only commits
      /^wip$/,
      /^initial commit$/,
    ];

    if (trivialPatterns.some(pattern => pattern.test(message))) {
      return false;
    }

    return true;
  });
}

/**
 * Get commit statistics summary
 * @param {Object[]} commits - Array of commits with details
 * @returns {Object} Summary statistics
 */
export function getCommitStats(commits) {
  const stats = {
    totalCommits: commits.length,
    totalAdditions: 0,
    totalDeletions: 0,
    filesChanged: new Set(),
    byMonth: {},
    byCategory: {
      feature: 0,
      fix: 0,
      refactor: 0,
      docs: 0,
      test: 0,
      chore: 0,
      other: 0,
    },
  };

  for (const commit of commits) {
    // Aggregate file stats if available
    if (commit.stats) {
      stats.totalAdditions += commit.stats.additions || 0;
      stats.totalDeletions += commit.stats.deletions || 0;
    }

    // Track unique files
    if (commit.files) {
      commit.files.forEach(f => stats.filesChanged.add(f.filename));
    }

    // Categorize by commit message prefix
    const message = commit.commit?.message?.toLowerCase() || '';
    if (message.startsWith('feat') || message.includes('add ') || message.includes('implement')) {
      stats.byCategory.feature++;
    } else if (message.startsWith('fix') || message.includes('bug')) {
      stats.byCategory.fix++;
    } else if (message.startsWith('refactor') || message.includes('refactor')) {
      stats.byCategory.refactor++;
    } else if (message.startsWith('docs') || message.startsWith('doc:')) {
      stats.byCategory.docs++;
    } else if (message.startsWith('test') || message.includes('test')) {
      stats.byCategory.test++;
    } else if (message.startsWith('chore') || message.startsWith('build')) {
      stats.byCategory.chore++;
    } else {
      stats.byCategory.other++;
    }

    // Group by month
    const date = new Date(commit.commit?.author?.date);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    stats.byMonth[monthKey] = (stats.byMonth[monthKey] || 0) + 1;
  }

  stats.filesChanged = stats.filesChanged.size;

  return stats;
}
