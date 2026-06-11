# Contributing

Thanks for your interest in the Pod Engine TypeScript SDK!

## This repository is generated

This repo is an **automatically-synced mirror**. The SDK is generated from the Pod Engine API's
OpenAPI specification in our internal monorepo, which is the source of truth. The published
`@podengine/sdk` npm package is released from here, but the source is synced automatically —
**direct commits to mirrored files are overwritten on the next sync.**

## How to help

- **Found a bug or have a feature request?** Please
  [open an issue](https://github.com/podengine/podcast-api-client-js/issues). This is the best way
  to reach us and we read every one.
- **Want to fix something in code?** Please open an issue describing the change first. Because the
  code here is generated and synced, we'll land the fix on our side so it survives regeneration —
  we'll credit you and follow up on the issue.
- **Spotted a wrong type or a missing endpoint?** That almost always comes from the OpenAPI spec —
  mention it in the issue and we'll correct it at the source.

## Running locally

```bash
bun install
bun run generate    # regenerate the typed client from openapi.json
bun run test
bun run build
```

Thanks for helping make the SDK better! 🎙️
