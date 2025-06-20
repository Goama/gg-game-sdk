/**
 * Event types for Goama tournament platform communication
 */
export const EVENT_TYPES = {
    GG_GET_GAME_DATA: "GG_GET_GAME_DATA",
    GG_UPDATE_GAME_DATA: "GG_UPDATE_GAME_DATA",
    GG_SET_GAME_DATA: "GG_SET_GAME_DATA",
    GG_PAUSED_FROM_GAME: "GG_PAUSED_FROM_GAME",
    GG_PAUSED_FROM_PARENT: "GG_PAUSED_FROM_PARENT",
    GG_QUIT_FROM_PARENT: "GG_QUIT_FROM_PARENT",
    GG_GAME_OVER: "GG_GAME_OVER",
    GG_RESUMED_FROM_GAME: "GG_RESUMED_FROM_GAME",
    GG_RESUMED_FROM_PARENT: "GG_RESUMED_FROM_PARENT",
    GG_GAME_LOAD_FINISHED: "GG_GAME_LOAD_FINISHED",
} as const;

/**
 * Type definitions
 */
export interface GameData {
    [key: string]: any;
}

export interface GameOverPayload {
    score: number;
}

export interface GameDataPayload {
    gameData: GameData;
}

export interface UpdateDataPayload {
    data: GameData;
}

export interface MessageEvent {
    data: {
        event_type: string;
        payload?: any;
    };
}

export type EventCallback = () => void;
export type GameDataCallback = (data: GameData) => void;

/**
 * GG Game SDK Class
 */
export class GGSDK {
    private static instance: GGSDK;
    private registeredListeners: string[] = [];

    private constructor() {
        // Private constructor for singleton pattern
    }

    /**
     * Get singleton instance
     */
    public static getInstance(): GGSDK {
        if (!GGSDK.instance) {
            GGSDK.instance = new GGSDK();
        }
        return GGSDK.instance;
    }

    /**
     * Check if event listener is registered and add if not
     */
    private checkRegisteredListenersAndAdd(eventType: string, callback: (event: MessageEvent) => void): void {
        if (!this.registeredListeners.includes(eventType)) {
            window.addEventListener("message", callback);
            this.registeredListeners.push(eventType);
        }
    }

    /**
     * Register event listener
     */
    private registerListener(eventType: string, callback: EventCallback): void {
      if (!window.parent) {
        console.error("Functions should be called from inside an iframe");
        return;
      }
  
      const eventCallback = (e: MessageEvent) => {
        if (e.data.event_type === eventType) {
          callback();
        }
      };
  
      this.checkRegisteredListenersAndAdd(eventType, eventCallback);
    }

    /**
     * Get game data from parent with fallback to default
     */
    public getGameData(defaultData: GameData, callback: GameDataCallback): void {
        if (!window.parent) {
            console.error("Functions should be called from inside an iframe");
            return;
        }

        const timeout = setTimeout(() => {
            callback(defaultData);
        }, 3000);

              const eventCallback = (event: MessageEvent) => {
        if (event.data.event_type === EVENT_TYPES.GG_SET_GAME_DATA) {
          clearTimeout(timeout);
          callback(event.data.payload.gameData);
        }
      };

        this.checkRegisteredListenersAndAdd(EVENT_TYPES.GG_SET_GAME_DATA, eventCallback);

        window.parent.postMessage(
            {
                event_type: EVENT_TYPES.GG_GET_GAME_DATA,
                payload: { defaultData },
            },
            "*"
        );
    }

    /**
     * Save game data to parent
     */
    public saveGameData(data: GameData): void {
        if (!window.parent) {
            console.error("Functions should be called from inside an iframe");
            return;
        }

        window.parent.postMessage(
            {
                event_type: EVENT_TYPES.GG_UPDATE_GAME_DATA,
                payload: { data },
            },
            "*"
        );
    }

    /**
     * Send game over event with score
     */
    public gameOver(score: number): void {
        if (!window.parent) {
            console.error("Functions should be called from inside an iframe");
            return;
        }

        console.log("sending game over to Goama", score);
        window.parent.postMessage(
            {
                event_type: EVENT_TYPES.GG_GAME_OVER,
                payload: { score },
            },
            "*"
        );
    }

    /**
     * Notify parent that game is paused
     */
    public gamePaused(): void {
        if (!window.parent) {
            console.error("Functions should be called from inside an iframe");
            return;
        }

        window.parent.postMessage(
            {
                event_type: EVENT_TYPES.GG_PAUSED_FROM_GAME,
            },
            "*"
        );
    }

    /**
     * Notify parent that game is resumed
     */
    public gameResumed(): void {
        if (!window.parent) {
            console.error("Functions should be called from inside an iframe");
            return;
        }

        window.parent.postMessage(
            {
                event_type: EVENT_TYPES.GG_RESUMED_FROM_GAME,
            },
            "*"
        );
    }

    /**
     * Notify parent that game has finished loading
     */
    public gameLoaded(): void {
        if (!window.parent) {
            console.error("Functions should be called from inside an iframe");
            return;
        }

        window.parent.postMessage(
            {
                event_type: EVENT_TYPES.GG_GAME_LOAD_FINISHED,
            },
            "*"
        );
    }

    /**
     * Listen for pause events from parent
     */
    public listenPaused(callback: EventCallback): void {
        this.registerListener(EVENT_TYPES.GG_PAUSED_FROM_PARENT, callback);
    }

    /**
     * Listen for resume events from parent
     */
    public listenResumed(callback: EventCallback): void {
        this.registerListener(EVENT_TYPES.GG_RESUMED_FROM_PARENT, callback);
    }

    /**
     * Listen for quit events from parent
     */
    public listenQuit(callback: EventCallback): void {
        this.registerListener(EVENT_TYPES.GG_QUIT_FROM_PARENT, callback);
    }
}

// Create and export default instance
const ggSDK = GGSDK.getInstance();

// Make available on window object for browser environments
if (typeof window !== 'undefined') {
    (window as any).GGSDK = ggSDK;
}

// Export individual methods for convenience
export const {
    getGameData,
    saveGameData,
    gameOver,
    gamePaused,
    gameResumed,
    gameLoaded,
    listenPaused,
    listenResumed,
    listenQuit,
} = ggSDK;

// Default export
export default ggSDK;