/**
 * SDK v2: seeded randomness, the input diary and the v2 game over payload.
 *
 * Created at module load, before the game engine runs, so Math.random is
 * replaced before anything draws from it. Without valid gg_* params, or in a
 * browser missing what v2 needs, nothing here runs and the SDK is plain v1.
 */

import { encodeInts, Encoded } from './encode';
import { CaptureMode, parseSessionId, parseSeed, parseV2Params, V2Params } from './params';
import { FIELDS, FLAG, LOAD, PTYPE, Recorder, ROW, withoutMoves } from './recorder';
import { gameplaySeed, mulberry32 } from './rng';

export const SDK_VERSION = '2.0.0';
// A round's recording grows about 20 KB a minute with steady play (614 KB at 30 minutes, tools/game-migration/payload_size.py in
// fraud-check-service): an hour fits. Past this, pointer moves go first, and the run can't be replayed.
export const MAX_PAYLOAD_CHARS = 2 * 1024 * 1024;
const MAX_EVENTS = 5000;
const MAX_CHECKPOINTS = 1000;
const MAX_FRAMES = 216000; // an hour at 60 fps (half that at 120)
const MAX_CRYPTO_INTS = 50000;
// Clock reads: Boat Rush reads performance.now about 3 times a frame; 8 a frame on average over a full round.
const MAX_NOW_READS = MAX_FRAMES * 8;
/** In timing.frameNow: the game didn't read performance.now in that frame. */
export const NOT_READ = -2147483648;
// crypto.getRandomValues array types, as the crypto record numbers them.
const ARRAY_TYPES = ['Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array'];

/** A file's key in timing.loadKey: FNV-1a over its URL's UTF-16 code units (fragment dropped), as a signed 32-bit int. */
export function urlKey(url: string): number {
    const hash = url.indexOf('#');
    const s = hash >= 0 ? url.slice(0, hash) : url;
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h | 0;
}

const F32 = new Float32Array(1);
const F32_BITS = new Int32Array(F32.buffer);
/** A coordinate as the bits of the float32 nearest it: exact for the values browsers produce. */
export function float32Bits(v: any): number {
    F32[0] = typeof v === 'number' && isFinite(v) ? v : 0;
    return F32_BITS[0];
}

/** Values a clock gave the game, and per frame how many it gave since the frame before. */
class ReadLog {
    values: number[] = [];
    counts: number[] = [];
    truncated = false;
    private sinceTick = 0;

    constructor(private max: number) {}

    note(v: number): void {
        if (this.truncated) return;
        if (this.values.length >= this.max) {
            this.truncated = true;
            return;
        }
        this.values.push(v);
        this.sinceTick++;
    }

    tick(): void {
        this.counts.push(this.sinceTick);
        this.sinceTick = 0;
    }
}

export type EndReason = 'game_over' | 'quit' | 'timeout';
export type EventData = { [key: string]: string | number | boolean };
type AnyWindow = Window & { [key: string]: any };

export function v2Supported(win: AnyWindow): boolean {
    return typeof Math.imul === 'function'
        && typeof Promise === 'function'
        && typeof Uint8Array === 'function'
        && typeof win.PointerEvent === 'function'
        && typeof win.requestAnimationFrame === 'function'
        && typeof win.btoa === 'function'
        && !!win.performance && typeof win.performance.now === 'function';
}

function isEditable(target: any): boolean {
    if (!target || !target.tagName) return false;
    const tag = String(target.tagName).toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target.isContentEditable;
}

function copyWith(message: { [key: string]: any }, key: string, value: any): { [key: string]: any } {
    const out: { [key: string]: any } = {};
    for (const k in message) {
        if (Object.prototype.hasOwnProperty.call(message, k)) out[k] = message[k];
    }
    out[key] = value;
    return out;
}

export class V2Runtime {
    readonly origin: string;
    readonly capture: CaptureMode;

    sessionId = '';
    ended = false;

