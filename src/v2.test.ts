/**
 * @jest-environment jsdom
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { mulberry32, gameplaySeed } from './v2/rng';
import { encodeInts, ENC_DEFLATE, ENC_PLAIN, toVarintBytes, toBase64, zz } from './v2/encode';
import { parseOrigin, parseV2Params } from './v2/params';
import { ROW, withoutMoves } from './v2/recorder';

const realRandom = Math.random;
const SEED = 2918374651;
const SESSION = 's_7Kp2xQ9mLr';
let originCounter = 0;
let rafQueue: Array<() => void> = [];

// ---- test harness ----

function nextOrigin(): string {
    // A fresh origin per test, so SDK copies loaded by earlier tests ignore this test's messages.
    originCounter++;
    return `https://goama-${originCounter}.test`;
}

function makeParent(): any {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const parent = frame.contentWindow as any;
    parent.postMessage = jest.fn();
    Object.defineProperty(window, 'parent', { configurable: true, writable: true, value: parent });
    return parent;
}

function addCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 100, width: 400, height: 800, right: 400, bottom: 900, x: 0, y: 100, toJSON: () => ({}) });
    document.body.appendChild(canvas);
    return canvas;
}

function frames(n: number): void {
    for (let i = 0; i < n; i++) {
        const queue = rafQueue;
        rafQueue = [];
        queue.forEach((cb) => cb());
    }
}

async function load(query: string): Promise<any> {
    window.history.replaceState({}, '', '/index.html' + query);
    jest.resetModules();
    return (await import('./index')).default;
}

function pointer(target: EventTarget, type: string, clientX: number, clientY: number, pointerId = 1): void {
    const e = new MouseEvent(type, { bubbles: true, clientX, clientY, buttons: type === 'pointerdown' ? 1 : 0 });
    Object.defineProperty(e, 'pointerId', { value: pointerId });
    Object.defineProperty(e, 'pointerType', { value: 'touch' });
    Object.defineProperty(e, 'isPrimary', { value: true });
    target.dispatchEvent(e);
}

function fromParent(parent: any, origin: string, data: any): void {
    window.dispatchEvent(new MessageEvent('message', { data, origin, source: parent }));
}

async function waitForGameOver(parent: any): Promise<any> {
    for (let i = 0; i < 200; i++) {
        const call = parent.postMessage.mock.calls.find((c: any[]) => c[0] && c[0].event_type === 'GG_GAME_OVER');
        if (call) return call;
        await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('no GG_GAME_OVER posted');
}

function decodeRows(enc: string, data: string): number[][] {
    let bytes = Buffer.from(data, 'base64');
    if (enc === ENC_DEFLATE) bytes = zlib.inflateRawSync(bytes);
    else expect(enc).toBe(ENC_PLAIN);
    const ints: number[] = [];
    let v = 0;
    let shift = 0;
    for (const b of bytes) {
        v |= (b & 127) << shift;
        if (b & 128) shift += 7;
        else { ints.push(((v >>> 1) ^ -(v & 1)) | 0); v = 0; shift = 0; }
    }
    const rows: number[][] = [];
    for (let i = 0; i < ints.length; i += 8) rows.push(ints.slice(i, i + 8));
    return rows;
}

const v2Query = (origin: string, extra = '') =>
    `?gg_v=2&gg_session=${SESSION}&gg_seed=${SEED}&gg_origin=${encodeURIComponent(origin)}${extra}`;

beforeEach(() => {
    (window as any).PointerEvent = function PointerEvent() { /* presence is all v2 checks */ };
    (window as any).requestAnimationFrame = (cb: () => void) => { rafQueue.push(cb); return rafQueue.length; };
    delete (window as any).CompressionStream;
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    Math.random = realRandom;
    rafQueue = [];
    document.body.innerHTML = '';
    jest.restoreAllMocks();
    window.history.replaceState({}, '', '/');
});

// ---- launch parameters ----

