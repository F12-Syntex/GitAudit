#!/usr/bin/env node

import chalk from 'chalk';
import readline from 'readline';
import { config, validateConfig, validateOpenRouterConfig } from './config.js';
import { authenticate, logout, getAuthenticatedOctokit } from './auth.js';
import { listRepositories, displayRepositories, getRepositoryDetails } from './github.js';
import { isAuthenticated, getUser } from './storage.js';
import { fetchUserCommits, filterCommits, getCommitStats } from './commits/fetch.js';
import { batchCommitsByFeature, analyzeCommitBatches, generatePortfolioSummary, getAnalysisStats } from './commits/analyze.js';
import { getCachedCommits, cacheCommits, markRepoAnalyzed, isRepoAnalyzed, getAnalyzedRepos, saveRepoAnalysis, getRepoAnalysis, getAllRepoAnalyses, clearRepoCache, clearAllCaches, clearAnalyzedStatus } from './commits/cache.js';
import { generateMarkdownReport, displayReport, exportToFile } from './output/markdown.js';
import { getUsageReport, resetUsageTracking } from './llm/openrouter.js';

function showHelp() {
  console.log(`
${chalk.bold.cyan('GitAudit')} - GitHub Portfolio Analyzer

${chalk.bold('Usage:')}
  npm start              Show status and help
  npm run auth           Authenticate with GitHub
  npm run list           List all repositories
  npm run analyze        Analyze your contributions
  npm run analyze-all    Analyze all unanalyzed repos
  npm run export         Export cached analyses to files

${chalk.bold('Commands:')}
  --auth                 Authenticate with GitHub (OAuth device flow)
  --logout               Remove saved authentication
  --list                 List all your repositories (public & private)
  --analyze              Analyze contributions (interactive repo picker)
  --analyze owner/repo   Analyze a specific repository
  --analyze-all          Analyze all unanalyzed repositories
  --force                Re-analyze ignoring cache (use with --analyze)
  --export <dir>         Export all cached analyses to markdown files
  --export owner/repo    Export a specific cached analysis
  --clear-cache          Clear all cached data
  --help                 Show this help message

${chalk.bold('Setup:')}
  1. Create a GitHub OAuth App at ${chalk.underline('https://github.com/settings/developers')}
  2. Copy ${chalk.yellow('.env.example')} to ${chalk.yellow('.env')}
  3. Add your GitHub Client ID to ${chalk.yellow('.env')}
  4. Add your OpenRouter API key for analysis features
  5. Run ${chalk.cyan('npm run auth')} to authenticate
  6. Run ${chalk.cyan('npm run analyze')} to analyze your contributions
`);
}

function showStatus() {
  console.log(chalk.bold.cyan('\n  GitAudit Status\n'));

  if (isAuthenticated()) {
    const user = getUser();
    console.log(`  ${chalk.green('✓')} Authenticated as ${chalk.bold(user?.login || 'Unknown')}`);
  } else {
    console.log(`  ${chalk.yellow('○')} Not authenticated`);
    console.log(`    Run ${chalk.cyan('npm run auth')} to connect your GitHub account`);
  }

  console.log();
}

/**
 * Interactive repository selection
 * @param {Object[]} repos - List of repositories
 * @returns {Promise<Object>} Selected repository
 */
async function selectRepository(repos) {
  console.log(chalk.bold('\nSelect a repository to analyze:\n'));

  // Show numbered list of repos (limited to 20 for readability)
  const displayRepos = repos.slice(0, 20);
  displayRepos.forEach((repo, i) => {
    const visibility = repo.private ? chalk.yellow('[P]') : chalk.green('[O]');
    const language = repo.language ? chalk.dim(` (${repo.language})`) : '';
    console.log(`  ${chalk.cyan((i + 1).toString().padStart(2))}. ${visibility} ${chalk.bold(repo.name)}${language}`);
  });

  if (repos.length > 20) {
    console.log(chalk.dim(`\n  ... and ${repos.length - 20} more repositories`));
    console.log(chalk.dim(`  Use --analyze owner/repo for repositories not shown`));
  }

  console.log();

  // Get user input
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(chalk.cyan('  Enter number (1-' + displayRepos.length + '): '), (answer) => {
      rl.close();
      const num = parseInt(answer, 10);

      if (isNaN(num) || num < 1 || num > displayRepos.length) {
        console.log(chalk.red('\nInvalid selection. Please try again.'));
        process.exit(1);
      }

      resolve(displayRepos[num - 1]);
    });
  });
}

/**
 * Analyze a repository's commits
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {Object} options - Analysis options
 * @param {boolean} options.force - Force re-fetch, ignore cache
 * @returns {Promise<Object>} Analysis results
 */