    private now: () => number;
    private readonly sdkStart: number;
    private sessionStart = 0;
    private recorder!: Recorder;
    private seq = 0;
    private frames = 0;
    private sessionFrame = 0;
    private lastFrameT = 0;
    private frameDts: number[] = [];
    // Each frame's time as the browser gives it to requestAnimationFrame callbacks, in µs: the first
    // against the session's start, the rest against the frame before. The game sees these, not our tick.
    private frameTimes: number[] = [];
    private lastFrameUs: number | null = null;
    // Per frame, when the game first read performance.now after the frame began, in µs after the frame's
    // time; NOT_READ when it didn't. Engines that time their tick with performance.now see this, not the frame time.
    private frameNows: number[] = [];
    private frameStartUs: number | null = null;
    private nowPending = false;
    // Per frame, how many timer callbacks (setTimeout, setInterval) ran since the frame before: a replay runs
    // that many before the frame, so a timer that came due during a long frame lands after it, as it did.
    private frameTimers: number[] = [];
    private timersSinceTick = 0;
    // When each of those timer callbacks ran, in µs after the frame before it (or the session's start): a
    // timer reads the clock between frames, which a replay gives it from here.
    private timerTimes: number[] = [];
    private timerTimesTruncated = false;
    // When each LOAD row's load landed, in µs after the frame before it: the clock its callback reads.
    private loadTimes: number[] = [];
    // Which file each LOAD row's load was (urlKey of its URL; 0 when it has none, as a decode), so a
    // replay lands the same file, not just the next of its kind.
    private loadKeys: number[] = [];
    // Every performance.now the game read, in µs after the frame before it, and per frame how many it read
    // since the frame before: a replay hands the same values back in the same order.
    // Per input row (pointer, key, wheel), in row order: the event's timeStamp in µs after the frame before it,
    // and its clientX and clientY as float32 bits (0 for keys and wheel): what the game saw, exactly.
    private inputExact: number[] = [];
    private inputExactMove: boolean[] = [];
    private nowReads: number[] = [];
    private frameReads: number[] = [];
    private readsSinceTick = 0;
    private nowReadsTruncated = false;
    // Every Date.now and new Date() the game read (ms after dateStartMs), and every AudioContext.currentTime
    // (in sample frames at audioRate), with per-frame counts as for performance.now.
    private dateReads = new ReadLog(MAX_NOW_READS);
    private dateStartMs = 0;
    private audioReads = new ReadLog(MAX_NOW_READS);
    private audioRate = 0;
    // What crypto.getRandomValues and randomUUID returned, in order, so a replay can hand the same back.
    private cryptoInts: number[] = [];
    private cryptoCalls = 0;
    private cryptoTruncated = false;
    private pendingLoads = 0;
    private events: any[] = [];
    private checkpoints: any[] = [];
    private eventTotal = 0;
    private loadMs: number | null = null;
    private firstInputMs: number | null = null;
    private pausedAt: number | null = null;
    private pausedMs = 0;
    private hiddenAt: number | null = null;
    private hiddenMs = 0;
    private focusLosses = 0;
    private inputCount = 0;
    private keyCount = 0;
    private untrusted = 0;
    private pointerTypes: string[] = [];
    private rngCalls = 0;
    private gameplayCalls = 0;
    private drawsSinceGameOver = 0;
    private mathRng!: () => number;
    private gameplayRng!: () => number;
    private pidMap: { [pointerId: string]: number } = {};
    private nextPid = 0;
    private pendingMoves: { [pid: string]: any[] } = {};
    private canvas: any = null;
    private canvasW = 0;
    private canvasH = 0;
    private realDateNow: () => number;

    constructor(private win: AnyWindow, params: V2Params) {
        this.origin = params.origin;
        this.capture = params.capture;
        // Taken now, so a later patch of performance.now (a speed hack) can't touch our clock.
        const perf = win.performance;
        const perfNow = perf.now;
        this.now = function () { return perfNow.call(perf); };
        const RealDate = win.Date, dateNow = RealDate.now;
        this.realDateNow = function () { return dateNow.call(RealDate); };
        this.sdkStart = this.now();
        this.startSession(params.sessionId, params.seed, false);
        this.replaceMathRandom();
        this.listen();
        this.watchLoads();
        this.recordCrypto();
        this.watchClock(perf, perfNow);
        this.watchDate();
        this.watchAudioClock();
        this.watchTimers();
        this.lastFrameT = this.now();
        const self = this;
        win.requestAnimationFrame(function tick(ts?: number) {
            self.onFrame(ts);
            win.requestAnimationFrame(tick);
        });
    }

    // ---- sessions and randomness ----

    private startSession(sessionId: string, seed: number, reseed: boolean): void {
        const t = this.now();
        const oldDraws = this.drawsSinceGameOver;
        this.sessionId = sessionId;
        this.sessionStart = t;
        this.recorder = new Recorder(t);
        this.seq = 0;
        this.sessionFrame = this.frames;
        this.frameDts = [];
        this.frameTimes = [];
        this.lastFrameUs = null;
        this.frameNows = [];
        this.frameStartUs = null;
        this.nowPending = false;
        this.frameTimers = [];
        this.timersSinceTick = 0;
        this.timerTimes = [];
        this.timerTimesTruncated = false;
        this.loadTimes = [];
        this.loadKeys = [];
        this.inputExact = [];
        this.inputExactMove = [];
        this.nowReads = [];
        this.frameReads = [];
        this.readsSinceTick = 0;
        this.nowReadsTruncated = false;
        this.dateReads = new ReadLog(MAX_NOW_READS);
        this.dateStartMs = this.realDateNow();
        this.audioReads = new ReadLog(MAX_NOW_READS);
        this.cryptoInts = [];
        this.cryptoCalls = 0;
        this.cryptoTruncated = false;
        this.events = [];
        this.checkpoints = [];
        this.eventTotal = 0;
        this.firstInputMs = null;
        this.pausedAt = null;
        this.pausedMs = 0;
        this.hiddenAt = this.win.document && this.win.document.hidden ? t : null;
        this.hiddenMs = 0;
        this.focusLosses = 0;
        this.inputCount = 0;
        this.keyCount = 0;
        this.untrusted = 0;
        this.pointerTypes = [];
        this.rngCalls = 0;
        this.gameplayCalls = 0;
        this.drawsSinceGameOver = 0;
        this.pendingMoves = {};
        this.mathRng = mulberry32(seed);
        this.gameplayRng = mulberry32(gameplaySeed(seed));
        this.ended = false;
        if (reseed) this.addRow(ROW.RESEED, oldDraws, 0, 0, PTYPE.none, FLAG.TRUSTED);
    }

    private replaceMathRandom(): void {
        const self = this;
        Math.random = function () {
            self.rngCalls++;
            self.drawsSinceGameOver++;
            return self.mathRng();
        };
    }

    random(): number {
        this.gameplayCalls++;
        return this.gameplayRng();
    }

    // ---- messages ----

