#!/usr/bin/env node

import chalk from 'chalk';
import { select, confirm, input } from '@inquirer/prompts';
import { validateConfig, validateOpenRouterConfig } from './config.js';
import { authenticate, logout } from './auth.js';
import { listRepositories, displayRepositories, getRepositoryDetails } from './github.js';
import { isAuthenticated, getUser } from './storage.js';
import { fetchUserCommits, filterCommits, getCommitStats } from './commits/fetch.js';
import { batchCommitsByFeature, analyzeCommitBatches, generatePortfolioSummary, getAnalysisStats } from './commits/analyze.js';
import { getCachedCommits, cacheCommits, markRepoAnalyzed, isRepoAnalyzed, getAnalyzedRepos, saveRepoAnalysis, getRepoAnalysis, getAllRepoAnalyses, clearRepoCache, clearAllCaches, clearAnalyzedStatus, importAnalysisFromMarkdown } from './commits/cache.js';
import { readFile, readdir } from 'fs/promises';
import { join, basename } from 'path';
import { generateMarkdownReport, displayReport, exportToFile, generateCombinedSummary, generateBigExport } from './output/markdown.js';
import { countReportTokens, displayTokenReport } from './output/tokens.js';
import { getUsageReport, resetUsageTracking } from './llm/openrouter.js';
import { generateCV } from './cv/generate.js';
import { getCVConfig, setCVConfigValue, getAllConfig, getExcludedProjects, excludeProject, includeProject } from './userConfig.js';

// ============================================================================
// Utility Functions
// ============================================================================

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

function clearScreen() {
  console.clear();
}

function showBanner() {
  console.log(chalk.bold.cyan(`
   ╔═══════════════════════════════════════╗
   ║          ${chalk.white('GitAudit')}                     ║
   ║   ${chalk.dim('GitHub Portfolio Analyzer')}           ║
   ╚═══════════════════════════════════════╝
`));
}

function showStatus() {
  if (isAuthenticated()) {
    const user = getUser();
    console.log(`  ${chalk.green('●')} Logged in as ${chalk.bold(user?.login || 'Unknown')}\n`);
  } else {
    console.log(`  ${chalk.yellow('○')} Not logged in\n`);
  }
}

function showHelp() {
  console.log(`
${chalk.bold.cyan('GitAudit')} - GitHub Portfolio Analyzer

${chalk.bold('Quick Commands:')}
  yarn start                    Interactive menu
  yarn start auth               Login to GitHub
  yarn start logout             Logout from GitHub
  yarn start list               List all repositories
  yarn start analyze            Analyze repos (interactive picker)
  yarn start analyze owner/repo Analyze specific repository
  yarn start analyze-all        Analyze all unanalyzed repos
  yarn start export             Export cached analyses to files
  yarn start big-export         Export all to single file
  yarn start import             Import markdown reports to cache
  yarn start generate-cv        Generate a tailored CV for a job
  yarn start exclude            Manage excluded projects for CV
  yarn start config             View/edit configuration
  yarn start token-count        Count tokens in reports
  yarn start clear-cache        Clear all cached data

${chalk.bold('CV Generation:')}
  yarn start generate-cv                    Interactive mode
  yarn start generate-cv "<url>"            From job posting URL (quote URLs with &)
  yarn start generate-cv "description..."   From job description text
  yarn start generate-cv "path" --file      From file containing job description

${chalk.bold('Project Exclusion:')}
  yarn start exclude                        List excluded projects
  yarn start exclude add <project>          Exclude a project from CV
  yarn start exclude remove <project>       Include a project again

${chalk.bold('Configuration:')}
  yarn start config                         View all settings
  yarn start config set name "Your Name"    Set your name
  yarn start config set email you@email.com Set your email
  yarn start config set github username     Set GitHub username

${chalk.bold('Options:')}
  --force                       Re-analyze ignoring cache

${chalk.bold('Examples:')}
  yarn start analyze myuser/myrepo --force
  yarn start generate-cv https://jobs.example.com/posting/123
`);
}

// ============================================================================
// Core Functions
// ============================================================================