async function analyzeRepository(owner, repo, options = {}) {
  console.log(chalk.bold.cyan(`\nAnalyzing ${owner}/${repo}...\n`));

  // Reset token tracking for this analysis
  resetUsageTracking();

  // Get repository details
  const repoInfo = await getRepositoryDetails(owner, repo);

  // Check cache for commits (unless force mode)
  let commits;
  const cached = options.force ? null : getCachedCommits(owner, repo);

  if (cached) {
    console.log(chalk.dim(`Using cached commits (${cached.count} commits)`));
    commits = cached.commits;
  } else {
    if (options.force) {
      console.log(chalk.dim('Force mode: fetching fresh commits...'));
      clearRepoCache(owner, repo);
      clearAnalyzedStatus(owner, repo);
    }
    // Fetch commits from GitHub
    commits = await fetchUserCommits(owner, repo);

    // Cache for future use
    cacheCommits(owner, repo, commits);
  }

  if (commits.length === 0) {
    console.log(chalk.yellow('No commits found for your user in this repository.'));
    return {
      repoInfo,
      analyses: [],
      summary: null,
      stats: { totalCommits: 0 },
    };
  }

  // Filter commits (remove merge commits, bots, etc.)
  const filteredCommits = filterCommits(commits);
  console.log(chalk.dim(`Filtered to ${filteredCommits.length} relevant commits`));

  // Get commit stats
  const stats = getCommitStats(filteredCommits);

  // Batch commits by feature/time
  const batches = batchCommitsByFeature(filteredCommits);
  console.log(chalk.dim(`Organized into ${batches.length} batches`));

  // Analyze batches with LLM
  const analyses = await analyzeCommitBatches(batches, owner, repo);

  // Get analysis stats
  const analysisStats = getAnalysisStats(analyses);

  // Generate portfolio summary
  const summary = await generatePortfolioSummary(analyses, repoInfo);

  // Get total usage
  const totalUsage = getUsageReport();

  // Mark repo as analyzed
  markRepoAnalyzed(owner, repo, {
    commitCount: filteredCommits.length,
    batchCount: batches.length,
  });

  const result = {
    repoInfo,
    analyses,
    summary,
    stats: { ...stats, ...analysisStats },
    totalUsage,
  };

  // Cache the full analysis result
  saveRepoAnalysis(owner, repo, result);

  return result;
}