    /** Every outgoing message, v2 style: the gg envelope, to the parent, to gg_origin only. */
    send(message: { [key: string]: any }): void {
        const parent = this.win.parent;
        if (!parent || parent === this.win) {
            console.error('Functions should be called from inside an iframe');
            return;
        }
        const gg = { v: 2, sessionId: this.sessionId, seq: ++this.seq, t: this.elapsed() };
        parent.postMessage(copyWith(message, 'gg', gg), this.origin);
    }

    /** Only messages from the parent frame at gg_origin count. Anything else is dropped. */
    accepts(e: MessageEvent): boolean {
        return e.origin === this.origin && e.source === this.win.parent;
    }

    /** Handles the v2-only parent messages. Returns true when the message was one of them. */
    handleParentMessage(data: any): boolean {
        if (data.event_type === 'GG_NEW_SESSION') {
            const payload = data.payload || {};
            const sessionId = parseSessionId(typeof payload.sessionId === 'string' ? payload.sessionId : null);
            const seed = parseSeed(payload.seed === undefined || payload.seed === null ? null : String(payload.seed));
            if (sessionId !== null && seed !== null) this.startSession(sessionId, seed, true);
            return true;
        }
        if (data.event_type === 'GG_PAUSED_FROM_PARENT') this.pause(1);
        if (data.event_type === 'GG_RESUMED_FROM_PARENT') this.resume(1);
        return false;
    }

    loaded(): { [key: string]: any } {
        if (this.loadMs === null) this.loadMs = Math.round(this.now() - this.sdkStart);
        return { sdkVersion: SDK_VERSION, v: 2, capture: this.capture, seeded: true, rngAlgo: 'mulberry32' };
    }

    pause(by: number): void {
        if (this.pausedAt === null) this.pausedAt = this.now();
        this.addRow(ROW.PAUSE, 0, 0, by, PTYPE.none, FLAG.TRUSTED);
    }

    resume(by: number): void {
        if (this.pausedAt !== null) {
            this.pausedMs += this.now() - this.pausedAt;
            this.pausedAt = null;
        }
        this.addRow(ROW.RESUME, 0, 0, by, PTYPE.none, FLAG.TRUSTED);
    }

    event(name: string, value: number, data?: EventData): void {
        if (this.ended || typeof name !== 'string' || !name || name.length > 64) return;
        if (typeof value !== 'number' || !isFinite(value)) return;
        this.eventTotal += value;
        if (this.events.length >= MAX_EVENTS) return;
        const t = this.elapsed();
        this.events.push(data ? [t, name, value, data] : [t, name, value]);
    }

    checkpoint(stateHash: string, score?: number): void {
        if (this.ended || typeof stateHash !== 'string' || this.checkpoints.length >= MAX_CHECKPOINTS) return;
        const point: { [key: string]: any } = { frame: this.frames - this.sessionFrame, t: this.elapsed(), stateHash: stateHash };
        if (typeof score === 'number' && isFinite(score)) point.score = score;
        this.checkpoints.push(point);
        this.send({ event_type: 'GG_CHECKPOINT', payload: point });
    }

    /** Last known score from event() totals, for a quit before game over. */
    quitScore(): number {
        return Math.max(0, Math.floor(this.eventTotal));
    }

