#!/usr/bin/env node

import chalk from 'chalk';
import { config, validateConfig } from './config.js';
import { authenticate, logout, getAuthenticatedOctokit } from './auth.js';
import { listRepositories, displayRepositories } from './github.js';
import { isAuthenticated, getUser } from './storage.js';

function showHelp() {
  console.log(`
${chalk.bold.cyan('GitAudit')} - GitHub Portfolio Analyzer

${chalk.bold('Usage:')}
  npm start              Show status and help
  npm run auth           Authenticate with GitHub
  npm run list           List all repositories

${chalk.bold('Commands:')}
  --auth                 Authenticate with GitHub (OAuth device flow)
  --logout               Remove saved authentication
  --list                 List all your repositories (public & private)
  --help                 Show this help message

${chalk.bold('Setup:')}
  1. Create a GitHub OAuth App at ${chalk.underline('https://github.com/settings/developers')}
  2. Copy ${chalk.yellow('.env.example')} to ${chalk.yellow('.env')}
  3. Add your GitHub Client ID to ${chalk.yellow('.env')}
  4. Run ${chalk.cyan('npm run auth')} to authenticate
  5. Run ${chalk.cyan('npm run list')} to see your repositories
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

async function main() {
  const args = process.argv.slice(2);

  // Help command doesn't need config validation
  if (args.includes('--help') || args.includes('-h')) {
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
  if (args.includes('--logout')) {
    await logout();
    return;
  }

  // All other commands need config
  validateConfig();

  try {
    if (args.includes('--auth')) {
      await authenticate();
      console.log(chalk.dim('\nYou can now run: npm run list'));
    } else if (args.includes('--list')) {
      if (!isAuthenticated()) {
        console.log(chalk.yellow('Not authenticated. Starting authentication...\n'));
        await authenticate();
        console.log();
      }

      const repos = await listRepositories();
      displayRepositories(repos);
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
