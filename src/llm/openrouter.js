/**
 * OpenRouter API wrapper using AI SDK
 */

import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText, streamText } from 'ai';
import { config, validateOpenRouterConfig } from '../config.js';
import { getModel, MODEL_MODES, ANALYSIS_MODES } from './models.js';

let openRouterInstance = null;

/**
 * Create or get the OpenRouter provider instance
 * @returns {Object} OpenRouter provider
 */
export function createLLMProvider() {
  if (!openRouterInstance) {
    validateOpenRouterConfig();
    openRouterInstance = createOpenRouter({
      apiKey: config.openrouter.apiKey
    });
  }
  return openRouterInstance;
}

/**
 * Token usage tracker for cost awareness
 */
class TokenUsageTracker {
  constructor() {
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.calls = [];
  }

  track(operation, usage) {
    const entry = {
      operation,
      inputTokens: usage?.promptTokens || 0,
      outputTokens: usage?.completionTokens || 0,
      timestamp: new Date()
    };
    this.calls.push(entry);
    this.totalInputTokens += entry.inputTokens;
    this.totalOutputTokens += entry.outputTokens;
    return entry;
  }

  getTotal() {
    return {
      inputTokens: this.totalInputTokens,
      outputTokens: this.totalOutputTokens,
      totalTokens: this.totalInputTokens + this.totalOutputTokens,
      callCount: this.calls.length
    };
  }

  reset() {
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.calls = [];
  }
}

// Global usage tracker
export const usageTracker = new TokenUsageTracker();

/**
 * Generate text completion (non-streaming)
 * @param {string} prompt - The prompt to send
 * @param {string} mode - Model mode (e.g., 'VERY_FAST', 'HIGH_REASONING')
 * @param {Object} options - Additional options
 * @param {string[]} options.overrides - Parameter overrides to apply
 * @param {string} options.system - System prompt
 * @returns {Promise<{text: string, usage: Object}>}
 */
export async function generate(prompt, mode = 'BALANCED', options = {}) {
  const openrouter = createLLMProvider();
  const modelConfig = getModel(mode, options.overrides || []);

  const result = await generateText({
    model: openrouter(modelConfig.model),
    prompt,
    system: options.system,
    temperature: modelConfig.params.temperature,
    maxTokens: modelConfig.params.max_tokens
  });

  // Track usage
  const usage = usageTracker.track(`generate:${mode}`, result.usage);

  return {
    text: result.text,
    usage: {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens
    }
  };
}

/**
 * Stream text completion with callback
 * @param {string} prompt - The prompt to send
 * @param {string} mode - Model mode
 * @param {Function} onChunk - Callback for each text chunk
 * @param {Object} options - Additional options
 * @returns {Promise<{text: string, usage: Object}>}
 */
export async function streamGenerate(prompt, mode = 'BALANCED', onChunk, options = {}) {
  const openrouter = createLLMProvider();
  const modelConfig = getModel(mode, options.overrides || []);

  const result = await streamText({
    model: openrouter(modelConfig.model),
    prompt,
    system: options.system,
    temperature: modelConfig.params.temperature,
    maxTokens: modelConfig.params.max_tokens
  });

  let fullText = '';

  for await (const chunk of result.textStream) {
    fullText += chunk;
    if (onChunk) {
      onChunk(chunk);
    }
  }

  // Get final usage
  const finalResult = await result;
  const usage = usageTracker.track(`stream:${mode}`, finalResult.usage);

  return {
    text: fullText,
    usage: {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens
    }
  };
}

/**
 * Generate with JSON output (parses response as JSON)
 * @param {string} prompt - The prompt (should request JSON output)
 * @param {string} mode - Model mode
 * @param {Object} options - Additional options
 * @returns {Promise<{data: Object, usage: Object}>}
 */
export async function generateJSON(prompt, mode = 'BALANCED', options = {}) {
  const result = await generate(prompt, mode, options);

  try {
    // Try to extract JSON from the response
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      return { data, usage: result.usage };
    }
    throw new Error('No valid JSON found in response');
  } catch (error) {
    throw new Error(`Failed to parse JSON response: ${error.message}\nRaw response: ${result.text}`);
  }
}

/**
 * Estimate token count for text (rough approximation)
 * ~4 characters per token for English text
 * @param {string} text - Text to estimate
 * @returns {number} Estimated token count
 */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Get usage report
 * @returns {Object} Usage statistics
 */
export function getUsageReport() {
  return usageTracker.getTotal();
}

/**
 * Reset usage tracking
 */
export function resetUsageTracking() {
  usageTracker.reset();
}
