import { createOAuthDeviceAuth } from '@octokit/auth-oauth-device';
import { Octokit } from '@octokit/rest';
import chalk from 'chalk';
import ora from 'ora';
import { config } from './config.js';
import { saveToken, saveUser, getToken, clearAuth } from './storage.js';

export async function authenticate() {
  const spinner = ora('Starting GitHub authentication...').start();

  try {
    const auth = createOAuthDeviceAuth({
      clientType: 'oauth-app',
      clientId: config.github.clientId,
      scopes: config.github.scopes,
      onVerification(verification) {
        spinner.stop();
        console.log('\n' + chalk.cyan('━'.repeat(50)));
        console.log(chalk.bold('\n  GitHub Device Authentication\n'));
        console.log(`  ${chalk.dim('1.')} Open this URL in your browser:`);
        console.log(`     ${chalk.yellow.underline(verification.verification_uri)}\n`);
        console.log(`  ${chalk.dim('2.')} Enter this code:`);
        console.log(`     ${chalk.green.bold(verification.user_code)}\n`);
        console.log(chalk.cyan('━'.repeat(50)) + '\n');
        spinner.start('Waiting for authorization...');
      },
    });

    // This will wait for user to authorize
    const { token } = await auth({ type: 'oauth' });

    // Save the token
    saveToken(token);

    // Get user info
    const octokit = new Octokit({ auth: token });
    const { data: user } = await octokit.users.getAuthenticated();

    saveUser({
      login: user.login,
      name: user.name,
      id: user.id,
    });

    spinner.succeed(chalk.green(`Authenticated as ${chalk.bold(user.login)}`));

    return { token, user };
  } catch (error) {
    spinner.fail(chalk.red('Authentication failed'));
    throw error;
  }
}

export async function getAuthenticatedOctokit() {
  const token = getToken();

  if (!token) {
    throw new Error('Not authenticated. Please run with --auth first.');
  }

  const octokit = new Octokit({ auth: token });

  // Verify the token is still valid
  try {
    await octokit.users.getAuthenticated();
    return octokit;
  } catch (error) {
    if (error.status === 401) {
      clearAuth();
      throw new Error('Token expired. Please run with --auth to re-authenticate.');
    }
    throw error;
  }
}

export async function logout() {
  clearAuth();
  console.log(chalk.green('Successfully logged out.'));
}