    /**
     * Builds and posts the v2 GG_GAME_OVER. Only the first per session is sent:
     * some games call gameOver again on quit, and a second report for the same
     * session reads as a replayed run.
     */
    gameOver(score: number, endReason: EndReason): Promise<void> {
        if (this.ended) {
            console.warn('gg-game-sdk: game over already sent for this session');
            return Promise.resolve();
        }
        this.ended = true;
        this.flushMoves();
        this.drawsSinceGameOver = 0;

        const durationMs = this.elapsed();
        const t = this.now();
        const pausedMs = this.pausedMs + (this.pausedAt !== null ? t - this.pausedAt : 0);
        const hiddenMs = this.hiddenMs + (this.hiddenAt !== null ? t - this.hiddenAt : 0);
        const frames = this.frames - this.sessionFrame;
        const btoaFn = this.win.btoa.bind(this.win);
        const CS = this.win.CompressionStream;
        const self = this;
        this.closeFrameNow();
        const rows = this.recorder.rows;
        const rowCount = this.recorder.count;
        const keys = this.recorder.keys.slice();
        const exact = this.inputExact.slice();
        const moveFlags = this.inputExactMove.slice();
        let truncated = this.recorder.truncated;

        // Every int stream, encoded once; the inputs and their exact values again if moves have to go.
        const streams: { [name: string]: number[] } = {
            frameDt: this.frameDts, frameTime: this.frameTimes, frameNow: this.frameNows, frameTimers: this.frameTimers,
            crypto: this.cryptoInts, timerTime: this.timerTimes, loadTime: this.loadTimes, loadKey: this.loadKeys,
            nowRead: this.nowReads, frameReads: this.frameReads,
            dateRead: this.dateReads.values.slice(), frameDateReads: this.dateReads.counts.slice(),
            audioRead: this.audioReads.values.slice(), frameAudioReads: this.audioReads.counts.slice(),
        };
        const names = Object.keys(streams);

        const build = function (inputs: Encoded, exactEnc: Encoded, inputRows: number, e: { [name: string]: Encoded }): { [key: string]: any } {
            return {
                score: score,
                v: 2,
                sdkVersion: SDK_VERSION,
                sessionId: self.sessionId,
                endReason: endReason,
                rng: {
                    seeded: true, algo: 'mulberry32', calls: self.rngCalls, gameplayCalls: self.gameplayCalls,
                    // Not seeded: recorded, so a replay can return the same values.
                    crypto: { enc: e.crypto.enc, calls: self.cryptoCalls, truncated: self.cryptoTruncated, data: e.crypto.data },
                },
                timing: {
                    loadMs: self.loadMs,
                    // The session's start on the page's clock, in µs: the base the µs streams below add up from,
                    // so a replay hands back the very values the game read.
                    startUs: Math.round(self.sessionStart * 1000),
                    firstInputMs: self.firstInputMs,
                    durationMs: durationMs,
                    activeMs: Math.max(0, Math.round(durationMs - pausedMs - hiddenMs)),
                    pausedMs: Math.round(pausedMs),
                    hiddenMs: Math.round(hiddenMs),
                    focusLosses: self.focusLosses,
                    frames: frames,
                    fpsMean: durationMs > 0 ? Math.round(frames / (durationMs / 1000) * 10) / 10 : 0,
                    frameDt: { enc: e.frameDt.enc, unit: '0.1ms', data: e.frameDt.data },
                    frameTime: { enc: e.frameTime.enc, unit: '1us', data: e.frameTime.data },
                    frameNow: { enc: e.frameNow.enc, unit: '1us', data: e.frameNow.data },
                    frameTimers: { enc: e.frameTimers.enc, data: e.frameTimers.data },
                    timerTime: { enc: e.timerTime.enc, unit: '1us', truncated: self.timerTimesTruncated, data: e.timerTime.data },
                    loadTime: { enc: e.loadTime.enc, unit: '1us', data: e.loadTime.data },
                    loadKey: { enc: e.loadKey.enc, hash: 'fnv1a32', data: e.loadKey.data },
                    nowRead: { enc: e.nowRead.enc, unit: '1us', truncated: self.nowReadsTruncated, data: e.nowRead.data },
                    frameReads: { enc: e.frameReads.enc, data: e.frameReads.data },
                    // Date.now and new Date(): ms after dateStartMs; the audio clock: sample frames at audioRate.
                    dateStartMs: self.dateStartMs,
                    dateRead: { enc: e.dateRead.enc, unit: '1ms', truncated: self.dateReads.truncated, data: e.dateRead.data },
                    frameDateReads: { enc: e.frameDateReads.enc, data: e.frameDateReads.data },
                    audioRead: {
                        enc: e.audioRead.enc, unit: 'sampleFrame', rate: self.audioRate, truncated: self.audioReads.truncated,
                        data: e.audioRead.data,
                    },
                    frameAudioReads: { enc: e.frameAudioReads.enc, data: e.frameAudioReads.data },
                },
                screen: self.screenInfo(),
                inputs: {
                    fields: FIELDS, enc: inputs.enc, rows: inputRows, keys: keys, data: inputs.data,
                    exact: { fields: ['tUs', 'clientXf32', 'clientYf32'], enc: exactEnc.enc, data: exactEnc.data },
                },
                events: self.events,
                checkpoints: self.checkpoints,
                stats: { inputCount: self.inputCount, untrusted: self.untrusted, pointerTypes: self.pointerTypes.slice(), keyCount: self.keyCount },
                truncated: truncated,
            };
        };

        const all = [encodeInts(rows, btoaFn, CS), encodeInts(exact, btoaFn, CS)];
        for (let i = 0; i < names.length; i++) all.push(encodeInts(streams[names[i]], btoaFn, CS));
        return Promise.all(all)
            .then(function (encoded) {
                const e: { [name: string]: Encoded } = {};
                for (let i = 0; i < names.length; i++) e[names[i]] = encoded[i + 2];
                let payload = build(encoded[0], encoded[1], rowCount, e);
                if (JSON.stringify(payload).length <= MAX_PAYLOAD_CHARS) return payload;
                // Too big: drop pointer moves, keep every tap, key and state row.
                truncated = true;
                const slim = withoutMoves(rows);
                const slimExact: number[] = [];
                for (let i = 0; i < moveFlags.length; i++) {
                    if (!moveFlags[i]) slimExact.push(exact[i * 3], exact[i * 3 + 1], exact[i * 3 + 2]);
                }
                return Promise.all([encodeInts(slim, btoaFn, CS), encodeInts(slimExact, btoaFn, CS)]).then(function (out) {
                    payload = build(out[0], out[1], slim.length / 8, e);
                    return payload;
                });
            })
            .then(function (payload) {
                self.send({ event_type: 'GG_GAME_OVER', payload: payload });
            });
    }

    // ---- capture ----

    private elapsed(): number {
        return Math.round(this.now() - this.sessionStart);
    }

    private recording(): boolean {
        return !this.ended && this.capture !== 'off';
    }

    private addRow(type: number, x: number, y: number, pid: number, ptype: number, flags: number): boolean {
        if (this.ended) return false;
        // Moves waiting for the frame end are older than this row, so they go first.
        this.flushMoves();
        return this.recorder.add(this.now(), this.frames - this.sessionFrame, type, x, y, pid, ptype, flags);
    }

