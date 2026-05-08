# AI-Driven Web Crawler

AI-driven intelligent web crawler with vision-based navigation using Playwright + Gemini multimodal LLM.

## Installation

```bash
cd scripts/ai-web-crawler
npm install
npx playwright install chromium
```

## Build

```bash
npm run build
```

## Configuration

Edit `config.yaml` or set environment variables:
- `LLM_API_KEY`: Gemini API key
- `LLM_BASE_URL`: API base URL
- `LLM_MODEL`: Model name (e.g., gemini-pro-vision)
- `BROWSER_PORT`: Browser debugging port (default: 9222)

## Usage

```bash
node dist/index.js --operation fetch_data --target "hotel reviews" --url "https://example.com"
```