async function selectRepository(repos) {
  const choices = repos.slice(0, 30).map((repo) => {
    const visibility = repo.private ? chalk.yellow('[P]') : chalk.green('[O]');
    const language = repo.language ? chalk.dim(` · ${repo.language}`) : '';
    return {
      name: `${visibility} ${repo.name}${language}`,
      value: repo,
    };
  });

  if (repos.length > 30) {
    choices.push({
      name: chalk.dim(`... and ${repos.length - 30} more (use: yarn start analyze owner/repo)`),
      value: null,
      disabled: true,
    });
  }

  const selected = await select({
    message: 'Select a repository',
    choices,
    pageSize: 15,
  });

  return selected;
}

async function analyzeRepository(owner, repo, options = {}) {
  console.log(chalk.bold.cyan(`\nAnalyzing ${owner}/${repo}...\n`));

  resetUsageTracking();

  const repoInfo = await getRepositoryDetails(owner, repo);

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
    commits = await fetchUserCommits(owner, repo);
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

  const filteredCommits = filterCommits(commits);
  console.log(chalk.dim(`Filtered to ${filteredCommits.length} relevant commits`));

  const stats = getCommitStats(filteredCommits);
  const batches = batchCommitsByFeature(filteredCommits);
  console.log(chalk.dim(`Organized into ${batches.length} batches`));

  const analyses = await analyzeCommitBatches(batches, owner, repo);
  const analysisStats = getAnalysisStats(analyses);
  const summary = await generatePortfolioSummary(analyses, repoInfo);
  const totalUsage = getUsageReport();

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

  saveRepoAnalysis(owner, repo, result);

  const markdown = generateMarkdownReport(result);
  await exportToFile(markdown, `data/reports/repositories/${repo}.md`);

  return result;
}

// ============================================================================
// Command Handlers
// ============================================================================

async function cmdAuth() {
  await authenticate();
  console.log(chalk.green('\n✓ Authentication successful!\n'));
}

async function cmdLogout() {
  await logout();
}

async function cmdList() {
  if (!isAuthenticated()) {
    console.log(chalk.yellow('Not authenticated. Please login first.\n'));
    await authenticate();
  }
  const repos = await listRepositories();
  displayRepositories(repos);
}

async function cmdAnalyze(repoArg, options = {}) {
  if (!isAuthenticated()) {
    console.log(chalk.yellow('Not authenticated. Please login first.\n'));
    await authenticate();
  }

  validateOpenRouterConfig();

  let owner, repo;

  if (repoArg && repoArg.includes('/')) {
    [owner, repo] = repoArg.split('/');
  } else {
    const repos = await listRepositories();
    const selected = await selectRepository(repos);
    if (!selected) return;
    owner = selected.owner.login;
    repo = selected.name;
  }

  const startTime = Date.now();
  const analysis = await analyzeRepository(owner, repo, options);
  const elapsed = Date.now() - startTime;

  displayReport(analysis);
  console.log(chalk.dim(`\nCompleted in ${formatDuration(elapsed)}`));
}

async function cmdAnalyzeAll(options = {}) {
  if (!isAuthenticated()) {
    console.log(chalk.yellow('Not authenticated. Please login first.\n'));
    await authenticate();
  }

  validateOpenRouterConfig();

  const repos = await listRepositories();
  const unanalyzedRepos = repos.filter(r => !isRepoAnalyzed(r.owner.login, r.name));

  if (unanalyzedRepos.length === 0) {
    console.log(chalk.green('\n✓ All repositories have been analyzed!'));
    const analyzed = getAnalyzedRepos();
    console.log(chalk.dim(`  ${analyzed.length} repos in cache\n`));
    return;
  }

  console.log(chalk.bold.cyan(`\nAnalyzing ${unanalyzedRepos.length} repositories...\n`));
  console.log(chalk.dim(`(${repos.length - unanalyzedRepos.length} already cached, skipping)\n`));

  const startTime = Date.now();
  let successCount = 0;
  let skipCount = 0;

  for (let i = 0; i < unanalyzedRepos.length; i++) {
    const repo = unanalyzedRepos[i];
    const owner = repo.owner.login;
    const repoName = repo.name;

    console.log(chalk.cyan(`[${i + 1}/${unanalyzedRepos.length}] ${owner}/${repoName}`));

    try {
      const analysis = await analyzeRepository(owner, repoName, options);

      if (analysis.stats.totalCommits === 0) {
        console.log(chalk.dim('  No commits by you, skipping...\n'));
        skipCount++;
        continue;
      }

      successCount++;
      console.log(chalk.dim(`  ${analysis.stats.totalCommits} commits, ${analysis.stats.totalBatches || 0} batches\n`));
    } catch (error) {
      console.log(chalk.red(`  Error: ${error.message}\n`));
    }

    const elapsed = Date.now() - startTime;
    const avgTime = elapsed / (i + 1);
    const remaining = unanalyzedRepos.length - (i + 1);
    const eta = remaining * avgTime;

    if (remaining > 0) {
      console.log(chalk.dim(`  Elapsed: ${formatDuration(elapsed)} | ETA: ${formatDuration(eta)}\n`));
    }
  }

  const allCached = getAllRepoAnalyses();
  if (allCached.length > 0) {
    const summaryMarkdown = generateCombinedSummary(allCached);
    await exportToFile(summaryMarkdown, 'data/reports/summary.md');
  }

  const totalElapsed = Date.now() - startTime;
  console.log(chalk.cyan('\n' + '─'.repeat(50)));
  console.log(chalk.bold.green(`✓ Analyzed ${successCount} repositories in ${formatDuration(totalElapsed)}`));
  if (skipCount > 0) {
    console.log(chalk.dim(`  Skipped ${skipCount} repos (no commits)`));
  }
  console.log(chalk.dim(`  Reports saved to data/reports/`));
  console.log(chalk.cyan('─'.repeat(50) + '\n'));
}