describe('gg_* params', () => {
    it('accepts a valid set', () => {
        expect(parseV2Params(v2Query('https://tele2.go-games.gg'))).toEqual({
            sessionId: SESSION, seed: SEED, origin: 'https://tele2.go-games.gg', capture: 'full',
        });
    });

    it.each([
        ['no gg_v', `?gg_session=${SESSION}&gg_seed=1&gg_origin=https%3A%2F%2Fa.test`],
        ['gg_v=1', `?gg_v=1&gg_session=${SESSION}&gg_seed=1&gg_origin=https%3A%2F%2Fa.test`],
        ['session too short', '?gg_v=2&gg_session=abc&gg_seed=1&gg_origin=https%3A%2F%2Fa.test'],
        ['session bad chars', '?gg_v=2&gg_session=abc%20defgh&gg_seed=1&gg_origin=https%3A%2F%2Fa.test'],
        ['seed above uint32', `?gg_v=2&gg_session=${SESSION}&gg_seed=4294967296&gg_origin=https%3A%2F%2Fa.test`],
        ['seed negative', `?gg_v=2&gg_session=${SESSION}&gg_seed=-1&gg_origin=https%3A%2F%2Fa.test`],
        ['origin with a path', `?gg_v=2&gg_session=${SESSION}&gg_seed=1&gg_origin=https%3A%2F%2Fa.test%2Fplay`],
        ['origin not http', `?gg_v=2&gg_session=${SESSION}&gg_seed=1&gg_origin=javascript%3Aalert(1)`],
        ['origin missing', `?gg_v=2&gg_session=${SESSION}&gg_seed=1`],
    ])('falls back to v1 when %s', (_name, query) => {
        expect(parseV2Params(query)).toBeNull();
    });

    it('normalises origins the way MessageEvent reports them', () => {
        expect(parseOrigin('HTTPS://Tele2.Go-Games.gg:443')).toBe('https://tele2.go-games.gg');
        expect(parseOrigin('http://localhost:8080')).toBe('http://localhost:8080');
    });
});

// ---- v1 stays v1 ----

describe('without valid v2 params', () => {
    it.each([['no params', ''], ['invalid seed', `?gg_v=2&gg_session=${SESSION}&gg_seed=x&gg_origin=https%3A%2F%2Fa.test`]])(
        'keeps Math.random and posts v1 messages (%s)', async (_name, query) => {
            const parent = makeParent();
            const sdk = await load(query);
            expect(Math.random).toBe(realRandom);
            sdk.gameOver(42);
            expect(parent.postMessage).toHaveBeenCalledWith({ event_type: 'GG_GAME_OVER', payload: { score: 42 } }, '*');
        });

    it('stays v1 in a browser without Pointer Events', async () => {
        delete (window as any).PointerEvent;
        const parent = makeParent();
        const sdk = await load(v2Query(nextOrigin()));
        expect(Math.random).toBe(realRandom);
        sdk.gameLoaded();
        expect(parent.postMessage).toHaveBeenCalledWith({ event_type: 'GG_GAME_LOAD_FINISHED' }, '*');
    });
});

// ---- v2 ----

