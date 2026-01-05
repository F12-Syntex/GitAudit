/**
 * Prompt templates for commit analysis
 * Designed for token efficiency and factual output
 */

/**
 * Format commit info for prompts
 * @param {Object} commit - Commit object
 * @returns {string} Formatted commit line
 */
function formatCommit(commit) {
  const sha = commit.sha?.slice(0, 7) || '?';
  const message = commit.commit?.message?.split('\n')[0] || commit.message?.split('\n')[0] || '';
  const date = commit.commit?.author?.date || commit.date || '';
  const dateStr = date ? new Date(date).toLocaleDateString() : '';

  return `- ${sha}: ${message} [${dateStr}]`;
}

/**
 * Prompt for initial batch categorization (cheap pass)
 * Uses minimal tokens - just commit messages and basic info
 * @param {Object} batch - Batch of commits
 * @returns {string} Prompt text
 */
export function batchCategorizationPrompt(batch) {
  const commits = batch.commits.map(formatCommit).join('\n');
  const dateRange = batch.startDate && batch.endDate
    ? `${new Date(batch.endDate).toLocaleDateString()} - ${new Date(batch.startDate).toLocaleDateString()}`
    : 'unknown';

  return `Categorize these git commits:

Commits (${batch.commits.length} total, ${dateRange}):
${commits}

Respond ONLY with JSON:
{
  "category": "feature|bugfix|refactor|docs|test|performance|chore|style|other",
  "description": "Technical 1-sentence description: what was built/fixed, which technologies/frameworks used",
  "importance": 1-5
}

Importance scale:
1: Trivial (typos, minor tweaks)
2: Small (config changes, minor fixes)
3: Medium (notable features, significant fixes)
4: Large (major features, architectural changes)
5: Critical (core system changes)

Be factual and technical. Example description: "Built REST API endpoints using Express.js with PostgreSQL for user authentication"`;
}

/**
 * Prompt for detailed analysis with diff (expensive pass)
 * Only used for important batches
 * @param {Object} batch - Batch of commits
 * @param {Object} changes - Effective changes from the batch
 * @returns {string} Prompt text
 */
export function detailedAnalysisPrompt(batch, changes) {
  const commits = batch.commits.map(formatCommit).join('\n');

  // Build file changes summary
  let filesSummary = '';
  if (changes?.files) {
    const topFiles = changes.files.slice(0, 10); // Limit to top 10 files
    filesSummary = topFiles.map(f =>
      `  ${f.status}: ${f.filename} (+${f.additions}/-${f.deletions})`
    ).join('\n');

    if (changes.files.length > 10) {
      filesSummary += `\n  ... and ${changes.files.length - 10} more files`;
    }
  }

  // Include truncated patches for context (limit to 3000 chars to save tokens)
  let patchSummary = '';
  if (changes?.files) {
    const patches = changes.files
      .filter(f => f.patch)
      .slice(0, 5) // Top 5 files with patches
      .map(f => `--- ${f.filename} ---\n${f.patch?.slice(0, 500) || ''}${f.patch?.length > 500 ? '\n[truncated]' : ''}`)
      .join('\n\n');

    if (patches) {
      patchSummary = patches.slice(0, 3000);
    }
  }

  return `Describe this code change in technical detail:

Commits:
${commits}

Files changed:
${filesSummary || 'No file details available'}

${patchSummary ? `Code changes (sample):\n\`\`\`diff\n${patchSummary}\n\`\`\`` : ''}

Write a detailed technical description (150-200 words) explaining:
1. WHAT was built/implemented/fixed - be very specific about functionality
2. HOW it was implemented - describe the approach, patterns, data flow
3. WHY certain decisions were made (if apparent from the code)
4. What technologies/libraries/APIs are used and how they connect

Format your response as bullet points:
- Start each bullet with an action verb (Implemented, Created, Added, Built, etc.)
- Include specific function/class/file names when relevant
- Explain data flow: "X calls Y which returns Z"
- Mention any integrations: "Connected X API to Y component using Z pattern"