    private listen(): void {
        const win = this.win;
        const self = this;
        const opts: any = { capture: true, passive: true };
        const pointer = function (type: number) {
            return function (e: any) { self.onPointer(e, type); };
        };
        win.addEventListener('pointerdown', pointer(ROW.POINTER_DOWN), opts);
        win.addEventListener('pointerup', pointer(ROW.POINTER_UP), opts);
        win.addEventListener('pointercancel', pointer(ROW.POINTER_CANCEL), opts);
        win.addEventListener('pointermove', function (e: any) { self.onMove(e); }, opts);
        win.addEventListener('keydown', function (e: any) { self.onKey(e, ROW.KEY_DOWN); }, opts);
        win.addEventListener('keyup', function (e: any) { self.onKey(e, ROW.KEY_UP); }, opts);
        win.addEventListener('wheel', function (e: any) { self.onWheel(e); }, opts);
        win.addEventListener('blur', function () {
            self.focusLosses += self.ended ? 0 : 1;
            if (self.recording()) self.addRow(ROW.BLUR, 0, 0, 0, PTYPE.none, FLAG.TRUSTED);
        }, opts);
        win.addEventListener('focus', function () {
            if (self.recording()) self.addRow(ROW.FOCUS, 0, 0, 0, PTYPE.none, FLAG.TRUSTED);
        }, opts);
        win.addEventListener('resize', function () { self.onResize(); }, opts);
        if (win.document) {
            win.document.addEventListener('visibilitychange', function () { self.onVisibility(); }, opts);
        }
    }

    private pidFor(pointerId: number): number {
        const key = String(pointerId);
        if (!Object.prototype.hasOwnProperty.call(this.pidMap, key)) {
            this.pidMap[key] = this.nextPid % 10;
            this.nextPid++;
        }
        return this.pidMap[key];
    }

    private ptypeOf(e: any): number {
        const p = (PTYPE as any)[e.pointerType];
        return typeof p === 'number' ? p : PTYPE.none;
    }

    private flagsOf(e: any): number {
        return (e.isTrusted ? FLAG.TRUSTED : 0) | (e.isPrimary ? FLAG.PRIMARY : 0) | ((e.buttons & 1) ? FLAG.BUTTON_HELD : 0);
    }

    private noteInput(trusted: boolean): void {
        this.inputCount++;
        if (this.firstInputMs === null) this.firstInputMs = this.elapsed();
        if (!trusted) this.untrusted++;
    }

    /** The largest canvas, found when an event needs it, since engines create it after load. */
    private findCanvas(): any {
        const doc = this.win.document;
        if (this.canvas && doc && doc.documentElement.contains(this.canvas)) return this.canvas;
        if (!doc) return null;
        const list = doc.getElementsByTagName('canvas');
        let best: any = null;
        let bestArea = 0;
        for (let i = 0; i < list.length; i++) {
            const r = list[i].getBoundingClientRect();
            const area = r.width * r.height;
            if (area > bestArea) { best = list[i]; bestArea = area; }
        }
        this.canvas = best;
        return best;
    }

    private position(e: any): number[] {
        const canvas = this.findCanvas();
        if (!canvas) return [0, 0];
        const r = canvas.getBoundingClientRect();
        if (!r.width || !r.height) return [0, 0];
        return [Math.round((e.clientX - r.left) / r.width * 10000), Math.round((e.clientY - r.top) / r.height * 10000)];
    }

    private onPointer(e: any, type: number): void {
        if (!this.recording() || isEditable(e.target)) return;
        const pid = this.pidFor(e.pointerId);
        const pos = this.position(e);
        const ptype = this.ptypeOf(e);
        if (this.addRow(type, pos[0], pos[1], pid, ptype, this.flagsOf(e))) this.noteExact(this.exactOf(e, true), false);
        if (type === ROW.POINTER_DOWN) {
            this.noteInput(!!e.isTrusted);
            const name = typeof e.pointerType === 'string' && e.pointerType ? e.pointerType : 'none';
            if (this.pointerTypes.indexOf(name) < 0) this.pointerTypes.push(name);
        } else if (!e.isTrusted) {
            this.untrusted++;
        }
    }

    private onMove(e: any): void {
        if (!this.recording() || this.capture === 'events' || isEditable(e.target)) return;
        const pid = this.pidFor(e.pointerId);
        const pos = this.position(e);
        // One row per pointer per frame: the latest move wins, stamped with its own time and frame.
        this.pendingMoves[String(pid)] = [pos[0], pos[1], pid, this.ptypeOf(e), this.flagsOf(e), this.now(), this.frames - this.sessionFrame,
            this.exactOf(e, true)];
        if (!e.isTrusted) this.untrusted++;
    }

    private flushMoves(): void {
        const moves: any[][] = [];
        for (const key in this.pendingMoves) {
            if (Object.prototype.hasOwnProperty.call(this.pendingMoves, key)) moves.push(this.pendingMoves[key]);
        }
        if (!moves.length) return;
        this.pendingMoves = {};
        moves.sort(function (a, b) { return a[5] - b[5]; });
        for (let i = 0; i < moves.length; i++) {
            const m = moves[i];
            if (this.recorder.add(m[5], m[6], ROW.POINTER_MOVE, m[0], m[1], m[2], m[3], m[4])) this.noteExact(m[7] as any, true);
        }
    }

    private onKey(e: any, type: number): void {
        if (!this.recording() || isEditable(e.target)) return;
        // The physical key only (KeyboardEvent.code). Never the character typed.
        const code = typeof e.code === 'string' && e.code ? e.code : 'Unidentified';
        const flags = (e.isTrusted ? FLAG.TRUSTED : 0) | (e.repeat ? FLAG.REPEAT : 0);
        if (this.addRow(type, this.recorder.keyIndex(code), 0, 0, PTYPE.none, flags)) this.noteExact(this.exactOf(e, false), false);
        if (type === ROW.KEY_DOWN && !e.repeat) {
            this.keyCount++;
            this.noteInput(!!e.isTrusted);
        } else if (!e.isTrusted) {
            this.untrusted++;
        }
    }

