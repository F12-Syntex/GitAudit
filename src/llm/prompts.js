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

  return `Describe this code change factually:

Commits:
${commits}

Files changed:
${filesSummary || 'No file details available'}

${patchSummary ? `Code changes (sample):\n\`\`\`diff\n${patchSummary}\n\`\`\`` : ''}

Write a FACTUAL technical description (under 100 words) covering:
1. What was built/implemented/fixed (be specific)
2. Technologies, frameworks, libraries used
3. How components connect (e.g. "linked X with Y to achieve Z")

Rules:
- No fluff, no marketing language
- Be specific: "Implemented JWT authentication with bcrypt hashing" not "Added security features"
- Name actual technologies and patterns used
- Format: "[Action] [what] using [technologies] to [purpose]"`;
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

  return `Generate a FACTUAL technical summary of contributions:

Repository: ${repoInfo.name}
${repoInfo.description ? `Description: ${repoInfo.description}` : ''}
${repoInfo.languages ? `Languages: ${Object.keys(repoInfo.languages).join(', ')}` : ''}

Work done (${totalCommits} commits, ${dateRange}):
${contributions}

Generate a markdown summary with these sections:

## Technical Work

List what was actually built/implemented. Format each item as:
"[Built/Implemented/Created] [specific thing] using [technologies] [optional: to achieve purpose]"

Examples:
- Built REST API with Express.js and PostgreSQL for user management
- Implemented OAuth2 authentication flow linking frontend React app with backend JWT tokens
- Created data pipeline using Python pandas to transform CSV exports into normalized database records

## Technologies Used

Bullet list of specific technologies, frameworks, libraries actually used in the code.

Rules:
- NO fluff, NO marketing speak, NO vague descriptions
- Be specific and technical
- Only include what was actually done based on the commits
- Keep it under 300 words total`;
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
