import { randomInt, randomUUID } from 'node:crypto'

export interface RandomSource {
  next(): number
}

export class DefaultRandomSource implements RandomSource {
  next(): number {
    return randomInt(0, 1_000_000) / 1_000_000
  }
}

export function nextInt(random: RandomSource, maxExclusive: number): number {
  if (maxExclusive <= 0) {
    throw new Error('maxExclusive must be positive')
  }
  return Math.floor(random.next() * maxExclusive)
}

export function shuffle<T>(random: RandomSource, values: readonly T[]): T[] {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = nextInt(random, index + 1)
    const current = result[index]
    result[index] = result[swapIndex] as T
    result[swapIndex] = current as T
  }
  return result
}

export function sample<T>(random: RandomSource, values: readonly T[]): T {
  return values[nextInt(random, values.length)] as T
}

export function makeId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`
}
