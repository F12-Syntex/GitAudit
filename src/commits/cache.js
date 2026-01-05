/**
 * Caching layer for commits and analysis results
 * Uses Conf for persistent storage
 */

import Conf from 'conf';

const cacheStore = new Conf({
  projectName: 'gitaudit',
  configName: 'cache',
  schema: {
    commits: {
      type: 'object',
      additionalProperties: true,
    },
    analysis: {
      type: 'object',
      additionalProperties: true,
    },
    analyzedRepos: {
      type: 'object',
      additionalProperties: true,
    },
  },
});

// Cache TTL in milliseconds (24 hours)
const CACHE_TTL = 24 * 60 * 60 * 1000;

/**
 * Generate cache key for a repository
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @returns {string} Cache key
 */
function getRepoKey(owner, repo) {
  return `${owner}/${repo}`;
}

/**
 * Check if cache entry is still valid
 * @param {Object} entry - Cache entry with fetchedAt timestamp
 * @returns {boolean} True if cache is still valid
 */
function isCacheValid(entry) {
  if (!entry || !entry.fetchedAt) {
    return false;
  }
  const fetchedAt = new Date(entry.fetchedAt).getTime();
  return Date.now() - fetchedAt < CACHE_TTL;
}

/**
 * Get cached commits for a repository
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @returns {Object|null} Cached commits or null if not cached/expired
 */
export function getCachedCommits(owner, repo) {
  const key = getRepoKey(owner, repo);
  const commits = cacheStore.get(`commits.${key}`);

  if (!isCacheValid(commits)) {
    return null;
  }

  return commits;
}

/**
 * Save commits to cache
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {Object[]} commits - Commits to cache
 * @param {string} lastSha - SHA of most recent commit (for incremental updates)
 */
export function cacheCommits(owner, repo, commits, lastSha = null) {
  const key = getRepoKey(owner, repo);
  cacheStore.set(`commits.${key}`, {
    commits,
    lastSha: lastSha || commits[0]?.sha,
    fetchedAt: new Date().toISOString(),
    count: commits.length,
  });
}

/**
 * Get cached analysis for a commit range
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} startSha - First commit SHA (oldest)
 * @param {string} endSha - Last commit SHA (newest)
 * @returns {Object|null} Cached analysis or null if not cached
 */
export function getCachedAnalysis(owner, repo, startSha, endSha) {
  const key = `${getRepoKey(owner, repo)}:${startSha.slice(0, 7)}..${endSha.slice(0, 7)}`;
  const analysis = cacheStore.get(`analysis.${key}`);

  if (!isCacheValid(analysis)) {
    return null;
  }

  return analysis;
}

/**
 * Save analysis to cache
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} startSha - First commit SHA
 * @param {string} endSha - Last commit SHA
 * @param {Object} analysis - Analysis results
 */
export function cacheAnalysis(owner, repo, startSha, endSha, analysis) {
  const key = `${getRepoKey(owner, repo)}:${startSha.slice(0, 7)}..${endSha.slice(0, 7)}`;
  cacheStore.set(`analysis.${key}`, {
    ...analysis,
    fetchedAt: new Date().toISOString(),
  });
}

/**
 * Clear all caches for a repository
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 */
export function clearRepoCache(owner, repo) {
  const key = getRepoKey(owner, repo);

  // Clear commits cache
  cacheStore.delete(`commits.${key}`);

  // Clear all analysis caches for this repo
  const analysisCache = cacheStore.get('analysis') || {};
  for (const analysisKey of Object.keys(analysisCache)) {
    if (analysisKey.startsWith(key)) {
      cacheStore.delete(`analysis.${analysisKey}`);
    }
  }
}

/**
 * Clear all caches
 */
export function clearAllCaches() {
  cacheStore.clear();
}

/**
 * Get cache statistics
 * @returns {Object} Cache statistics
 */
export function getCacheStats() {
  const commits = cacheStore.get('commits') || {};
  const analysis = cacheStore.get('analysis') || {};

  return {
    cachedRepos: Object.keys(commits).length,
    cachedAnalyses: Object.keys(analysis).length,
    repos: Object.entries(commits).map(([key, data]) => ({
      repo: key,
      commitCount: data.count,
      fetchedAt: data.fetchedAt,
      isValid: isCacheValid(data),
    })),
  };
}

/**
 * Mark a repository as fully analyzed
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {Object} summary - Analysis summary info
 */
export function markRepoAnalyzed(owner, repo, summary = {}) {
  const key = getRepoKey(owner, repo);
  cacheStore.set(`analyzedRepos.${key}`, {
    analyzedAt: new Date().toISOString(),
    commitCount: summary.commitCount || 0,
    batchCount: summary.batchCount || 0,
  });
}

/**
 * Check if a repository has been analyzed
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @returns {boolean} True if repo has been analyzed
 */
export function isRepoAnalyzed(owner, repo) {
  const key = getRepoKey(owner, repo);
  const data = cacheStore.get(`analyzedRepos.${key}`);
  return !!data;
}

/**
 * Get list of all analyzed repositories
 * @returns {Object[]} List of analyzed repos with metadata
 */
export function getAnalyzedRepos() {
  const analyzedRepos = cacheStore.get('analyzedRepos') || {};
  return Object.entries(analyzedRepos).map(([key, data]) => ({
    repo: key,
    ...data,
  }));
}

/**
 * Clear analyzed status for a repo (to re-analyze)
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 */
export function clearAnalyzedStatus(owner, repo) {
  const key = getRepoKey(owner, repo);
  cacheStore.delete(`analyzedRepos.${key}`);
}

/**
 * Save full analysis result for a repository
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {Object} analysis - Full analysis result
 */