describe('with valid v2 params', () => {
    it('seeds Math.random and ggSDK.random from the session seed', async () => {
        makeParent();
        const sdk = await load(v2Query(nextOrigin()));
        const math = mulberry32(SEED);
        const gameplay = mulberry32(gameplaySeed(SEED));
        expect([Math.random(), Math.random(), Math.random()]).toEqual([math(), math(), math()]);
        expect([sdk.random(), sdk.random()]).toEqual([gameplay(), gameplay()]);
    });

    it('posts to window.parent at gg_origin only, with the gg envelope', async () => {
        const origin = nextOrigin();
        const parent = makeParent();
        const sdk = await load(v2Query(origin));
        sdk.gameLoaded();
        sdk.saveGameData({ level: 2 });
        expect(parent.postMessage).toHaveBeenNthCalledWith(1, {
            event_type: 'GG_GAME_LOAD_FINISHED',
            payload: { sdkVersion: '2.0.0', v: 2, capture: 'full', seeded: true, rngAlgo: 'mulberry32' },
            gg: { v: 2, sessionId: SESSION, seq: 1, t: expect.any(Number) },
        }, origin);
        expect(parent.postMessage.mock.calls[1][0].gg.seq).toBe(2);
        expect(parent.postMessage.mock.calls[1][1]).toBe(origin);
    });

    it('records taps relative to the canvas and sends them in the game over', async () => {
        const origin = nextOrigin();
        const parent = makeParent();
        const sdk = await load(v2Query(origin));
        const canvas = addCanvas();
        frames(2);
        pointer(canvas, 'pointerdown', 200, 500);
        frames(1);
        pointer(canvas, 'pointermove', 220, 520);
        pointer(canvas, 'pointermove', 240, 540); // coalesced: only the last move this frame
        frames(1);
        pointer(canvas, 'pointerup', 240, 540);
        sdk.event('knife_hit', 1);
        sdk.event('apple', 2, { combo: true });
        sdk.gameOver(3);

        const [message, target] = await waitForGameOver(parent);
        expect(target).toBe(origin);
        const p = message.payload;
        expect(p).toMatchObject({ score: 3, v: 2, sdkVersion: '2.0.0', sessionId: SESSION, endReason: 'game_over', truncated: false });
        expect(p.rng.seeded).toBe(true);
        expect(p.events).toEqual([[expect.any(Number), 'knife_hit', 1], [expect.any(Number), 'apple', 2, { combo: true }]]);
        expect(p.stats).toEqual({ inputCount: 1, untrusted: 4, pointerTypes: ['touch'], keyCount: 0 });

        const rows = decodeRows(p.inputs.enc, p.inputs.data);
        expect(p.inputs.rows).toBe(rows.length);
        const typed = rows.map((r) => [r[2], r[3], r[4], r[5], r[6], r[7]]);
        // jsdom events are untrusted, so the trusted bit is 0: exactly what a script-driven tap looks like.
        expect(typed).toEqual([
            [ROW.POINTER_DOWN, 5000, 5000, 0, 1, 2 | 8],
            [ROW.POINTER_MOVE, 6000, 5500, 0, 1, 2],
            [ROW.POINTER_UP, 6000, 5500, 0, 1, 2],
        ]);
        expect(rows[1][1]).toBe(1); // the move landed one frame after the tap
    });

    it('compresses with deflate-raw when CompressionStream exists', async () => {
        (window as any).CompressionStream = require('stream/web').CompressionStream;
        const parent = makeParent();
        const sdk = await load(v2Query(nextOrigin()));
        const canvas = addCanvas();
        for (let i = 0; i < 50; i++) { pointer(canvas, 'pointerdown', 10 * i, 300); pointer(canvas, 'pointerup', 10 * i, 300); }
        sdk.gameOver(50);
        const [message] = await waitForGameOver(parent);
        expect(message.payload.inputs.enc).toBe(ENC_DEFLATE);
        expect(message.payload.timing.frameDt.enc).toBe(ENC_DEFLATE);
        const rows = decodeRows(message.payload.inputs.enc, message.payload.inputs.data);
        expect(rows).toHaveLength(100);
        expect(rows[98][3]).toBe(Math.round(490 / 400 * 10000));
    });

    it('records nothing from text fields', async () => {
        const parent = makeParent();
        const sdk = await load(v2Query(nextOrigin()));
        const input = document.createElement('input');
        document.body.appendChild(input);
        pointer(input, 'pointerdown', 1, 1);
        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'KeyA', key: 'a' }));
        sdk.gameOver(0);
        const [message] = await waitForGameOver(parent);
        expect(message.payload.inputs.rows).toBe(0);
    });

    it('records the key code, never the character', async () => {
        const parent = makeParent();
        const sdk = await load(v2Query(nextOrigin()));
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ' }));
        sdk.gameOver(0);
        const [message] = await waitForGameOver(parent);
        expect(message.payload.inputs.keys).toEqual(['Space']);
        const rows = decodeRows(message.payload.inputs.enc, message.payload.inputs.data);
        expect(rows.map((r) => [r[2], r[3]])).toEqual([[ROW.KEY_DOWN, 0], [ROW.KEY_UP, 0]]);
        expect(message.payload.stats.keyCount).toBe(1);
    });

    it('sends only the first game over per session', async () => {
        const parent = makeParent();
        const sdk = await load(v2Query(nextOrigin()));
        sdk.gameOver(10);
        sdk.gameOver(99);
        await waitForGameOver(parent);
        await new Promise((r) => setTimeout(r, 30));
        const overs = parent.postMessage.mock.calls.filter((c: any[]) => c[0].event_type === 'GG_GAME_OVER');
        expect(overs).toHaveLength(1);
        expect(overs[0][0].payload.score).toBe(10);
    });

    it('drops messages that are not from the parent at gg_origin', async () => {
        const origin = nextOrigin();
        const parent = makeParent();
        const sdk = await load(v2Query(origin));
        const callback = jest.fn();
        sdk.listenPaused(callback);

        fromParent(parent, 'https://evil.test', { event_type: 'GG_PAUSED_FROM_PARENT' });
        window.dispatchEvent(new MessageEvent('message', { data: { event_type: 'GG_PAUSED_FROM_PARENT' }, origin, source: window }));
        expect(callback).not.toHaveBeenCalled();

        fromParent(parent, origin, { event_type: 'GG_PAUSED_FROM_PARENT' });
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('reseeds on GG_NEW_SESSION and marks it in the next diary', async () => {
        const origin = nextOrigin();
        const parent = makeParent();
        const sdk = await load(v2Query(origin));
        sdk.gameOver(5);
        await waitForGameOver(parent);
        Math.random(); Math.random(); Math.random(); // the game restarting its round before the reseed lands

        const newSeed = 123456789;
        fromParent(parent, origin, { event_type: 'GG_NEW_SESSION', payload: { sessionId: 's_secondTry01', seed: newSeed } });
        const fresh = mulberry32(newSeed);
        expect([Math.random(), Math.random()]).toEqual([fresh(), fresh()]);

        parent.postMessage.mockClear();
        sdk.gameOver(7);
        const [message] = await waitForGameOver(parent);
        expect(message.payload.sessionId).toBe('s_secondTry01');
        expect(message.gg).toMatchObject({ sessionId: 's_secondTry01', seq: 1 });
        const rows = decodeRows(message.payload.inputs.enc, message.payload.inputs.data);
        expect(rows[0].slice(2)).toEqual([ROW.RESEED, 3, 0, 0, 3, 1]);
    });

    it('ignores a GG_NEW_SESSION with an invalid seed', async () => {
        const origin = nextOrigin();
        makeParent();
        const parent = window.parent as any;
        await load(v2Query(origin));
        fromParent(parent, origin, { event_type: 'GG_NEW_SESSION', payload: { sessionId: 's_secondTry01', seed: -5 } });
        const original = mulberry32(SEED);
        expect(Math.random()).toBe(original());
    });

    it('reports a quit before game over, with the score from events', async () => {
        const origin = nextOrigin();
        const parent = makeParent();
        const sdk = await load(v2Query(origin));
        const quit = jest.fn();
        sdk.listenQuit(quit);
        sdk.event('knife_hit', 1);
        sdk.event('knife_hit', 1);
        sdk.event('apple', 2);
        fromParent(parent, origin, { event_type: 'GG_QUIT_FROM_PARENT' });
        const [message] = await waitForGameOver(parent);
        expect(quit).toHaveBeenCalled();
        expect(message.payload).toMatchObject({ score: 4, endReason: 'quit' });
    });

    it('measures paused time from both sides', async () => {
        const origin = nextOrigin();
        const parent = makeParent();
        const sdk = await load(v2Query(origin));
        sdk.gamePaused();
        await new Promise((r) => setTimeout(r, 30));
        sdk.gameResumed();
        fromParent(parent, origin, { event_type: 'GG_PAUSED_FROM_PARENT' });
        fromParent(parent, origin, { event_type: 'GG_RESUMED_FROM_PARENT' });
        sdk.gameOver(1);
        const [message] = await waitForGameOver(parent);
        expect(message.payload.timing.pausedMs).toBeGreaterThanOrEqual(25);
        const rows = decodeRows(message.payload.inputs.enc, message.payload.inputs.data);
        expect(rows.map((r) => [r[2], r[5]])).toEqual([[ROW.PAUSE, 0], [ROW.RESUME, 0], [ROW.PAUSE, 1], [ROW.RESUME, 1]]);
    });
});

