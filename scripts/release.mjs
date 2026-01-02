import fs from 'node:fs/promises'
import path from 'node:path'

const ROOT = process.cwd()
const RELEASE_DIR = path.join(ROOT, 'release')

async function exists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function main() {
  const frontendDist = path.join(ROOT, 'frontend', 'dist')
  if (!(await exists(frontendDist))) {
    throw new Error('frontend/dist not found. Run "pnpm run build" first.')
  }

  await fs.rm(RELEASE_DIR, { recursive: true, force: true })
  await fs.mkdir(RELEASE_DIR, { recursive: true })

  const copyPairs = [
    [path.join(ROOT, 'backend'), path.join(RELEASE_DIR, 'backend')],
    [path.join(ROOT, 'deploy'), path.join(RELEASE_DIR, 'deploy')],
    [path.join(ROOT, 'frontend', 'dist'), path.join(RELEASE_DIR, 'frontend', 'dist')],
    [path.join(ROOT, 'README.md'), path.join(RELEASE_DIR, 'README.md')],
    [path.join(ROOT, 'DEPLOY_NGINX.md'), path.join(RELEASE_DIR, 'DEPLOY_NGINX.md')],
  ]

  for (const [src, dst] of copyPairs) {
    if (!(await exists(src))) continue
    await fs.mkdir(path.dirname(dst), { recursive: true })
    const st = await fs.stat(src)
    if (st.isDirectory()) {
      await fs.cp(src, dst, { recursive: true })
    } else {
      await fs.copyFile(src, dst)
    }
  }

  // Do not copy .env by default (may contain secrets)
  // User can add it manually on the server.

  console.log('Release directory generated at:', RELEASE_DIR)
}

main().catch((err) => {
  console.error('[release] failed:', err?.message || err)
  process.exit(1)
})