async function cmdExport(exportArg) {
  const allAnalyses = getAllRepoAnalyses();

  if (allAnalyses.length === 0) {
    console.log(chalk.yellow('No cached analyses found. Run analyze first.\n'));
    return;
  }

  if (exportArg && exportArg.includes('/')) {
    const [owner, repo] = exportArg.split('/');
    const analysis = getRepoAnalysis(owner, repo);
    if (!analysis) {
      console.log(chalk.red(`No cached analysis for ${exportArg}`));
      console.log(chalk.dim('Available: ' + allAnalyses.map(a => a.repoKey).join(', ')));
      return;
    }
    const markdown = generateMarkdownReport(analysis);
    await exportToFile(markdown, `data/reports/repositories/${repo}.md`);
  } else {
    const baseDir = exportArg || './data/reports';
    console.log(chalk.bold.cyan(`\nExporting ${allAnalyses.length} analyses to ${baseDir}/\n`));

    for (const analysis of allAnalyses) {
      const repoName = analysis.repoKey.split('/')[1];
      const markdown = generateMarkdownReport(analysis);
      await exportToFile(markdown, `${baseDir}/repositories/${repoName}.md`);
    }

    const summaryMarkdown = generateCombinedSummary(allAnalyses);
    await exportToFile(summaryMarkdown, `${baseDir}/summary.md`);

    console.log(chalk.green(`\n✓ Exported ${allAnalyses.length} reports to ${baseDir}/\n`));
  }
}

async function cmdBigExport() {
  const allAnalyses = getAllRepoAnalyses();
  if (allAnalyses.length === 0) {
    console.log(chalk.yellow('No cached analyses found. Run analyze first.\n'));
    return;
  }
  const bigReport = generateBigExport(allAnalyses);
  await exportToFile(bigReport, 'data/reports/report.md');
  console.log(chalk.green(`\n✓ Exported ${allAnalyses.length} repositories to data/reports/report.md\n`));
}

async function cmdTokenCount() {
  const tokenStats = await countReportTokens('data/reports');
  if (tokenStats.totals.totalFiles === 0) {
    console.log(chalk.yellow('No report files found in data/reports/\n'));
    console.log(chalk.dim('Run analyze first to generate reports.'));
    return;
  }
  displayTokenReport(tokenStats);
}

async function cmdClearCache() {
  const confirmed = await confirm({
    message: 'Clear all cached data?',
    default: false,
  });

  if (confirmed) {
    clearAllCaches();
    console.log(chalk.green('\n✓ All caches cleared.\n'));
  }
}