    private onWheel(e: any): void {
        if (!this.recording() || this.capture === 'events') return;
        const dy = Math.max(-10000, Math.min(10000, Math.round(e.deltaY || 0)));
        if (this.addRow(ROW.WHEEL, dy, 0, 0, PTYPE.mouse, e.isTrusted ? FLAG.TRUSTED : 0)) this.noteExact(this.exactOf(e, false), false);
    }

    private exactOf(e: any, point: boolean): number[] {
        const ts = typeof e.timeStamp === 'number' && isFinite(e.timeStamp) ? e.timeStamp : this.now();
        const since = this.frameStartUs !== null ? this.frameStartUs : Math.round(this.sessionStart * 1000);
        return [Math.round(ts * 1000) - since, point ? float32Bits(e.clientX) : 0, point ? float32Bits(e.clientY) : 0];
    }

    private noteExact(exact: number[], move: boolean): void {
        this.inputExact.push(exact[0], exact[1], exact[2]);
        this.inputExactMove.push(move);
    }

    private onResize(): void {
        this.canvas = null;
        if (!this.recording()) return;
        const w = this.win.innerWidth || 0;
        const h = this.win.innerHeight || 0;
        this.addRow(ROW.VIEWPORT_RESIZE, w, h, w > h ? 1 : 0, PTYPE.none, FLAG.TRUSTED);
    }

    private onVisibility(): void {
        const hidden = !!this.win.document.hidden;
        const t = this.now();
        if (hidden && this.hiddenAt === null) this.hiddenAt = t;
        if (!hidden && this.hiddenAt !== null) {
            this.hiddenMs += t - this.hiddenAt;
            this.hiddenAt = null;
        }
        if (this.recording()) this.addRow(hidden ? ROW.PAGE_HIDDEN : ROW.PAGE_VISIBLE, 0, 0, 0, PTYPE.none, FLAG.TRUSTED);
    }

    /**
     * A LOAD row whenever something the game loads finishes, so a replay can hold its clock until its
     * own loads land on the same frames. Wrappers only: every call goes through unchanged and returns
     * the same result.
     */
    private watchLoads(): void {
        const win = this.win;
        const self = this;
        // The file that landed, where there is one: a fetch's response, a body's response, an XHR, an element.
        const finish = function (kind: number, urlOf?: (v: any) => any) {
            return function (this: any, v?: any) {
                self.pendingLoads = Math.max(0, self.pendingLoads - 1);
                let url: any = null;
                try {
                    url = urlOf ? urlOf.call(this, v) : null;
                } catch {
                    url = null;
                }
                self.noteLoad(kind, url);
            };
        };
        const wrap = function (owner: any, name: string, kind: number, urlOf?: (v: any, target: any) => any) {
            if (!owner || typeof owner[name] !== 'function') return;
            const original = owner[name];
            owner[name] = function (this: any) {
                const target = this;
                const result = original.apply(this === undefined ? win : this, arguments);
                if (result && typeof result.then === 'function') {
                    self.pendingLoads++;
                    const done = finish(kind, urlOf ? function (v: any) { return urlOf(v, target); } : undefined);
                    result.then(done, done);
                }
                return result;
            };
        };
        try {
            wrap(win, 'fetch', LOAD.FETCH, function (v: any) { return v && v.url; });
            if (win.Response) {
                const names = ['arrayBuffer', 'blob', 'json', 'text'];
                for (let i = 0; i < names.length; i++) {
                    wrap(win.Response.prototype, names[i], LOAD.BODY, function (_v: any, target: any) { return target && target.url; });
                }
            }
            wrap(win, 'createImageBitmap', LOAD.BITMAP);
            if (win.HTMLImageElement) wrap(win.HTMLImageElement.prototype, 'decode', LOAD.IMAGE_DECODE);
            const AudioCtx = win.BaseAudioContext || win.AudioContext || win.webkitAudioContext;
            if (AudioCtx) wrap(AudioCtx.prototype, 'decodeAudioData', LOAD.AUDIO_DECODE);
            // The audio clock starting up (a sound engine waits for it before it plays).
            const RunningCtx = win.AudioContext || win.webkitAudioContext;
            if (RunningCtx) wrap(RunningCtx.prototype, 'resume', LOAD.AUDIO_RESUME);
            if (win.FontFace) wrap(win.FontFace.prototype, 'load', LOAD.FONT);
            if (win.XMLHttpRequest) {
                const send = win.XMLHttpRequest.prototype.send;
                win.XMLHttpRequest.prototype.send = function (this: any) {
                    self.pendingLoads++;
                    try {
                        this.addEventListener('loadend', finish(LOAD.XHR, function (this: any) { return this.responseURL; }), { once: true });
                    } catch {
                        self.pendingLoads--;
                    }
                    return send.apply(this, arguments);
                };
            }
            // Image and media elements load without a call to wrap. One whose src is set from code (most engines
            // load images with new Image(), never added to the page) is watched from that moment; one in the
            // page's HTML, and every script and stylesheet, is caught by its load event on the way down.
            const watchElement = function (el: any, kind: number) {
                if (el.__ggLoad) return;
                el.__ggLoad = true;
                self.pendingLoads++;
                const done = function () {
                    el.__ggLoad = false;
                    el.removeEventListener('load', done);
                    el.removeEventListener('error', done);
                    el.removeEventListener('loadeddata', done);
                    finish(kind, function () { return el.currentSrc || el.src; })();
                };
                el.addEventListener(kind === LOAD.IMAGE ? 'load' : 'loadeddata', done);
                el.addEventListener('error', done);
            };
            const watchSrc = function (Ctor: any, kind: number) {
                const proto = Ctor && Ctor.prototype;
                const desc = proto && Object.getOwnPropertyDescriptor(proto, 'src');
                if (!desc || !desc.set || !desc.configurable) return;
                Object.defineProperty(proto, 'src', {
                    configurable: true,
                    enumerable: desc.enumerable,
                    get: desc.get,
                    set: function (this: any, v: any) {
                        watchElement(this, kind);
                        desc.set.call(this, v);
                    },
                });
            };
            watchSrc(win.HTMLImageElement, LOAD.IMAGE);
            watchSrc(win.HTMLMediaElement, LOAD.MEDIA);
            if (win.document) {
                const element = function (e: any) {
                    const el = e.target;
                    if (!el || el.__ggLoad !== undefined) return; // watched from its src
                    const tag = el.tagName ? String(el.tagName).toUpperCase() : '';
                    const kind = tag === 'IMG' ? LOAD.IMAGE : tag === 'AUDIO' || tag === 'VIDEO' ? LOAD.MEDIA
                        : tag === 'SCRIPT' && el.src ? LOAD.SCRIPT : tag === 'LINK' && /stylesheet/i.test(el.rel || '') ? LOAD.STYLE : -1;
                    if (kind >= 0) self.noteLoad(kind, el.currentSrc || el.src || el.href);
                };
                win.document.addEventListener('load', element, true);
                win.document.addEventListener('error', element, true);
                win.document.addEventListener('loadeddata', element, true);
            }
        } catch {
            // A browser that refuses a wrapper keeps its originals; the diary just has fewer LOAD rows.
        }
    }

