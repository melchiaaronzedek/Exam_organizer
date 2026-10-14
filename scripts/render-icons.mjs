// Rasterise public/icons/logo.svg into the PWA/favicon PNGs. Run locally: node scripts/render-icons.mjs
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
const svg = readFileSync(resolve('public/icons/logo.svg'), 'utf8')
const exe = process.env.CHROME_PATH
const browser = await chromium.launch(exe ? { executablePath: exe } : {})
const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 })
async function render(size, pad, out) {
  await page.setViewportSize({ width: size, height: size })
  const inner = Math.round(size * (1 - 2 * pad))
  await page.setContent(`<html><body style="margin:0;background:#0b0d12;display:grid;place-items:center;width:${size}px;height:${size}px"><div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body></html>`)
  await page.screenshot({ path: resolve('public/icons', out), clip: { x: 0, y: 0, width: size, height: size } })
  console.log('wrote', out)
}
await render(512, 0, 'icon-512.png')
await render(192, 0, 'icon-192.png')
await render(512, 0.12, 'icon-maskable-512.png')
await render(180, 0, 'apple-touch-icon.png')
await render(64, 0, 'favicon-64.png')
await browser.close()
