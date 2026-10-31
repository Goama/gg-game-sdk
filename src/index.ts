import { createV2, EventData, SDK_VERSION, V2Runtime } from './v2/runtime';

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
    GG_CHECKPOINT: "GG_CHECKPOINT",
    GG_NEW_SESSION: "GG_NEW_SESSION",
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
 * v2 starts here, at module load and before any game code runs, so the seeded
 * Math.random is in place before the engine draws from it. Without valid gg_*
 * params this is null and everything below behaves exactly as v1.
 */
const v2: V2Runtime | null = typeof window !== 'undefined' ? createV2(window as any) : null;

/**
 * GG Game SDK Class
 */
export class GGSDK {
    private static instance: GGSDK;
    private listening = false;
    // One callback per event type; registering again replaces it (v1 kept the first).
    private callbacks: { [eventType: string]: EventCallback } = {};
    private pendingGameData: { callback: GameDataCallback; timeout: ReturnType<typeof setTimeout> }[] = [];

    readonly version: string = SDK_VERSION;

    private constructor() {
        // Private constructor for singleton pattern
    }

    /**
 * Get the target window for communication
 */
    private getTargetWindow(): Window | null {
        // Try window.top first (works in your case)
        try {
            if (window.top && window.top !== window) {
                return window.top;
            }
        } catch (e) {
            console.warn("window.top access failed:", (e as Error).message);
        }

        // Fallback to window.parent
        try {
            if (window.parent && window.parent !== window) {
                return window.parent;
            }
        } catch (e) {
            console.warn("window.parent access failed:", (e as Error).message);
        }

        return null;
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
     * Post a message to the platform. v1: window.top or window.parent, origin "*".
     * v2: window.parent, gg_origin only, with the gg envelope.
     */
    private send(message: { event_type: string; payload?: any }): void {
        if (v2) {
            v2.send(message);
            return;
        }

        const targetWindow = this.getTargetWindow();
        if (!targetWindow) {
            console.error("Functions should be called from inside an iframe");
            return;
        }

        targetWindow.postMessage(message, "*");
    }

    /**
     * One message listener for every event type. In v2 it drops anything not
     * sent by the parent frame at gg_origin.
     */
    private ensureListening(): void {
        if (this.listening) return;
        this.listening = true;
        const self = this;
        window.addEventListener("message", function (event: any) {
            if (v2 && !v2.accepts(event)) return;
            const data = event.data;
            if (!data || typeof data !== "object") return;
            self.handleMessage(data);
        });
    }

    private handleMessage(data: { event_type: string; payload?: any }): void {
        if (v2 && v2.handleParentMessage(data)) return;

        if (data.event_type === EVENT_TYPES.GG_SET_GAME_DATA) {
            const pending = this.pendingGameData;
            this.pendingGameData = [];
            const gameData = data.payload ? data.payload.gameData : undefined;
            for (let i = 0; i < pending.length; i++) {
                clearTimeout(pending[i].timeout);
                pending[i].callback(gameData);
            }
            return;
        }

        const callback = this.callbacks[data.event_type];
        if (callback) callback();

        // A quit before game over still reports the run, with the score so far.
        if (v2 && data.event_type === EVENT_TYPES.GG_QUIT_FROM_PARENT && !v2.ended) {
            v2.gameOver(v2.quitScore(), 'quit');
        }
    }

    /**
     * Register event listener
     */
    private registerListener(eventType: string, callback: EventCallback): void {
        if (!v2) {
            const targetWindow = this.getTargetWindow();
            if (!targetWindow) {
                console.error("Functions should be called from inside an iframe");
                return;
            }
        }

        this.callbacks[eventType] = callback;
        this.ensureListening();
    }

    /**
     * Get game data from parent with fallback to default
     */
    public getGameData(defaultData: GameData, callback: GameDataCallback): void {
        if (!v2) {
            const targetWindow = this.getTargetWindow();
            if (!targetWindow) {
                console.error("Functions should be called from inside an iframe");
                return;
            }
        }

        // Each call gets its own timeout and its own answer (v1 answered only the first caller).
        const entry = {
            callback,
            timeout: setTimeout(() => {
                const index = this.pendingGameData.indexOf(entry);
                if (index < 0) return; // already answered
                this.pendingGameData.splice(index, 1);
                callback(defaultData);
            }, 3000),
        };
        this.pendingGameData.push(entry);
        this.ensureListening();

        this.send({
            event_type: EVENT_TYPES.GG_GET_GAME_DATA,
            payload: { defaultData },
        });
    }

    /**
     * Save game data to parent
     */
    public saveGameData(data: GameData): void {
        this.send({
            event_type: EVENT_TYPES.GG_UPDATE_GAME_DATA,
            payload: { data },
        });
    }

    /**
     * Send game over event with score
     */
    public gameOver(score: number): void {
        if (!v2) {
            const targetWindow = this.getTargetWindow();
            if (!targetWindow) {
                console.error("Functions should be called from inside an iframe");
                return;
            }
        }

        console.log("sending game over to Goama", score);
        if (v2) {
            v2.gameOver(score, 'game_over');
            return;
        }
        this.send({
            event_type: EVENT_TYPES.GG_GAME_OVER,
            payload: { score },
        });
    }

    /**
     * Notify parent that game is paused
     */
    public gamePaused(): void {
        if (v2) v2.pause(0);
        this.send({
            event_type: EVENT_TYPES.GG_PAUSED_FROM_GAME,
        });
    }

    /**
     * Notify parent that game is resumed
     */
    public gameResumed(): void {
        if (v2) v2.resume(0);
        this.send({
            event_type: EVENT_TYPES.GG_RESUMED_FROM_GAME,
        });
    }

    /**
     * Notify parent that game has finished loading
     */
    public gameLoaded(): void {
        if (v2) {
            this.ensureListening();
            this.send({
                event_type: EVENT_TYPES.GG_GAME_LOAD_FINISHED,
                payload: v2.loaded(),
            });
            return;
        }
        this.send({
            event_type: EVENT_TYPES.GG_GAME_LOAD_FINISHED,
        });
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

    /**
     * Gameplay random number in [0, 1). Seeded in v2 mode, Math.random otherwise.
     */
    public random(): number {
        return v2 ? v2.random() : Math.random();
    }

    /**
     * Record a scoring or game event, e.g. event("knife_hit", 1). No-op in v1.
     */
    public event(name: string, value: number, data?: EventData): void {
        if (v2) v2.event(name, value, data);
    }

    /**
     * Record a game state checkpoint for replay checks. No-op in v1.
     */
    public checkpoint(stateHash: string, score?: number): void {
        if (v2) v2.checkpoint(stateHash, score);
    }
}

// Create and export default instance
const ggSDK = GGSDK.getInstance();

// v2 listens from the start, so GG_NEW_SESSION and quit work even if the game never registers a listener.
if (v2) (ggSDK as any).ensureListening();

// Make available on window object for browser environments
if (typeof window !== 'undefined') {
    (window as any).GGSDK = ggSDK;
}

// Export individual methods for convenience, bound so they work when called on their own
export const getGameData = ggSDK.getGameData.bind(ggSDK);
export const saveGameData = ggSDK.saveGameData.bind(ggSDK);
export const gameOver = ggSDK.gameOver.bind(ggSDK);
export const gamePaused = ggSDK.gamePaused.bind(ggSDK);
export const gameResumed = ggSDK.gameResumed.bind(ggSDK);
export const gameLoaded = ggSDK.gameLoaded.bind(ggSDK);
export const listenPaused = ggSDK.listenPaused.bind(ggSDK);
export const listenResumed = ggSDK.listenResumed.bind(ggSDK);
export const listenQuit = ggSDK.listenQuit.bind(ggSDK);
export const random = ggSDK.random.bind(ggSDK);
export const event = ggSDK.event.bind(ggSDK);
export const checkpoint = ggSDK.checkpoint.bind(ggSDK);

// Default export
export default ggSDK;