    /** crypto.getRandomValues and randomUUID stay the browser's own, unseeded: what they return is recorded. */
    private recordCrypto(): void {
        const c: any = this.win.crypto;
        if (!c) return;
        const self = this;
        const keep = function (ints: number[]) {
            self.cryptoCalls++;
            if (self.ended || self.cryptoTruncated) return;
            if (self.cryptoInts.length + ints.length > MAX_CRYPTO_INTS) {
                self.cryptoTruncated = true;
                return;
            }
            for (let i = 0; i < ints.length; i++) self.cryptoInts.push(ints[i] | 0);
        };
        try {
            if (typeof c.getRandomValues === 'function') {
                const get = c.getRandomValues;
                c.getRandomValues = function (array: any) {
                    const out = get.call(c, array);
                    const type = array && array.constructor ? ARRAY_TYPES.indexOf(array.constructor.name) : -1;
                    // [0, array type, length, values...]; a type we don't keep (BigInt64Array) records no values.
                    const values: number[] = [0, type, type >= 0 ? array.length : 0];
                    if (type >= 0) for (let i = 0; i < array.length; i++) values.push(array[i]);
                    keep(values);
                    return out;
                };
            }
            if (typeof c.randomUUID === 'function') {
                const uuid = c.randomUUID;
                c.randomUUID = function () {
                    const out: string = uuid.call(c);
                    // [1, Uint32Array, 4, the UUID's 128 bits as 4 words].
                    const hex = String(out).replace(/-/g, '');
                    const values: number[] = [1, 6, 4];
                    for (let i = 0; i < 4; i++) values.push(parseInt(hex.slice(i * 8, i * 8 + 8), 16));
                    keep(values);
                    return out;
                };
            }
        } catch {
            // Left as the browser's own.
        }
    }

    /** performance.now stays the browser's own; the first reading of each frame is noted. */
    private watchClock(perf: any, perfNow: () => number): void {
        const self = this;
        try {
            perf.now = function () {
                const v = perfNow.call(perf);
                if (self.nowPending) {
                    self.nowPending = false;
                    if (self.frameStartUs !== null) self.frameNows.push(Math.round(v * 1000) - self.frameStartUs);
                }
                self.noteRead(v);
                return v;
            };
        } catch {
            // Left as the browser's own; frameNow then says "not read" for every frame.
        }
    }

    private readable(): boolean {
        return !this.ended && this.frameTimes.length < MAX_FRAMES;
    }

    /**
     * Date stays the browser's own: Date.now and new Date() with no arguments are noted. The constructor is
     * a Proxy over the real one, so its prototype, statics and instanceof are unchanged.
     */
    private watchDate(): void {
        const win = this.win;
        const self = this;
        const RealDate = win.Date;
        if (typeof RealDate !== 'function' || typeof win.Proxy !== 'function' || !win.Reflect) return;
        try {
            const realNow = this.realDateNow;
            const note = function (v: number) {
                if (self.readable()) self.dateReads.note(v - self.dateStartMs);
            };
            const proxy = new win.Proxy(RealDate, {
                construct: function (target: any, args: any[], newTarget: any) {
                    const d = win.Reflect.construct(target, args, newTarget === proxy ? target : newTarget);
                    if (args.length === 0) note(d.getTime());
                    return d;
                },
            });
            RealDate.now = function () {
                const v = realNow();
                note(v);
                return v;
            };
            win.Date = proxy;
        } catch {
            // Left as the browser's own.
        }
    }

