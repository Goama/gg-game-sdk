## Unreleased (v2.0.0)

### Added
- **v2 mode.** It turns on only with valid `gg_v=2`, `gg_session`, `gg_seed`
  and `gg_origin` launch params. It adds:
  - seeded `Math.random` and `random()`;
  - an input diary and v2 game over payload;
  - posting to the parent at the platform origin only, and accepting messages
    only from the parent at that origin;
  - `GG_NEW_SESSION` to reseed on play again;
  - quit reporting.
- **`version`, `random()`, `event()` and `checkpoint()`.** `event()` and
  `checkpoint()` are no-ops in v1.
- **`fixtures/v2-contract.json`**, the shared test data for the server-side
  decoder.

### Fixed
- **Listeners:** registering the same listener again now replaces the callback;
  previously the first one was kept.
- **`getGameData`:** every caller now gets the platform's reply; previously only
  the first did.
- **Named exports** (`import { gameOver } from 'gg-game-sdk'`) are bound to the
  SDK, so calling them on their own no longer throws.

### Unchanged
- Without v2 params, every message, target window and `"*"` origin is the same
  as 1.3.0.

## v1.3.0 - 2025-06-23

### Changes
- Version bump to v1.3.0

## v1.2.0 - 2025-06-23

### Changes
- Version bump to v1.2.0
