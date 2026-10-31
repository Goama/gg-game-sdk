# GG Game SDK

A JavaScript SDK for seamless communication between games and the Goama tournament platform through iframe messaging.

## Features

- 🎮 Easy integration with Goama tournament platform
- 📦 Works with ES5, ES6, CommonJS, and UMD
- 🔧 Full TypeScript support
- ⚡ Next.js compatible
- 🌐 Cross-browser compatibility (including IE11)
- 📱 Lightweight and performant

## Installation

```bash
npm install gg-game-sdk
```

## Quick Start

### ES6/TypeScript Import
```typescript
import ggSDK, { gameOver, saveGameData } from 'gg-game-sdk';

// Using default export
ggSDK.gameOver(1000);

// Using named exports
gameOver(1000);
saveGameData({ level: 5, coins: 100 });
```

### CommonJS (Node.js)
```javascript
const ggSDK = require('gg-game-sdk');

ggSDK.gameOver(1000);
ggSDK.saveGameData({ level: 5, coins: 100 });
```

### UMD (Browser Script Tag)

Pin an exact version. An unversioned URL picks up every new release the moment
it is published. For v2, this must be the **first script in `<head>`**, so the
seeded `Math.random` is in place before the game engine loads.

```html
<script src="https://unpkg.com/gg-game-sdk@1.3.0/dist/index.umd.js"></script>
<script>
  // All of these work:
  GGSDK.gameOver(1000);
  window.GGSDK.gameOver(1000);
  GGSDK.saveGameData({ level: 5, coins: 100 });
</script>
```

### Next.js Usage
```typescript
import { useEffect } from 'react';
import ggSDK from 'gg-game-sdk';

export default function GameComponent() {
  useEffect(() => {
    // Initialize game
    ggSDK.gameLoaded();
    
    // Listen for pause events
    ggSDK.listenPaused(() => {
      console.log('Game paused by parent');
      // Pause your game logic here
    });

    // Listen for resume events
    ggSDK.listenResumed(() => {
      console.log('Game resumed by parent');
      // Resume your game logic here
    });

    // Get saved game data
    ggSDK.getGameData({ level: 1, score: 0 }, (data) => {
      console.log('Loaded game data:', data);
      // Initialize game with loaded data
    });
  }, []);

  const handleGameOver = (finalScore: number) => {
    ggSDK.gameOver(finalScore);
  };

  const handleSaveProgress = (gameData: any) => {
    ggSDK.saveGameData(gameData);
  };

  return (
    <div>
      {/* Your game component */}
    </div>
  );
}
```

## API Reference

### Core Methods

#### `gameLoaded()`
Notify the platform that the game has finished loading.

```typescript
ggSDK.gameLoaded();
```

#### `gameOver(score: number)`
Send the final score when the game ends.

```typescript
ggSDK.gameOver(1500);
```

#### `saveGameData(data: object)`
Save game progress data.

```typescript
ggSDK.saveGameData({
  level: 3,
  score: 750,
  powerUps: ['shield', 'speed'],
  timestamp: Date.now()
});
```

#### `getGameData(defaultData: object, callback: function)`
Retrieve saved game data with fallback to default values.

```typescript
ggSDK.getGameData(
  { level: 1, score: 0 }, // default data
  (data) => {
    console.log('Game data:', data);
    // Initialize game with data
  }
);
```

### Game State Methods

#### `gamePaused()`
Notify the platform that the game was paused by the player.

```typescript
ggSDK.gamePaused();
```

#### `gameResumed()`  
Notify the platform that the game was resumed by the player.

```typescript
ggSDK.gameResumed();
```

### Event Listeners

#### `listenPaused(callback: function)`
Listen for pause events from the platform.

```typescript
ggSDK.listenPaused(() => {
  // Pause game logic
  pauseGameEngine();
  showPauseScreen();
});
```

#### `listenResumed(callback: function)`
Listen for resume events from the platform.

```typescript
ggSDK.listenResumed(() => {
  // Resume game logic
  resumeGameEngine();
  hidePauseScreen();
});
```

#### `listenQuit(callback: function)`
Listen for quit events from the platform.

```typescript
ggSDK.listenQuit(() => {
  // Clean up and save progress
  saveCurrentProgress();
  cleanupResources();
});
```

## v2: verified runs

v2 lets Goama check that a score came from a real play. It is off unless the
platform launches the game with v2 parameters, and every v1 method keeps its
signature and behaviour.

### Turning it on

The platform loads the game with:

```
index.html?gg_v=2&gg_session=<sessionId>&gg_seed=<uint32>&gg_origin=<url-encoded platform origin>
```

| Param | Meaning |
|---|---|
| `gg_v` | `2` turns v2 on |
| `gg_session` | Session id, 8 to 64 characters of `A-Z a-z 0-9 _ -` |
| `gg_seed` | Seed, a whole number from 0 to 4294967295 |
| `gg_origin` | Platform origin. The SDK posts only to it, and only accepts messages from the parent frame at it |
| `gg_capture` | Optional: `full` (default), `events` (no pointer moves or wheel), `off` |

If any required value is missing or invalid, the SDK stays in v1 mode. It also
stays in v1 if the browser lacks Pointer Events, `Math.imul`, `Promise`,
`Uint8Array` or `requestAnimationFrame`.

