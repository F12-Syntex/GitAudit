import chalk from 'chalk';
import ora from 'ora';
import { getAuthenticatedOctokit } from './auth.js';

export async function listRepositories() {
  const spinner = ora('Fetching repositories...').start();

  try {
    const octokit = await getAuthenticatedOctokit();

    // Fetch all repositories (handles pagination automatically)
    const repos = await octokit.paginate(octokit.repos.listForAuthenticatedUser, {
      visibility: 'all', // public, private, and internal
      affiliation: 'owner,collaborator,organization_member',
      sort: 'updated',
      per_page: 100,
    });

    spinner.succeed(`Found ${chalk.bold(repos.length)} repositories\n`);

    return repos;
  } catch (error) {
    spinner.fail(chalk.red('Failed to fetch repositories'));
    throw error;
  }
}

export function displayRepositories(repos) {
  const owned = repos.filter(r => !r.fork);
  const forked = repos.filter(r => r.fork);
  const publicRepos = repos.filter(r => !r.private);
  const privateRepos = repos.filter(r => r.private);

  console.log(chalk.cyan('━'.repeat(60)));
  console.log(chalk.bold('\n  Repository Summary\n'));
  console.log(`  ${chalk.dim('Total:')}      ${repos.length}`);
  console.log(`  ${chalk.dim('Owned:')}      ${owned.length}`);
  console.log(`  ${chalk.dim('Forked:')}     ${forked.length}`);
  console.log(`  ${chalk.dim('Public:')}     ${publicRepos.length}`);
  console.log(`  ${chalk.dim('Private:')}    ${privateRepos.length}`);
  console.log(chalk.cyan('\n━'.repeat(60)));

  console.log(chalk.bold('\n  Your Repositories:\n'));

  repos.forEach((repo, index) => {
    const visibility = repo.private ? chalk.yellow('[Private]') : chalk.green('[Public]');
    const fork = repo.fork ? chalk.dim(' (fork)') : '';
    const stars = repo.stargazers_count > 0 ? chalk.yellow(` ★${repo.stargazers_count}`) : '';
    const language = repo.language ? chalk.dim(` [${repo.language}]`) : '';

    console.log(
      `  ${chalk.dim(`${(index + 1).toString().padStart(3)}.`)} ${chalk.bold(repo.name)}${fork}${stars}${language}`
    );
    console.log(`       ${visibility} ${chalk.dim(repo.html_url)}`);

    if (repo.description) {
      console.log(`       ${chalk.dim(repo.description.substring(0, 60))}${repo.description.length > 60 ? '...' : ''}`);
    }
    console.log();
  });

  console.log(chalk.cyan('━'.repeat(60)) + '\n');
}

export async function getRepositoryDetails(owner, repo) {
  const octokit = await getAuthenticatedOctokit();

  const [repoData, languages, commits, contributors] = await Promise.all([
    octokit.repos.get({ owner, repo }),
    octokit.repos.listLanguages({ owner, repo }),
    octokit.repos.listCommits({ owner, repo, per_page: 1 }).catch(() => ({ data: [] })),
    octokit.repos.listContributors({ owner, repo, per_page: 10 }).catch(() => ({ data: [] })),
  ]);

  return {
    ...repoData.data,
    languages: languages.data,
    totalCommits: commits.data.length > 0 ? 'Available' : 'No commits',
    topContributors: contributors.data,
  };
}