    /** AudioContext.currentTime stays the audio clock's own; each reading is noted in sample frames. */
    private watchAudioClock(): void {
        const self = this;
        const Ctx = this.win.BaseAudioContext || this.win.AudioContext || this.win.webkitAudioContext;
        const proto = Ctx && Ctx.prototype;
        const desc = proto && Object.getOwnPropertyDescriptor(proto, 'currentTime');
        if (!desc || !desc.get || !desc.configurable) return;
        try {
            Object.defineProperty(proto, 'currentTime', {
                configurable: true,
                enumerable: desc.enumerable,
                get: function (this: any) {
                    const v = desc.get.call(this);
                    if (self.readable()) {
                        self.audioRate = this.sampleRate || self.audioRate;
                        self.audioReads.note(Math.round(v * (this.sampleRate || 0)));
                    }
                    return v;
                },
            });
        } catch {
            // Left as the browser's own.
        }
    }

    /** setTimeout and setInterval stay the browser's own; each callback that runs is counted. */
    private watchTimers(): void {
        const win = this.win;
        const self = this;
        const wrap = function (name: string) {
            const original = win[name];
            if (typeof original !== 'function') return;
            win[name] = function (this: any, cb: any) {
                const args = Array.prototype.slice.call(arguments);
                if (typeof cb === 'function') {
                    args[0] = function (this: any) {
                        self.timersSinceTick++;
                        self.noteTimer();
                        return cb.apply(this, arguments);
                    };
                }
                return original.apply(this === undefined ? win : this, args);
            };
        };
        try {
            wrap('setTimeout');
            wrap('setInterval');
        } catch {
            // Left as the browser's own.
        }
    }

    private sinceFrameUs(): number {
        const since = this.frameStartUs !== null ? this.frameStartUs : Math.round(this.sessionStart * 1000);
        return Math.round(this.now() * 1000) - since;
    }

    private noteLoad(kind: number, url?: any): void {
        if (!this.recording()) return;
        const us = this.sinceFrameUs();
        if (this.addRow(ROW.LOAD, kind, this.pendingLoads, this.timersSinceTick, PTYPE.none, FLAG.TRUSTED)) {
            this.loadTimes.push(us);
            this.loadKeys.push(typeof url === 'string' && url ? urlKey(url) : 0);
        }
    }

    private noteRead(v: number): void {
        if (this.ended || this.frameTimes.length >= MAX_FRAMES || this.nowReadsTruncated) return;
        if (this.nowReads.length >= MAX_NOW_READS) {
            this.nowReadsTruncated = true;
            return;
        }
        const since = this.frameStartUs !== null ? this.frameStartUs : Math.round(this.sessionStart * 1000);
        this.nowReads.push(Math.round(v * 1000) - since);
        this.readsSinceTick++;
    }

    private noteTimer(): void {
        if (this.ended || this.frameTimes.length >= MAX_FRAMES || this.timerTimesTruncated) return;
        if (this.timerTimes.length >= MAX_FRAMES * 4) {
            this.timerTimesTruncated = true;
            return;
        }
        this.timerTimes.push(this.sinceFrameUs());
    }

    private closeFrameNow(): void {
        if (this.nowPending && this.frameStartUs !== null) this.frameNows.push(NOT_READ);
        this.nowPending = false;
    }

    private onFrame(ts?: number): void {
        const t = this.now();
        this.frames++;
        if (this.ended) {
            this.lastFrameT = t;
            return;
        }
        if (this.frameDts.length < MAX_FRAMES) this.frameDts.push(Math.round((t - this.lastFrameT) * 10));
        if (this.frameTimes.length < MAX_FRAMES) {
            const us = Math.round((typeof ts === 'number' && isFinite(ts) ? ts : t) * 1000);
            this.frameTimes.push(us - (this.lastFrameUs === null ? Math.round(this.sessionStart * 1000) : this.lastFrameUs));
            this.lastFrameUs = us;
            // This tick runs first in every frame (registered before the game's scripts): the frame before is over.
            this.closeFrameNow();
            this.frameStartUs = us;
            this.nowPending = true;
            this.frameTimers.push(this.timersSinceTick);
            this.timersSinceTick = 0;
            this.frameReads.push(this.readsSinceTick);
            this.readsSinceTick = 0;
            this.dateReads.tick();
            this.audioReads.tick();
        }
        this.lastFrameT = t;
        this.flushMoves();
        if (this.frames % 30 === 0 && this.recording()) this.checkCanvasSize();
    }

    private checkCanvasSize(): void {
        const canvas = this.findCanvas();
        if (!canvas) return;
        const r = canvas.getBoundingClientRect();
        const w = Math.round(r.width);
        const h = Math.round(r.height);
        if (w !== this.canvasW || h !== this.canvasH) {
            this.canvasW = w;
            this.canvasH = h;
            this.addRow(ROW.CANVAS_RESIZE, w, h, 0, PTYPE.none, FLAG.TRUSTED);
        }
    }

    private screenInfo(): { [key: string]: any } {
        const win = this.win;
        const canvas = this.findCanvas();
        const r = canvas ? canvas.getBoundingClientRect() : null;
        const w = win.innerWidth || 0;
        const h = win.innerHeight || 0;
        return {
            w: w,
            h: h,
            dpr: win.devicePixelRatio || 1,
            orientation: w > h ? 'landscape' : 'portrait',
            canvas: r ? { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } : null,
            maxTouchPoints: (win.navigator && win.navigator.maxTouchPoints) || 0,
        };
    }
}

/** v2 runtime for this page, or null to stay in v1. */
export function createV2(win: AnyWindow | undefined): V2Runtime | null {
    if (!win || !win.location) return null;
    const params = parseV2Params(win.location.search || '');
    if (!params || !v2Supported(win)) return null;
    try {
        return new V2Runtime(win, params);
    } catch {
        return null;
    }
}
