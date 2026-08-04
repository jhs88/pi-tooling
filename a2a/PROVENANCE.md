# A2A provenance

This directory contains a licensed selective adaptation informed by:

- Project: `DrOlu/pi-a2a-communication`
- Repository: <https://github.com/DrOlu/pi-a2a-communication>
- Pinned revision: [`497ec9fe22620ee51473854cf0d7001cfe409054`](https://github.com/DrOlu/pi-a2a-communication/tree/497ec9fe22620ee51473854cf0d7001cfe409054)
- Package release inspected: `1.0.1`
- Source license: MIT
- Source copyright: Copyright (c) 2026 pi-extensions
- Research date: 2026-08-04

## Adaptation boundary

The local implementation uses the upstream A2A server as a source reference but replaces its wire contract and execution boundary. It targets the A2A v1.0 messages emitted by Hermes and injects a local executor rather than retaining the upstream placeholder. Client orchestration, broadcast, chaining, OAuth, mTLS, load balancing, and unimplemented push/streaming claims are not imported in the first milestone.

The detailed source audit is in [`docs/research/pi-a2a-communication-compatibility.md`](../docs/research/pi-a2a-communication-compatibility.md).

## MIT notice

MIT License

Copyright (c) 2026 pi-extensions

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