Example format:
- Implemented OAuth device flow authentication using @octokit/auth-oauth-device
- Created pollForToken() function that polls GitHub API every 5 seconds until user completes authorization
- Added persistent token storage using Conf library, storing encrypted credentials in user's app data folder
- Built getAuthenticatedOctokit() factory that initializes REST client with stored token`;
}

/**
 * Prompt for final portfolio summary
 * Synthesizes all batch analyses into cohesive factual summary
 * @param {Object[]} analyses - All batch analyses
 * @param {Object} repoInfo - Repository information
 * @param {Object} stats - Work statistics (hours, sessions, etc.)
 * @returns {string} Prompt text
 */
export function portfolioSummaryPrompt(analyses, repoInfo, stats = {}) {
  // Group by category
  const byCategory = {};
  for (const analysis of analyses) {
    const cat = analysis.category || 'other';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(analysis);
  }

  // Format contributions by category
  const contributions = Object.entries(byCategory)
    .filter(([_, items]) => items.length > 0)
    .map(([category, items]) => {
      const categoryItems = items
        .sort((a, b) => (b.importance || 0) - (a.importance || 0))
        .slice(0, 5) // Top 5 per category
        .map(a => `  - ${a.description}`);
      return `${category.toUpperCase()}:\n${categoryItems.join('\n')}`;
    })
    .join('\n\n');

  // Calculate stats
  const totalCommits = analyses.reduce((sum, a) => sum + a.batch.commits.length, 0);
  const dateRange = getDateRange(analyses);

  return `Generate a detailed technical summary of contributions:

Repository: ${repoInfo.name}
${repoInfo.description ? `Description: ${repoInfo.description}` : ''}
${repoInfo.languages ? `Languages: ${Object.keys(repoInfo.languages).join(', ')}` : ''}

Work done (${totalCommits} commits, ${dateRange}):
${contributions}

Generate a markdown summary with these sections:

## Technical Implementation

For each major piece of work, describe:
1. What was built and its purpose
2. How it works (architecture, data flow, key functions)
3. Technologies/libraries used and why

Format as detailed bullet points. Example:
- **OAuth Authentication System**: Implemented GitHub OAuth device flow using @octokit/auth-oauth-device. User visits GitHub URL, enters code, and pollForToken() polls the API until authorization completes. Tokens stored persistently using Conf library in user's AppData folder.
- **Commit Analysis Pipeline**: Built token-efficient analysis using tiered LLM approach. First pass uses cheap model (Gemini) for categorization, second pass uses Sonnet only for important batches. Batches commits by 4-hour time windows to reduce API calls.

## Architecture

Briefly describe how components connect:
- Which files/modules handle what
- Data flow between components
- External APIs/services used

## Technologies

List specific technologies with their purpose:
- @octokit/rest - GitHub API client for fetching commits and repo data
- Conf - Persistent JSON storage for caching and credentials
- etc.

Rules:
- Be specific and technical - name actual functions, files, patterns
- Explain HOW things work, not just WHAT they do
- No marketing language, no vague descriptions`;
}

/**
 * Get date range string from analyses
 * @param {Object[]} analyses - Analyses
 * @returns {string} Date range string
 */
function getDateRange(analyses) {
  let minDate = null;
  let maxDate = null;

  for (const analysis of analyses) {
    if (analysis.batch.startDate) {
      const start = new Date(analysis.batch.startDate);
      const end = new Date(analysis.batch.endDate || analysis.batch.startDate);

      if (!minDate || end < minDate) minDate = end;
      if (!maxDate || start > maxDate) maxDate = start;
    }
  }

  if (!minDate || !maxDate) return 'various dates';

  const formatDate = (d) => d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

  if (minDate.getMonth() === maxDate.getMonth() && minDate.getFullYear() === maxDate.getFullYear()) {
    return formatDate(minDate);
  }

  return `${formatDate(minDate)} - ${formatDate(maxDate)}`;
}
