import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'
import { loadEnv } from '../config/env.js'

export function getModel(): LanguageModel {
  const env = loadEnv()
  const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY })
  return openai(env.OPENAI_MODEL)
}