async function cmdGenerateCV(args, options = {}) {
  validateOpenRouterConfig();

  const cached = getAllRepoAnalyses();
  if (cached.length === 0) {
    console.log(chalk.yellow('No cached analyses found. Run analyze and big-export first.\n'));
    return;
  }

  // Parse args - could be a URL, file path, or job description
  let jobDescription = null;
  let url = null;

  if (args) {
    if (options.file) {
      // Read job description from file
      try {
        jobDescription = await readFile(args, 'utf-8');
        console.log(chalk.dim(`Read job description from ${args}\n`));
      } catch (error) {
        console.log(chalk.red(`Could not read file: ${args}\n`));
        return;
      }
    } else if (args.startsWith('http://') || args.startsWith('https://')) {
      url = args;
    } else {
      jobDescription = args;
    }
  }

  // If no args, prompt for input
  if (!jobDescription && !url) {
    const inputType = await select({
      message: 'How would you like to provide the job description?',
      choices: [
        { name: 'Paste job description text', value: 'text' },
        { name: 'Enter URL to job posting', value: 'url' },
        { name: 'Read from file', value: 'file' },
      ],
    });

    if (inputType === 'url') {
      url = await input({ message: 'Job posting URL:' });
    } else if (inputType === 'file') {
      const filePath = await input({ message: 'File path:' });
      try {
        jobDescription = await readFile(filePath, 'utf-8');
        console.log(chalk.dim(`Read job description from ${filePath}\n`));
      } catch {
        console.log(chalk.red(`Could not read file: ${filePath}\n`));
        return;
      }
    } else {
      console.log(chalk.dim('Paste the job description (press Enter twice when done):'));
      const lines = [];
      const rl = await import('readline');
      const reader = rl.createInterface({ input: process.stdin, output: process.stdout });

      await new Promise((resolve) => {
        let emptyCount = 0;
        reader.on('line', (line) => {
          if (line === '') {
            emptyCount++;
            if (emptyCount >= 2) {
              reader.close();
              resolve();
            }
          } else {
            emptyCount = 0;
            lines.push(line);
          }
        });
      });
      jobDescription = lines.join('\n');
    }
  }

  if (!jobDescription && !url) {
    console.log(chalk.red('No job description provided.\n'));
    return;
  }

  console.log(chalk.bold.cyan('\nGenerating tailored CV...\n'));

  try {
    const result = await generateCV({
      jobDescription,
      url,
      display: options.display,
    });

    console.log(chalk.green(`\n✓ CV generated!`));
    console.log(chalk.dim(`  LaTeX: ${result.texPath}`));

    if (result.pdfPath) {
      console.log(chalk.green(`  PDF:   ${result.pdfPath}`));
    }

    console.log(chalk.dim(`  Tokens used: ${result.usage.inputTokens + result.usage.outputTokens}\n`));
  } catch (error) {
    console.error(chalk.red('Failed to generate CV:'), error.message);
  }
}

async function cmdConfig(action, key, value) {
  if (!action) {
    // Show current config
    const config = getAllConfig();
    console.log(chalk.bold.cyan('\nCurrent Configuration:\n'));

    console.log(chalk.bold('CV Settings:'));
    const cvConfig = config.cv;
    for (const [k, v] of Object.entries(cvConfig)) {
      const displayValue = v || chalk.dim('(not set)');
      console.log(`  ${chalk.cyan(k)}: ${displayValue}`);
    }
    console.log();
    return;
  }

  if (action === 'set') {
    if (!key || value === undefined) {
      console.log(chalk.red('Usage: yarn start config set <key> <value>\n'));
      console.log('Available keys: name, email, phone, location, website, linkedin, github, template, model');
      return;
    }
    setCVConfigValue(key, value);
    console.log(chalk.green(`✓ Set ${key} = ${value}\n`));
    return;
  }

  if (action === 'get') {
    if (!key) {
      console.log(chalk.red('Usage: yarn start config get <key>\n'));
      return;
    }
    const cvConfig = getCVConfig();
    const val = cvConfig[key];
    console.log(`${key}: ${val || chalk.dim('(not set)')}\n`);
    return;
  }

  console.log(chalk.red(`Unknown config action: ${action}`));
  console.log('Usage: yarn start config [set <key> <value> | get <key>]\n');
}