### What v2 does

- **Seeds randomness.** `Math.random` draws from `mulberry32(seed)`, and
  `random()` draws from a separate seeded stream.
- **Records an input diary.** Taps, clicks, moves (one per pointer per frame),
  key codes (never the characters typed), wheel, focus, visibility, resizes and
  pauses, with positions relative to the largest `<canvas>`. Text fields are
  skipped.
- **Sends run data with the game over.** `gameOver(score)` attaches the seed
  details, timing, frame times, the encoded diary and your events. Only the
  first game over per session is sent.
- **Reports a quit.** On `GG_QUIT_FROM_PARENT` before game over, it sends the
  game over with `endReason: "quit"` and the total of your `event()` values.
- **Handles play again.** `GG_NEW_SESSION { sessionId, seed }` from the parent
  starts a new session and reseeds without reloading the page.

### New methods

```typescript
ggSDK.version;                       // "2.0.0"
ggSDK.random();                      // seeded gameplay random in [0, 1); Math.random in v1
ggSDK.event('knife_hit', 1);         // a scoring event; values should add up to the score
ggSDK.event('game_over', 0, { cause: 'hit_knife' });
ggSDK.checkpoint(stateHash, score);  // optional state snapshot for replay checks
```

`event()` and `checkpoint()` do nothing in v1 mode, so games can call them
unconditionally.

### Input diary format

Each row is 8 integers: `dt` (ms since the previous row), `df` (frames since
the previous row), `type`, `x`, `y`, `pid`, `ptype`, `flags`.

- **Pointer positions** are relative to the canvas, from 0 to 10000. Values
  outside that range are off canvas.
- **Encoding:** the rows are flattened, each int is zigzagged, then written as
  an unsigned LEB128 varint. That is compressed with `deflate-raw` where
  `CompressionStream` exists, then base64-encoded. `inputs.enc` names the
  encoding used.

| type | Row | x | y | pid |
|---|---|---|---|---|
| 0-3 | pointer down / up / move / cancel | position | position | pointer 0-9 |
| 4 / 5 | key down / up | index into `inputs.keys` | 0 | 0 |
| 6 | wheel | deltaY, clamped ±10000 | 0 | 0 |
| 7 / 8 | blur / focus | 0 | 0 | 0 |
| 9 | viewport resize | width | height | 0 portrait, 1 landscape |
| 10 | canvas resize | width | height | 0 |
| 11 / 12 | page hidden / visible | 0 | 0 | 0 |
| 13 / 14 | pause / resume | 0 | 0 | 0 game, 1 platform |
| 15 | session reseeded by `GG_NEW_SESSION` | `Math.random` draws between the previous game over and the reseed | 0 | 0 |

**`ptype`:**

| Value | Meaning |
|---|---|
| 0 | mouse |
| 1 | touch |
| 2 | pen |
| 3 | none |

**`flags`:**

| Bit | Value | Meaning |
|---|---|---|
| 0 | 1 | trusted |
| 1 | 2 | primary |
| 2 | 4 | key repeat |
| 3 | 8 | button held |

**Contract file:** `fixtures/v2-contract.json` holds seeded streams, an encoded
diary and the rewarded-ad rounding cases. The server-side decoder is tested
against it. Regenerate it with `UPDATE_FIXTURES=1 npm test`.

## TypeScript Support

The SDK includes comprehensive TypeScript definitions:

```typescript
import ggSDK, { GameData, EventCallback } from 'gg-game-sdk';

interface MyGameData extends GameData {
  level: number;
  score: number;
  playerName: string;
}

const saveProgress = (data: MyGameData) => {
  ggSDK.saveGameData(data);
};

const handlePause: EventCallback = () => {
  // Type-safe pause handler
};
```

## Error Handling

The SDK includes built-in error handling and will log warnings when:
- Called outside of an iframe context
- Communication with parent frame fails

```typescript
// The SDK handles iframe detection automatically
ggSDK.gameOver(score); // Will log error if not in iframe
```

## Browser Compatibility

- ✅ Chrome (all versions)
- ✅ Firefox (all versions)  
- ✅ Safari (all versions)
- ✅ Edge (all versions)
- ✅ Internet Explorer 11+

## Multiple Access Methods

The SDK provides multiple ways to access it depending on your environment:

```javascript
// ES6 Module
import ggSDK from 'gg-game-sdk';
ggSDK.gameOver(100);

// CommonJS
const ggSDK = require('gg-game-sdk');
ggSDK.gameOver(100);

// Browser Global (UMD)
GGSDK.gameOver(100);
window.GGSDK.gameOver(100);

// Named exports
import { gameOver, saveGameData } from 'gg-game-sdk';
gameOver(100);
```

## Framework Compatibility

- ✅ React / Next.js
- ✅ Vue.js / Nuxt.js
- ✅ Angular
- ✅ Svelte / SvelteKit
- ✅ Vanilla JavaScript
- ✅ jQuery

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

For support and questions:
- Create an issue on [GitHub Issues](https://github.com/Goama/gg-game-sdk/issues)
- Check the [documentation](https://github.com/Goama/gg-game-sdk#readme)

---

Made with ❤️ for the gaming community