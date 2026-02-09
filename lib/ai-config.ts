export const AI_PROVIDER = 'runpod' as const
export const AI_EXECUTION_MODE = 'async-webhook' as const

export type AiProvider = typeof AI_PROVIDER
export type AiExecutionMode = typeof AI_EXECUTION_MODE