async function cmdImport(reportsDir = 'data/reports/repositories') {
  if (!isAuthenticated()) {
    console.log(chalk.yellow('Not authenticated. Please login first to determine owner.\n'));
    await authenticate();
  }

  const user = getUser();
  const owner = user?.login;

  if (!owner) {
    console.log(chalk.red('Could not determine GitHub username. Please login first.\n'));
    return;
  }

  console.log(chalk.bold.cyan(`\nImporting reports from ${reportsDir}/\n`));

  let files;
  try {
    files = await readdir(reportsDir);
  } catch {
    console.log(chalk.red(`Could not read directory: ${reportsDir}\n`));
    return;
  }

  const mdFiles = files.filter(f => f.endsWith('.md'));

  if (mdFiles.length === 0) {
    console.log(chalk.yellow('No markdown files found.\n'));
    return;
  }

  let importCount = 0;
  let errorCount = 0;

  for (const file of mdFiles) {
    const repoName = basename(file, '.md');
    const filePath = join(reportsDir, file);

    try {
      const content = await readFile(filePath, 'utf-8');
      importAnalysisFromMarkdown(owner, repoName, content);
      console.log(chalk.green(`  ✓ ${repoName}`));
      importCount++;
    } catch (error) {
      console.log(chalk.red(`  ✗ ${repoName}: ${error.message}`));
      errorCount++;
    }
  }

  console.log(chalk.cyan('\n' + '─'.repeat(50)));
  console.log(chalk.bold.green(`✓ Imported ${importCount} reports to cache`));
  if (errorCount > 0) {
    console.log(chalk.dim(`  ${errorCount} failed`));
  }
  console.log(chalk.cyan('─'.repeat(50) + '\n'));
}

async function cmdExclude(action, projectName) {
  const excluded = getExcludedProjects();

  if (!action) {
    // List excluded projects
    console.log(chalk.bold.cyan('\nExcluded Projects:\n'));
    if (excluded.length === 0) {
      console.log(chalk.dim('  No projects excluded. All projects will be included in CV generation.\n'));
    } else {
      for (const project of excluded) {
        console.log(`  ${chalk.red('✗')} ${project}`);
      }
      console.log();
    }
    console.log(chalk.dim('Usage:'));
    console.log(chalk.dim('  yarn start exclude add <project>    Exclude a project'));
    console.log(chalk.dim('  yarn start exclude remove <project> Include a project again\n'));
    return;
  }

  if (action === 'add') {
    if (!projectName) {
      console.log(chalk.red('Please specify a project name to exclude.\n'));
      console.log(chalk.dim('Usage: yarn start exclude add <project-name>'));
      return;
    }
    excludeProject(projectName);
    console.log(chalk.green(`✓ Excluded "${projectName}" from CV generation.\n`));
    return;
  }

  if (action === 'remove') {
    if (!projectName) {
      console.log(chalk.red('Please specify a project name to include.\n'));
      console.log(chalk.dim('Usage: yarn start exclude remove <project-name>'));
      return;
    }
    if (!excluded.includes(projectName)) {
      console.log(chalk.yellow(`"${projectName}" is not in the exclusion list.\n`));
      return;
    }
    includeProject(projectName);
    console.log(chalk.green(`✓ "${projectName}" will now be included in CV generation.\n`));
    return;
  }

  console.log(chalk.red(`Unknown action: ${action}`));
  console.log(chalk.dim('Usage: yarn start exclude [add|remove] <project-name>\n'));
}

// ============================================================================
// Interactive Menu
// ============================================================================

async function showMainMenu() {
  const cached = getAllRepoAnalyses();

  const choices = [];

  if (!isAuthenticated()) {
    choices.push({ name: '🔑  Login to GitHub', value: 'auth' });
  } else {
    choices.push(
      { name: '📋  List repositories', value: 'list' },
      { name: '🔍  Analyze repository', value: 'analyze' },
      { name: `⚡  Analyze all unanalyzed repos`, value: 'analyze-all' },
    );

    if (cached.length > 0) {
      choices.push(
        { name: `📁  Export reports (${cached.length} cached)`, value: 'export' },
        { name: '📄  Export all to single file', value: 'big-export' },
        { name: '📝  Generate CV for job', value: 'generate-cv' },
        { name: '🔢  Count tokens in reports', value: 'token-count' },
      );
    } else {
      choices.push(
        { name: '📥  Import reports to cache', value: 'import' },
      );
    }

    choices.push(
      { name: '⚙️   Configuration', value: 'config' },
      { name: '🗑️   Clear cache', value: 'clear-cache' },
      { name: '🚪  Logout', value: 'logout' },
    );
  }

  choices.push(
    { name: '❓  Help (CLI commands)', value: 'help' },
    { name: chalk.dim('Exit'), value: 'exit' }
  );

  const action = await select({
    message: 'What would you like to do?',
    choices,
    pageSize: 12,
  });

  return action;
}