export function saveRepoAnalysis(owner, repo, analysis) {
  const key = getRepoKey(owner, repo);
  cacheStore.set(`repoAnalysis.${key}`, {
    ...analysis,
    cachedAt: new Date().toISOString(),
  });
}

/**
 * Get cached analysis for a repository
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @returns {Object|null} Cached analysis or null
 */
export function getRepoAnalysis(owner, repo) {
  const key = getRepoKey(owner, repo);
  return cacheStore.get(`repoAnalysis.${key}`) || null;
}

/**
 * Get all cached repo analyses
 * @returns {Object[]} List of all cached analyses
 */
export function getAllRepoAnalyses() {
  const repoAnalysis = cacheStore.get('repoAnalysis') || {};
  return Object.entries(repoAnalysis).map(([key, data]) => ({
    repoKey: key,
    ...data,
  }));
}

/**
 * Import analysis from markdown content (for cache recovery)
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} markdownContent - Raw markdown file content
 * @returns {Object} Parsed analysis object
 */
export function importAnalysisFromMarkdown(owner, repo, markdownContent) {
  const lines = markdownContent.split('\n');

  // Extract repo name from title
  const titleMatch = lines[0]?.match(/^#\s+(.+)$/);
  const repoName = titleMatch ? titleMatch[1] : repo;

  // Extract description (line after title if not a header)
  let description = '';
  if (lines[2] && !lines[2].startsWith('#') && !lines[2].startsWith('**') && lines[2].trim()) {
    description = lines[2].trim();
  }

  // Parse Work Summary section
  const stats = {
    totalCommits: 0,
    totalAdditions: 0,
    totalDeletions: 0,
    estimatedHours: 0,
    workSessions: 0,
    filesChanged: 0,
    firstCommit: null,
    lastCommit: null,
    byCategory: {},
  };

  // Extract Period
  const periodMatch = markdownContent.match(/\*\*Period:\*\*\s*(.+?)\s*-\s*(.+?)$/m);
  if (periodMatch) {
    stats.firstCommit = new Date(periodMatch[1]).toISOString();
    stats.lastCommit = new Date(periodMatch[2]).toISOString();
  }

  // Extract Commits count
  const commitsMatch = markdownContent.match(/\*\*Commits:\*\*\s*(\d+)/);
  if (commitsMatch) stats.totalCommits = parseInt(commitsMatch[1], 10);

  // Extract Lines Changed
  const linesMatch = markdownContent.match(/\*\*Lines Changed:\*\*\s*\+(\d+)\s*\/\s*-(\d+)/);
  if (linesMatch) {
    stats.totalAdditions = parseInt(linesMatch[1], 10);
    stats.totalDeletions = parseInt(linesMatch[2], 10);
  }

  // Extract Files Modified
  const filesMatch = markdownContent.match(/\*\*Files Modified:\*\*\s*(\d+)/);
  if (filesMatch) stats.filesChanged = parseInt(filesMatch[1], 10);

  // Extract Estimated Work
  const workMatch = markdownContent.match(/\*\*Estimated Work:\*\*\s*~([\d.]+)\s*hours?\s*\((\d+)\s*sessions?\)/);
  if (workMatch) {
    stats.estimatedHours = parseFloat(workMatch[1]);
    stats.workSessions = parseInt(workMatch[2], 10);
  }

  // Extract Languages
  const languagesMatch = markdownContent.match(/\*\*Languages:\*\*\s*(.+?)$/m);
  const languages = {};
  if (languagesMatch) {
    languagesMatch[1].split(',').map(l => l.trim()).filter(Boolean).forEach(lang => {
      languages[lang] = 1;
    });
  }

  // Extract Work Breakdown categories
  const breakdownSection = markdownContent.match(/### Work Breakdown\s*\n([\s\S]*?)(?=\n##|\n---|\n\*Generated|$)/);
  if (breakdownSection) {
    const categoryMatches = breakdownSection[1].matchAll(/- \*\*(\w+):\*\*\s*(\d+)/g);
    for (const match of categoryMatches) {
      stats.byCategory[match[1].toLowerCase()] = parseInt(match[2], 10);
    }
  }

  // Extract Summary section
  let summaryText = '';
  const summaryMatch = markdownContent.match(/## Summary\s*\n([\s\S]*?)(?=\n## |\n---|\n\*Generated|$)/);
  if (summaryMatch) {
    summaryText = summaryMatch[1].trim();
  }

  // Extract Implementation Details
  let implementationDetails = '';
  const implMatch = markdownContent.match(/## Implementation Details\s*\n([\s\S]*?)(?=\n## |\n---|\n\*Generated|$)/);
  if (implMatch) {
    implementationDetails = implMatch[1].trim();
  }

  // Build the analysis object
  const analysis = {
    repoInfo: {
      name: repoName,
      description,
      languages,
      owner: { login: owner },
    },
    analyses: implementationDetails ? [{
      detailedAnalysis: implementationDetails,
      batch: { commits: [] },
    }] : [],
    summary: summaryText ? { summary: summaryText } : null,
    stats,
    cachedAt: new Date().toISOString(),
    importedFromMarkdown: true,
  };

  // Save to cache
  const key = `${owner}/${repo}`;
  cacheStore.set(`repoAnalysis.${key}`, analysis);

  // Also mark as analyzed
  cacheStore.set(`analyzedRepos.${key}`, {
    analyzedAt: new Date().toISOString(),
    commitCount: stats.totalCommits,
    batchCount: Object.values(stats.byCategory).reduce((a, b) => a + b, 0) || 1,
    importedFromMarkdown: true,
  });

  return analysis;
}
