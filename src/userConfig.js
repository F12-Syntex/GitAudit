/**
 * User configuration management
 * Simple JSON file based config at .cvconfig.json
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONFIG_PATH = join(__dirname, '..', '.cvconfig.json');

// Default configuration values
const DEFAULTS = {
  model: 'google/gemini-2.5-flash',
  analysisModel: 'google/gemini-2.0-flash-lite-001',
  name: 'Your Name',
  email: 'your.email@example.com',
  phone: '+44 XXX XXX XXXX',
  location: 'London, UK',
  website: '',
  linkedin: '',
  github: '',
  excludedProjects: [],
};

/**
 * Load config from file
 * @returns {Object} Config object
 */
function loadConfig() {
  try {
    if (existsSync(CONFIG_PATH)) {
      const content = readFileSync(CONFIG_PATH, 'utf-8');
      return JSON.parse(content);
    }
  } catch {
    // Return defaults if file doesn't exist or is invalid
  }
  return {};
}

/**
 * Save config to file
 * @param {Object} config - Config to save
 */
function saveConfig(config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Get CV configuration
 * @returns {Object} CV config with defaults
 */
export function getCVConfig() {
  const stored = loadConfig();
  return { ...DEFAULTS, ...stored };
}

/**
 * Set CV configuration
 * @param {Object} config - Configuration to merge
 */
export function setCVConfig(config) {
  const current = getCVConfig();
  saveConfig({ ...current, ...config });
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
  saveConfig(current);
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
  saveConfig(DEFAULTS);
}

/**
 * Get excluded projects list
 * @returns {string[]} Excluded project names
 */
export function getExcludedProjects() {
  const config = getCVConfig();
  return config.excludedProjects || [];
}

/**
 * Add a project to exclusion list
 * @param {string} projectName - Project name to exclude
 */
export function excludeProject(projectName) {
  const config = getCVConfig();
  const excluded = config.excludedProjects || [];
  if (!excluded.includes(projectName)) {
    excluded.push(projectName);
    setCVConfigValue('excludedProjects', excluded);
  }
}

/**
 * Remove a project from exclusion list
 * @param {string} projectName - Project name to include again
 */
export function includeProject(projectName) {
  const config = getCVConfig();
  const excluded = config.excludedProjects || [];
  const index = excluded.indexOf(projectName);
  if (index !== -1) {
    excluded.splice(index, 1);
    setCVConfigValue('excludedProjects', excluded);
  }
}
