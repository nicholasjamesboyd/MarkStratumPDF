import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const nodeFile = join(root, 'node_modules', 'pdfium-native', 'build', 'Release', 'pdfium.node')
const installer = join(root, 'node_modules', 'pdfium-native', 'scripts', 'install.mjs')

if (existsSync(nodeFile)) {
  process.exit(0)
}

if (!existsSync(installer)) {
  console.warn('pdfium-native is not installed yet; skipping binary download.')
  process.exit(0)
}

await import(pathToFileURL(installer).href)