async function interactiveMode() {
  clearScreen();
  showBanner();
  showStatus();

  while (true) {
    try {
      const action = await showMainMenu();

      if (action === 'exit') {
        console.log(chalk.dim('\nGoodbye!\n'));
        break;
      }

      console.log();

      switch (action) {
        case 'auth':
          await cmdAuth();
          break;
        case 'logout':
          await cmdLogout();
          break;
        case 'list':
          await cmdList();
          break;
        case 'analyze':
          await cmdAnalyze();
          break;
        case 'analyze-all':
          await cmdAnalyzeAll();
          break;
        case 'export':
          await cmdExport();
          break;
        case 'big-export':
          await cmdBigExport();
          break;
        case 'token-count':
          await cmdTokenCount();
          break;
        case 'import':
          await cmdImport();
          break;
        case 'generate-cv':
          await cmdGenerateCV(null, { display: true });
          break;
        case 'config':
          await cmdConfig();
          break;
        case 'clear-cache':
          await cmdClearCache();
          break;
        case 'help':
          showHelp();
          break;
      }

      // Pause before showing menu again
      await input({ message: chalk.dim('Press Enter to continue...') });
      clearScreen();
      showBanner();
      showStatus();

    } catch (error) {
      if (error.name === 'ExitPromptError') {
        console.log(chalk.dim('\nGoodbye!\n'));
        break;
      }
      console.error(chalk.red('\nError:'), error.message);
      if (process.env.DEBUG) console.error(error);
    }
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  // Parse flags
  const hasFlag = (flag) => args.includes(`--${flag}`) || args.includes(`-${flag[0]}`);
  const forceMode = hasFlag('force');
  const options = { force: forceMode };

  // Get positional args (commands without --)
  const commands = args.filter(a => !a.startsWith('-'));
  const command = commands[0];
  const commandArg = commands[1];

  // Help
  if (hasFlag('help') || command === 'help') {
    showHelp();
    return;
  }

  // No args = interactive mode
  if (args.length === 0) {
    await interactiveMode();
    return;
  }

  // Validate config for most commands
  if (!['auth', 'logout', 'help', 'clear-cache', 'import', 'token-count', 'big-export', 'generate-cv', 'config'].includes(command)) {
    validateConfig();
  }

  try {
    switch (command) {
      case 'auth':
        await cmdAuth();
        break;
      case 'logout':
        await cmdLogout();
        break;
      case 'list':
        await cmdList();
        break;
      case 'analyze':
        await cmdAnalyze(commandArg, options);
        break;
      case 'analyze-all':
        await cmdAnalyzeAll(options);
        break;
      case 'export':
        await cmdExport(commandArg);
        break;
      case 'big-export':
        await cmdBigExport();
        break;
      case 'token-count':
        await cmdTokenCount();
        break;
      case 'import':
        await cmdImport(commandArg);
        break;
      case 'generate-cv':
        await cmdGenerateCV(commandArg, { display: true, file: hasFlag('file') });
        break;
      case 'config':
        await cmdConfig(commandArg, commands[2], commands[3]);
        break;
      case 'exclude':
        await cmdExclude(commandArg, commands[2]);
        break;
      case 'clear-cache':
        await cmdClearCache();
        break;
      default:
        // Check for old --command style
        if (args[0]?.startsWith('--')) {
          const oldCmd = args[0].replace('--', '');
          console.log(chalk.yellow(`Hint: Use "yarn start ${oldCmd}" instead of "--${oldCmd}"\n`));
        }
        console.log(chalk.red(`Unknown command: ${command || args.join(' ')}`));
        showHelp();
        process.exit(1);
    }
  } catch (error) {
    if (error.name === 'ExitPromptError') {
      console.log(chalk.dim('\nCancelled.\n'));
      return;
    }
    console.error(chalk.red('\nError:'), error.message);
    if (process.env.DEBUG) console.error(error);
    process.exit(1);
  }
}

main();
