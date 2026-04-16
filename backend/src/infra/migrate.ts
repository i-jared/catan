import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { Pool } from 'pg'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run migrations')
}

const currentDir = dirname(fileURLToPath(import.meta.url))
const schemaPath = resolve(currentDir, '../../sql/schema.sql')
const schema = await readFile(schemaPath, 'utf8')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

try {
  await pool.query(schema)
  process.stdout.write(`Applied schema from ${schemaPath}\n`)
} finally {
  await pool.end()
}
