import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
dotenv.config({ path: join(__dirname, '..', '.env') });

export const config = {
  github: {
    clientId: process.env.GITHUB_CLIENT_ID,
    // Scopes needed: repo (full access to private repos), read:user (read user profile)
    scopes: ['repo', 'read:user'],
  },
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY,
    baseUrl: 'https://openrouter.ai/api/v1',
  },
};

export function validateConfig() {
  const missing = [];

  if (!config.github.clientId) {
    missing.push('GITHUB_CLIENT_ID');
  }

  if (missing.length > 0) {
    console.error('Missing required environment variables:');
    missing.forEach(v => console.error(`  - ${v}`));
    console.error('\nPlease copy .env.example to .env and fill in the values.');
    process.exit(1);
  }
}
