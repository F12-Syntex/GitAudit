/**
 * Markdown report generation - factual, technical output
 */

import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import chalk from 'chalk';

/**
 * Format date for display
 * @param {string|Date} date - Date to format
 * @returns {string} Formatted date
 */
function formatDate(date) {
  if (!date) return 'N/A';
  const d = new Date(date);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

/**
 * Generate full markdown report from analysis
 * @param {Object} analysis - Complete analysis object
 * @returns {string} Markdown content
 */
export function generateMarkdownReport(analysis) {
  const { repoInfo, analyses, summary, stats } = analysis;

  const sections = [];

  // Title
  sections.push(`# ${repoInfo.name}\n`);

  // Repository description (if available)
  if (repoInfo.description) {
    sections.push(`${repoInfo.description}\n`);
  }

  // Work Summary section (factual stats)
  sections.push(generateWorkSummary(stats, repoInfo));

  // Always show detailed contributions from analyses
  if (analyses?.length > 0) {
    sections.push(generateContributionsSection(analyses));
  }

  // AI-generated technical summary (if available, add as additional context)
  if (summary?.summary) {
    sections.push('## Summary\n');
    sections.push(summary.summary);
    sections.push('');
  }

  // Footer
  sections.push('\n---');
  sections.push(`*Generated on ${new Date().toLocaleDateString()}*`);

  return sections.join('\n');
}

/**
 * Generate work summary section with factual stats
 * @param {Object} stats - Analysis statistics
 * @param {Object} repoInfo - Repository info
 * @returns {string} Markdown section
 */
function generateWorkSummary(stats, repoInfo) {
  const lines = ['## Work Summary\n'];

  // Date range
  if (stats.firstCommit && stats.lastCommit) {
    lines.push(`**Period:** ${formatDate(stats.firstCommit)} - ${formatDate(stats.lastCommit)}`);
  }

  // Core stats
  lines.push(`**Commits:** ${stats.totalCommits || 0}`);

  if (stats.totalAdditions !== undefined) {
    lines.push(`**Lines Changed:** +${stats.totalAdditions} / -${stats.totalDeletions || 0}`);
  }

  if (stats.filesChanged !== undefined) {
    lines.push(`**Files Modified:** ${stats.filesChanged}`);
  }

  // Work time estimate
  if (stats.estimatedHours) {
    lines.push(`**Estimated Work:** ~${stats.estimatedHours} hours (${stats.workSessions} sessions)`);
  }

  // Languages
  if (repoInfo.languages && Object.keys(repoInfo.languages).length > 0) {
    const langs = Object.entries(repoInfo.languages)
      .sort((a, b) => b[1] - a[1])
      .map(([lang]) => lang)
      .join(', ');
    lines.push(`**Languages:** ${langs}`);
  }

  lines.push('');

  // Category breakdown
  if (stats.byCategory) {
    lines.push('### Work Breakdown\n');
    const categories = Object.entries(stats.byCategory)
      .filter(([_, count]) => count > 0)
      .sort((a, b) => b[1] - a[1]);

    for (const [category, count] of categories) {
      lines.push(`- **${capitalizeFirst(category)}:** ${count} batch${count !== 1 ? 'es' : ''}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Generate contributions section from analyses
 * @param {Object[]} analyses - Batch analyses
 * @returns {string} Markdown section
 */
function generateContributionsSection(analyses) {
  const lines = ['## Commits\n'];

  // Collect all commits from all batches
  const allCommits = [];
  for (const analysis of analyses) {
    for (const commit of analysis.batch.commits) {
      allCommits.push({
        sha: commit.sha?.slice(0, 7),
        message: commit.commit?.message?.split('\n')[0] || '',
        date: commit.commit?.author?.date,
        category: analysis.category,
        description: analysis.description,
        detailedAnalysis: analysis.detailedAnalysis,
      });
    }
  }

  // Sort by date (newest first)
  allCommits.sort((a, b) => new Date(b.date) - new Date(a.date));

  // List all commits
  for (const commit of allCommits) {
    const date = commit.date ? new Date(commit.date).toLocaleDateString() : '';
    lines.push(`- \`${commit.sha}\` ${commit.message} *(${date})*`);
  }

  lines.push('');

  // Add detailed analyses if available
  const detailedAnalyses = analyses.filter(a => a.detailedAnalysis);
  if (detailedAnalyses.length > 0) {
    lines.push('## Implementation Details\n');
    for (const analysis of detailedAnalyses) {
      lines.push(analysis.detailedAnalysis);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Generate a single repo section (for multi-repo reports)
 * @param {Object} analysis - Analysis for one repo
 * @returns {string} Markdown section
 */
export function generateRepoSection(analysis) {
  const { repoInfo, summary, stats } = analysis;

  const lines = [];
  lines.push(`### ${repoInfo.name}`);

  if (repoInfo.description) {
    lines.push(`*${repoInfo.description}*\n`);
  }

  // Factual stats
  if (stats.firstCommit && stats.lastCommit) {
    lines.push(`${formatDate(stats.firstCommit)} - ${formatDate(stats.lastCommit)}`);
  }
  lines.push(`${stats.totalCommits} commits | +${stats.totalAdditions || 0}/-${stats.totalDeletions || 0} lines | ~${stats.estimatedHours || 0}h`);

  if (summary?.summary) {
    // Extract just technical work if possible
    const workMatch = summary.summary.match(/##?\s*Technical Work\s*\n+([\s\S]*?)(?=##|$)/i);
    if (workMatch) {
      lines.push('\n' + workMatch[1].trim().split('\n').slice(0, 5).join('\n'));
    } else {
      lines.push('\n' + summary.summary.split('\n').slice(0, 5).join('\n'));
    }
  }

  lines.push('');

  return lines.join('\n');
}

/**
 * Export report to file
 * @param {string} content - Markdown content
 * @param {string} filename - Output filename
 */
export async function exportToFile(content, filename) {
  // Create directory if it doesn't exist
  const dir = dirname(filename);
  if (dir && dir !== '.') {
    await mkdir(dir, { recursive: true });
  }

  await writeFile(filename, content, 'utf-8');
  console.log(chalk.green(`Report exported to ${chalk.bold(filename)}`));
}

/**
 * Generate combined summary of all repositories
 * @param {Object[]} analyses - Array of all repo analyses
 * @returns {string} Combined markdown report
 */
export function generateCombinedSummary(analyses) {
  const sections = [];

  sections.push('# Portfolio Summary\n');
  sections.push(`*${analyses.length} repositories analyzed*\n`);

  // Overall stats
  let totalCommits = 0;
  let totalHours = 0;
  let totalAdditions = 0;
  let totalDeletions = 0;
  const allLanguages = new Set();

  for (const analysis of analyses) {
    totalCommits += analysis.stats?.totalCommits || 0;
    totalHours += analysis.stats?.estimatedHours || 0;
    totalAdditions += analysis.stats?.totalAdditions || 0;
    totalDeletions += analysis.stats?.totalDeletions || 0;
    if (analysis.repoInfo?.languages) {
      Object.keys(analysis.repoInfo.languages).forEach(lang => allLanguages.add(lang));
    }
  }

  sections.push('## Overall Statistics\n');
  sections.push(`- **Total Commits:** ${totalCommits}`);
  sections.push(`- **Estimated Work:** ~${Math.round(totalHours * 10) / 10} hours`);
  sections.push(`- **Lines Changed:** +${totalAdditions} / -${totalDeletions}`);
  sections.push(`- **Languages:** ${Array.from(allLanguages).join(', ')}`);
  sections.push('');

  // Repository list with links
  sections.push('## Repositories\n');

  // Sort by commit count (most active first)
  const sorted = [...analyses].sort((a, b) =>
    (b.stats?.totalCommits || 0) - (a.stats?.totalCommits || 0)
  );

  for (const analysis of sorted) {
    const repo = analysis.repoInfo;
    const stats = analysis.stats;
    const repoName = repo.name;

    sections.push(`### [${repoName}](./repositories/${repoName}/report.md)\n`);

    if (repo.description) {
      sections.push(`${repo.description}\n`);
    }

    // Stats line
    const period = stats.firstCommit && stats.lastCommit
      ? `${formatDate(stats.firstCommit)} - ${formatDate(stats.lastCommit)}`
      : '';

    sections.push(`**${stats.totalCommits || 0} commits** | ~${stats.estimatedHours || 0}h | +${stats.totalAdditions || 0}/-${stats.totalDeletions || 0} lines`);
    if (period) {
      sections.push(`*${period}*`);
    }

    // Brief summary from AI if available
    if (analysis.summary?.summary) {
      // Extract first paragraph or bullet points
      const summaryLines = analysis.summary.summary.split('\n')
        .filter(line => line.trim())
        .slice(0, 3)
        .map(line => line.startsWith('-') || line.startsWith('*') ? line : `  ${line}`);

      if (summaryLines.length > 0) {
        sections.push('');
        sections.push(summaryLines.join('\n'));
      }
    }

    sections.push('');
  }

  // Footer
  sections.push('---');
  sections.push(`*Generated on ${new Date().toLocaleDateString()}*`);

  return sections.join('\n');
}

/**
 * Display report in terminal
 * @param {Object} analysis - Analysis object
 */
export function displayReport(analysis) {
  const { repoInfo, summary, stats } = analysis;

  console.log(chalk.cyan('\n' + '='.repeat(60)));
  console.log(chalk.bold.cyan(`  ${repoInfo.name}`));
  console.log(chalk.cyan('='.repeat(60) + '\n'));

  // Date range
  if (stats.firstCommit && stats.lastCommit) {
    console.log(`${chalk.bold('Period:')} ${formatDate(stats.firstCommit)} - ${formatDate(stats.lastCommit)}`);
  }

  // Stats
  console.log(`${chalk.bold('Commits:')} ${chalk.yellow(stats.totalCommits || 0)}`);
  if (stats.totalAdditions !== undefined) {
    console.log(`${chalk.bold('Lines:')} ${chalk.green(`+${stats.totalAdditions}`)} / ${chalk.red(`-${stats.totalDeletions}`)}`);
  }
  if (stats.filesChanged) {
    console.log(`${chalk.bold('Files:')} ${stats.filesChanged}`);
  }

  // Work estimate
  if (stats.estimatedHours) {
    console.log(`${chalk.bold('Estimated work:')} ~${chalk.yellow(stats.estimatedHours)} hours (${stats.workSessions} sessions)`);
  }

  // Category breakdown
  if (stats.byCategory) {
    console.log('\n' + chalk.bold('Work breakdown:'));
    const categories = Object.entries(stats.byCategory)
      .filter(([_, count]) => count > 0)
      .sort((a, b) => b[1] - a[1]);

    for (const [category, count] of categories) {
      console.log(`  ${capitalizeFirst(category)}: ${count}`);
    }
  }

  // Summary
  if (summary?.summary) {
    console.log('\n' + chalk.bold('Technical Summary:'));
    console.log(chalk.dim('-'.repeat(60)));
    console.log(summary.summary);
    console.log(chalk.dim('-'.repeat(60)));
  }

  // Token usage (dimmed)
  if (analysis.totalUsage) {
    console.log(chalk.dim(`\nTokens used: ${analysis.totalUsage.totalTokens}`));
  }

  console.log('');
}

/**
 * Capitalize first letter
 * @param {string} str - String to capitalize
 * @returns {string} Capitalized string
 */
function capitalizeFirst(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
