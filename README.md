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
```html
<script src="https://unpkg.com/gg-game-sdk/dist/index.umd.js"></script>
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