/**
 * @jest-environment jsdom
 */

import { GGSDK, EVENT_TYPES } from './index';

describe('GGSDK', () => {
  let sdk: GGSDK;
  let mockPostMessage: jest.Mock;

  beforeEach(() => {
    // Mock window.parent
    Object.defineProperty(window, 'parent', {
      writable: true,
      value: {
        postMessage: jest.fn(),
      },
    });
    mockPostMessage = window.parent.postMessage as jest.Mock;
    
    // Get fresh SDK instance
    sdk = GGSDK.getInstance();
    
    // Clear console.error mock
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    // Clean up window.GGSDK
    delete (window as any).GGSDK;
  });

  describe('Singleton pattern', () => {
    it('should return the same instance', () => {
      const instance1 = GGSDK.getInstance();
      const instance2 = GGSDK.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('Window global access', () => {
    it('should be available on window.GGSDK in browser environment', async () => {
      jest.resetModules();
      // Re-import the module to trigger the window assignment side-effect.
      const { GGSDK: FreshGGSDK } = await import('./index');

      expect((window as any).GGSDK).toBeDefined();
      // The instance on the window should be the one from the re-imported module.
      expect((window as any).GGSDK).toBe(FreshGGSDK.getInstance());
    });
  });

  describe('gameOver', () => {
    it('should send game over message with score', () => {
      const score = 1500;
      sdk.gameOver(score);

      expect(mockPostMessage).toHaveBeenCalledWith(
        {
          event_type: EVENT_TYPES.GG_GAME_OVER,
          payload: { score },
        },
        '*'
      );
    });

    it('should log error when not in iframe', () => {
      Object.defineProperty(window, 'parent', {
        writable: true,
        value: null,
      });

      const consoleSpy = jest.spyOn(console, 'error');
      sdk.gameOver(100);

      expect(consoleSpy).toHaveBeenCalledWith(
        'Functions should be called from inside an iframe'
      );
    });
  });

  describe('saveGameData', () => {
    it('should send save data message', () => {
      const data = { level: 3, score: 750 };
      sdk.saveGameData(data);

      expect(mockPostMessage).toHaveBeenCalledWith(
        {
          event_type: EVENT_TYPES.GG_UPDATE_GAME_DATA,
          payload: { data },
        },
        '*'
      );
    });
  });

  describe('gameLoaded', () => {
    it('should send game loaded message', () => {
      sdk.gameLoaded();

      expect(mockPostMessage).toHaveBeenCalledWith(
        {
          event_type: EVENT_TYPES.GG_GAME_LOAD_FINISHED,
        },
        '*'
      );
    });
  });

  describe('gamePaused', () => {
    it('should send game paused message', () => {
      sdk.gamePaused();

      expect(mockPostMessage).toHaveBeenCalledWith(
        {
          event_type: EVENT_TYPES.GG_PAUSED_FROM_GAME,
        },
        '*'
      );
    });
  });

  describe('gameResumed', () => {
    it('should send game resumed message', () => {
      sdk.gameResumed();

      expect(mockPostMessage).toHaveBeenCalledWith(
        {
          event_type: EVENT_TYPES.GG_RESUMED_FROM_GAME,
        },
        '*'
      );
    });
  });

  describe('getGameData', () => {
    it('should request game data and call callback with response', (done) => {
      const defaultData = { level: 1 };
      const responseData = { level: 5, score: 1000 };

      sdk.getGameData(defaultData, (data) => {
        expect(data).toEqual(responseData);
        done();
      });

      expect(mockPostMessage).toHaveBeenCalledWith(
        {
          event_type: EVENT_TYPES.GG_GET_GAME_DATA,
          payload: { defaultData },
        },
        '*'
      );

      // Simulate response
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            event_type: EVENT_TYPES.GG_SET_GAME_DATA,
            payload: { gameData: responseData },
          },
        })
      );
    });

    it('should call callback with default data on timeout', (done) => {
      jest.useFakeTimers();
      const defaultData = { level: 1 };

      sdk.getGameData(defaultData, (data) => {
        expect(data).toEqual(defaultData);
        done();
      });

      jest.advanceTimersByTime(3000);
      jest.useRealTimers();
    });
  });

  describe('Event listeners', () => {
    it('should register pause listener', () => {
      const callback = jest.fn();
      sdk.listenPaused(callback);

      // Simulate pause event
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { event_type: EVENT_TYPES.GG_PAUSED_FROM_PARENT },
        })
      );

      expect(callback).toHaveBeenCalled();
    });

    it('should register resume listener', () => {
      const callback = jest.fn();
      sdk.listenResumed(callback);

      // Simulate resume event
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { event_type: EVENT_TYPES.GG_RESUMED_FROM_PARENT },
        })
      );

      expect(callback).toHaveBeenCalled();
    });

    it('should register quit listener', () => {
      const callback = jest.fn();
      sdk.listenQuit(callback);

      // Simulate quit event
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { event_type: EVENT_TYPES.GG_QUIT_FROM_PARENT },
        })
      );

      expect(callback).toHaveBeenCalled();
    });
  });
});