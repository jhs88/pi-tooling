# Integrate self-hosted Firecrawl

Type: task
Status: resolved
Blocked by: 10

## Question

Implement and verify locally maintained Firecrawl `search`, `scrape`, and `crawl` tools that require an explicit self-hosted endpoint, use process environment then ignored `agent/.env`, accept an optional API key, bound outputs, cancel failed crawl jobs, and never fall back to Firecrawl cloud.

## Answer

Implemented typed `search`, `scrape`, and `crawl` tools using Firecrawl SDK 4.30. Configuration resolves process environment before the ignored `agent/.env`, requires `FIRECRAWL_API_URL`, rejects the public cloud endpoint, and treats the key as optional. Outputs are bounded with full temporary artifacts, and interrupted crawl polling cancels the remote job.