async function main() {
  const args = process.argv.slice(2);

  // Helper to check for command (with or without --)
  const hasCommand = (cmd) => args.includes(`--${cmd}`) || args.includes(cmd);
  const getCommandIndex = (cmd) => {
    const idx = args.indexOf(`--${cmd}`);
    return idx !== -1 ? idx : args.indexOf(cmd);
  };

  // Help command doesn't need config validation
  if (hasCommand('help') || args.includes('-h')) {
    showHelp();
    return;
  }

  // Show status if no args
  if (args.length === 0) {
    showStatus();
    showHelp();
    return;
  }

  // Logout doesn't need config validation
  if (hasCommand('logout')) {
    await logout();
    return;
  }

  // Clear cache command
  if (hasCommand('clear-cache')) {
    clearAllCaches();
    console.log(chalk.green('All caches cleared.'));
    return;
  }

  // All other commands need config
  validateConfig();

  try {
    if (hasCommand('auth')) {
      await authenticate();
      console.log(chalk.dim('\nYou can now run: npm run list'));
    } else if (hasCommand('list')) {
      if (!isAuthenticated()) {
        console.log(chalk.yellow('Not authenticated. Starting authentication...\n'));
        await authenticate();
        console.log();
      }

      const repos = await listRepositories();
      displayRepositories(repos);
    } else if (hasCommand('export') && !hasCommand('analyze') && !hasCommand('analyze-all')) {
      // Standalone export from cache
      const exportIndex = getCommandIndex('export');
      const exportArg = args[exportIndex + 1];

      const allAnalyses = getAllRepoAnalyses();

      if (allAnalyses.length === 0) {
        console.log(chalk.yellow('No cached analyses found. Run --analyze first.'));
        return;
      }

      // Check if exporting specific repo or all
      if (exportArg && exportArg.includes('/') && !exportArg.startsWith('-')) {
        // Export specific repo
        const analysis = getRepoAnalysis(exportArg.split('/')[0], exportArg.split('/')[1]);
        if (!analysis) {
          console.log(chalk.red(`No cached analysis for ${exportArg}`));
          console.log(chalk.dim('Available: ' + allAnalyses.map(a => a.repoKey).join(', ')));
          return;
        }
        const markdown = generateMarkdownReport(analysis);
        const filename = `${exportArg.split('/')[1]}.md`;
        await exportToFile(markdown, filename);
      } else {
        // Export all to directory
        const dir = exportArg || './reports';
        console.log(chalk.bold.cyan(`\nExporting ${allAnalyses.length} cached analyses to ${dir}/\n`));

        for (const analysis of allAnalyses) {
          const repoName = analysis.repoKey.split('/')[1];
          const filename = `${dir}/${repoName}.md`;
          const markdown = generateMarkdownReport(analysis);
          await exportToFile(markdown, filename);
        }

        console.log(chalk.green(`\nExported ${allAnalyses.length} reports to ${dir}/`));
      }
    } else if (hasCommand('analyze-all')) {
      if (!isAuthenticated()) {
        console.log(chalk.yellow('Not authenticated. Starting authentication...\n'));
        await authenticate();
        console.log();
      }

      // Validate OpenRouter config
      validateOpenRouterConfig();

      // Get all repos
      const repos = await listRepositories();

      // Filter to unanalyzed repos
      const unanalyzedRepos = repos.filter(r => !isRepoAnalyzed(r.owner.login, r.name));

      if (unanalyzedRepos.length === 0) {
        console.log(chalk.green('All repositories have been analyzed!'));
        const analyzed = getAnalyzedRepos();
        console.log(chalk.dim(`(${analyzed.length} repos analyzed)`));
        return;
      }

      console.log(chalk.bold.cyan(`\nAnalyzing ${unanalyzedRepos.length} unanalyzed repositories...\n`));
      console.log(chalk.dim(`(${repos.length - unanalyzedRepos.length} already analyzed, skipping)\n`));

      // Check for export flag
      const exportIndex = getCommandIndex('export');
      const exportDir = exportIndex !== -1 ? args[exportIndex + 1] : null;

      // Check for force flag
      const forceMode = hasCommand('force');

      const results = [];
      let successCount = 0;
      let skipCount = 0;

      for (let i = 0; i < unanalyzedRepos.length; i++) {
        const repo = unanalyzedRepos[i];
        const owner = repo.owner.login;
        const repoName = repo.name;

        console.log(chalk.cyan(`[${i + 1}/${unanalyzedRepos.length}] ${owner}/${repoName}`));

        try {
          const analysis = await analyzeRepository(owner, repoName, { force: forceMode });

          if (analysis.stats.totalCommits === 0) {
            console.log(chalk.dim('  No commits by you, skipping...\n'));
            skipCount++;
            continue;
          }

          results.push(analysis);
          successCount++;

          // Export individual report if export dir specified
          if (exportDir) {
            const markdown = generateMarkdownReport(analysis);
            const filename = `${exportDir}/${repoName}.md`;
            await exportToFile(markdown, filename);
          } else {
            // Brief summary for console
            console.log(chalk.dim(`  ${analysis.stats.totalCommits} commits, ${analysis.stats.totalBatches || 0} batches\n`));
          }
        } catch (error) {
          console.log(chalk.red(`  Error: ${error.message}\n`));
        }
      }

      // Final summary
      console.log(chalk.cyan('\n' + '='.repeat(60)));
      console.log(chalk.bold.green(`Analyzed ${successCount} repositories`));
      if (skipCount > 0) {
        console.log(chalk.dim(`Skipped ${skipCount} repos (no commits by you)`));
      }
      console.log(chalk.cyan('='.repeat(60) + '\n'));

    } else if (hasCommand('analyze')) {
      if (!isAuthenticated()) {
        console.log(chalk.yellow('Not authenticated. Starting authentication...\n'));
        await authenticate();
        console.log();
      }

      // Validate OpenRouter config
      validateOpenRouterConfig();

      // Check if repo is specified
      const analyzeIndex = getCommandIndex('analyze');
      const repoArg = args[analyzeIndex + 1];

      let owner, repo;

      if (repoArg && repoArg.includes('/') && !repoArg.startsWith('-')) {
        // Direct repo specification: owner/repo
        [owner, repo] = repoArg.split('/');
      } else {
        // Interactive repo selection
        const repos = await listRepositories();
        const selected = await selectRepository(repos);
        owner = selected.owner.login;
        repo = selected.name;
      }

      // Check for export flag
      const exportIndex = getCommandIndex('export');
      const exportFile = exportIndex !== -1 ? args[exportIndex + 1] : null;

      // Check for force flag
      const forceMode = hasCommand('force');

      // Run analysis
      const analysis = await analyzeRepository(owner, repo, { force: forceMode });

      // Display or export
      if (exportFile) {
        const markdown = generateMarkdownReport(analysis);
        await exportToFile(markdown, exportFile);
      } else {
        displayReport(analysis);
      }
    } else {
      console.log(chalk.red(`Unknown command: ${args.join(' ')}`));
      showHelp();
      process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red('\nError:'), error.message);
    if (process.env.DEBUG) {
      console.error(error);
    }
    process.exit(1);
  }
}

main();
