/**
 * User configuration management
 * Stores user preferences like templates, models, and personal info
 */

import Conf from 'conf';
import { readFile, access } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const userConfigStore = new Conf({
  projectName: 'gitaudit',
  configName: 'user-config',
  schema: {
    cv: {
      type: 'object',
      properties: {
        template: { type: 'string' },
        model: { type: 'string' },
        name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        location: { type: 'string' },
        website: { type: 'string' },
        linkedin: { type: 'string' },
        github: { type: 'string' },
      },
    },
  },
});

// Default configuration values
const DEFAULTS = {
  cv: {
    template: 'default',
    model: 'VERY_FAST',
    name: 'Saifurahmaan Khan',
    email: 'eng.saifkhan2003@gmail.com',
    phone: '+44 7459 533082',
    location: 'London, UK',
    website: '',
    linkedin: 'https://www.linkedin.com/in/saif-khan-550b76247/',
    github: 'https://github.com/F12-Syntex',
  },
};

/**
 * Get CV configuration
 * @returns {Object} CV config with defaults
 */
export function getCVConfig() {
  const stored = userConfigStore.get('cv') || {};
  return { ...DEFAULTS.cv, ...stored };
}

/**
 * Set CV configuration
 * @param {Object} config - Configuration to merge
 */
export function setCVConfig(config) {
  const current = getCVConfig();
  userConfigStore.set('cv', { ...current, ...config });
}

/**
 * Get a specific CV config value
 * @param {string} key - Config key
 * @returns {any} Config value
 */
export function getCVConfigValue(key) {
  return getCVConfig()[key];
}

/**
 * Set a specific CV config value
 * @param {string} key - Config key
 * @param {any} value - Config value
 */
export function setCVConfigValue(key, value) {
  const current = getCVConfig();
  current[key] = value;
  userConfigStore.set('cv', current);
}

/**
 * Get the LaTeX template content
 * @param {string} templateName - Template name or path
 * @returns {Promise<string>} Template content
 */
export async function getTemplate(templateName = 'default') {
  // Check if it's a path to a custom template
  if (templateName.endsWith('.tex') || templateName.includes('/') || templateName.includes('\\')) {
    try {
      await access(templateName);
      return await readFile(templateName, 'utf-8');
    } catch {
      throw new Error(`Template file not found: ${templateName}`);
    }
  }

  // Otherwise, load from built-in templates
  const templatePath = join(__dirname, '..', 'templates', `cv-${templateName}.tex`);
  try {
    return await readFile(templatePath, 'utf-8');
  } catch {
    throw new Error(`Built-in template not found: ${templateName}. Available: default`);
  }
}

/**
 * List available templates
 * @returns {string[]} Template names
 */
export function listTemplates() {
  return ['default'];
}

/**
 * Get all user config
 * @returns {Object} All configuration
 */
export function getAllConfig() {
  return {
    cv: getCVConfig(),
  };
}

/**
 * Reset configuration to defaults
 */
export function resetConfig() {
  userConfigStore.clear();
}