// ---- listener fix (applies to v1 too) ----

describe('listeners', () => {
    it('uses the latest callback when one is registered twice', async () => {
        makeParent();
        const sdk = await load('');
        const first = jest.fn();
        const second = jest.fn();
        sdk.listenPaused(first);
        sdk.listenPaused(second);
        window.dispatchEvent(new MessageEvent('message', { data: { event_type: 'GG_PAUSED_FROM_PARENT' } }));
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('answers every getGameData caller', async () => {
        makeParent();
        const sdk = await load('');
        const a = jest.fn();
        const b = jest.fn();
        sdk.getGameData({ level: 1 }, a);
        sdk.getGameData({ level: 1 }, b);
        window.dispatchEvent(new MessageEvent('message', { data: { event_type: 'GG_SET_GAME_DATA', payload: { gameData: { level: 9 } } } }));
        expect(a).toHaveBeenCalledWith({ level: 9 });
        expect(b).toHaveBeenCalledWith({ level: 9 });
    });
});

// ---- encoding units ----

describe('encoding', () => {
    it('drops moves but keeps total time when a run is too big', () => {
        const rows = [
            5, 1, ROW.POINTER_DOWN, 1, 1, 0, 1, 3,
            7, 1, ROW.POINTER_MOVE, 2, 2, 0, 1, 2,
            11, 2, ROW.POINTER_UP, 3, 3, 0, 1, 2,
        ];
        expect(withoutMoves(rows)).toEqual([
            5, 1, ROW.POINTER_DOWN, 1, 1, 0, 1, 3,
            18, 3, ROW.POINTER_UP, 3, 3, 0, 1, 2,
        ]);
    });

    it('zigzags negatives and large values', async () => {
        const ints = [0, -1, 1, -10000, 10000, 2147483647, -2147483648];
        const encoded = await encodeInts(ints, (s) => Buffer.from(s, 'binary').toString('base64'), undefined);
        expect(encoded.enc).toBe(ENC_PLAIN);
        const back = decodeRows(encoded.enc, encoded.data).flat();
        expect(back).toEqual(ints);
    });
});

// ---- the contract file the Python service tests against ----

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'v2-contract.json');

function buildContract(): any {
    const seeds = [0, 1, 42, 2918374651, 4294967295];
    const streams = seeds.map((seed) => {
        const math = mulberry32(seed);
        const gameplay = mulberry32(gameplaySeed(seed));
        return { seed, gameplaySeed: gameplaySeed(seed), math: Array.from({ length: 8 }, math), gameplay: Array.from({ length: 8 }, gameplay) };
    });

    const rows = [
        [0, 0, ROW.RESEED, 3, 0, 0, 3, 1],
        [1210, 72, ROW.POINTER_DOWN, 5000, 8300, 0, 1, 1 | 2 | 8],
        [16, 1, ROW.POINTER_MOVE, 5012, 8290, 0, 1, 1 | 2 | 8],
        [95, 6, ROW.POINTER_UP, 5012, 8290, 0, 1, 1 | 2],
        [400, 24, ROW.KEY_DOWN, 0, 0, 0, 3, 1],
        [80, 5, ROW.KEY_DOWN, 0, 0, 0, 3, 1 | 4],
        [3, 0, ROW.WHEEL, -10000, 0, 0, 0, 1],
        [20, 1, ROW.POINTER_DOWN, -250, 10400, 1, 0, 2], // off canvas, untrusted
        [1000, 60, ROW.VIEWPORT_RESIZE, 844, 390, 1, 3, 1],
        [5, 0, ROW.PAGE_HIDDEN, 0, 0, 0, 3, 1],
        [3100, 0, ROW.PAGE_VISIBLE, 0, 0, 0, 3, 1],
        [10, 1, ROW.PAUSE, 0, 0, 1, 3, 1],
        [2000, 120, ROW.RESUME, 0, 0, 1, 3, 1],
    ];
    const flat = rows.reduce((a: number[], r) => a.concat(r), []);
    const raw = toVarintBytes(flat);
    const btoaNode = (s: string) => Buffer.from(s, 'binary').toString('base64');

    const multipliers = [1.5, 2, 1.1, 1.25, 3, 0.5, 1.15];
    const raws = [0, 1, 3, 5, 7, 101, 333, 999, 12345, 999999];
    const rounding: any[] = [];
    multipliers.forEach((m) => raws.forEach((r) => rounding.push({ incrementScore: m, raw: r, expected: Math.round(m * r) })));

    return {
        about: 'Generated by gg-game-sdk src/v2.test.ts. The Python service must reproduce every value. Regenerate with UPDATE_FIXTURES=1 npm test.',
        sdkVersion: '2.0.0',
        fields: ['dt', 'df', 'type', 'x', 'y', 'pid', 'ptype', 'flags'],
        rowTypes: ROW,
        rng: streams,
        zigzag: [0, -1, 1, -2, 2, 2147483647, -2147483648].map((n) => ({ n, zz: zz(n) >>> 0 })),
        diary: {
            rows,
            plain: { enc: ENC_PLAIN, data: toBase64(raw, btoaNode) },
            deflate: { enc: ENC_DEFLATE, data: zlib.deflateRawSync(Buffer.from(raw)).toString('base64') },
        },
        rewardedAdRounding: rounding,
    };
}

describe('contract fixtures', () => {
    it('match the committed fixtures/v2-contract.json', () => {
        const contract = buildContract();
        if (process.env.UPDATE_FIXTURES) {
            fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
            fs.writeFileSync(FIXTURE, JSON.stringify(contract, null, 2) + '\n');
        }
        const committed = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
        expect(committed).toEqual(contract);
        // Both encodings decode to the same rows.
        expect(decodeRows(contract.diary.plain.enc, contract.diary.plain.data)).toEqual(contract.diary.rows);
        expect(decodeRows(contract.diary.deflate.enc, contract.diary.deflate.data)).toEqual(contract.diary.rows);
        expect(realRandom).toBeDefined();
    });
});
