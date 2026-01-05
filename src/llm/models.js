/**
 * Model configuration for OpenRouter
 * Defines model modes and parameter overrides
 */

// Model modes with defaults - ordered by speed/cost
export const MODEL_MODES = {
  VERY_FAST: {
    id: 'very_fast',
    model: 'google/gemini-2.5-flash-lite',
    description: 'Fastest, cheapest - for bulk categorization',
    params: {
      temperature: 0.3,
      max_tokens: 1000
    }
  },
  FAST: {
    id: 'fast',
    model: 'google/gemini-2.5-flash',
    description: 'Fast with good quality',
    params: {
      temperature: 0.4,
      max_tokens: 2000
    }
  },
  BALANCED: {
    id: 'balanced',
    model: 'google/gemini-2.5-flash',
    description: 'Good balance of speed and quality',
    params: {
      temperature: 0.5,
      max_tokens: 4000
    }
  },
  HIGH_REASONING: {
    id: 'high_reasoning',
    model: 'google/gemini-2.5-flash',
    description: 'Best reasoning capabilities',
    params: {
      temperature: 0.3,
      max_tokens: 4000
    }
  },
  MAX_QUALITY: {
    id: 'max_quality',
    model: 'google/gemini-2.5-flash',
    description: 'Highest quality output',
    params: {
      temperature: 0.4,
      max_tokens: 4000
    }
  }
};

// Parameter overrides that can be applied to any mode
export const MODEL_PARAMS = {
  web: {
    // Enables web search if model supports it
    // (some models on OpenRouter support this)
  },
  reasoning: {
    temperature: 0.2,
    max_tokens: 4000
  },
  creative: {
    temperature: 0.8,
    max_tokens: 4000
  },
  concise: {
    temperature: 0.3,
    max_tokens: 500
  }
};

/**
 * Get model configuration for a given mode with optional overrides
 * @param {string} mode - Mode name (e.g., 'VERY_FAST', 'HIGH_REASONING') or direct model name (e.g., 'openai/gpt-4o')
 * @param {string[]} overrides - Array of override names (e.g., ['reasoning', 'concise'])
 * @returns {Object} Complete model configuration
 */
export function getModel(mode, overrides = []) {
  // Check if it's a direct model name (contains a slash like 'openai/gpt-4o')
  if (mode.includes('/')) {
    let params = {
      temperature: 0.4,
      max_tokens: 4000
    };

    // Apply overrides
    for (const override of overrides) {
      const overrideParams = MODEL_PARAMS[override];
      if (overrideParams) {
        params = { ...params, ...overrideParams };
      }
    }

    return {
      model: mode,
      description: 'Custom model',
      params
    };
  }

  const modeConfig = MODEL_MODES[mode];

  if (!modeConfig) {
    throw new Error(`Unknown model mode: ${mode}. Available modes: ${Object.keys(MODEL_MODES).join(', ')}`);
  }

  // Start with base params from the mode
  let params = { ...modeConfig.params };

  // Apply each override in order
  for (const override of overrides) {
    const overrideParams = MODEL_PARAMS[override];
    if (overrideParams) {
      params = { ...params, ...overrideParams };
    }
  }

  return {
    model: modeConfig.model,
    description: modeConfig.description,
    params
  };
}

/**
 * List all available model modes
 * @returns {Object[]} Array of mode info objects
 */
export function listAvailableModels() {
  return Object.entries(MODEL_MODES).map(([name, config]) => ({
    name,
    model: config.model,
    description: config.description
  }));
}

/**
 * List all available parameter overrides
 * @returns {Object[]} Array of override info objects
 */
export function listAvailableOverrides() {
  return Object.entries(MODEL_PARAMS).map(([name, params]) => ({
    name,
    params
  }));
}

// Default modes for different analysis phases
export const ANALYSIS_MODES = {
  categorization: 'VERY_FAST',  // Cheap pass for initial categorization
  detailed: 'HIGH_REASONING',    // Detailed analysis with diffs
  summary: 'BALANCED'            // Final summary generation
};
