/**
 * SDK v2: seeded randomness, the input diary and the v2 game over payload.
 *
 * Created at module load, before the game engine runs, so Math.random is
 * replaced before anything draws from it. Without valid gg_* params, or in a
 * browser missing what v2 needs, nothing here runs and the SDK is plain v1.
 */

import { encodeInts, Encoded } from './encode';
import { CaptureMode, parseSessionId, parseSeed, parseV2Params, V2Params } from './params';
import { FIELDS, FLAG, PTYPE, Recorder, ROW, withoutMoves } from './recorder';
import { gameplaySeed, mulberry32 } from './rng';

export const SDK_VERSION = '2.0.0';
export const MAX_PAYLOAD_CHARS = 512 * 1024;
const MAX_EVENTS = 5000;
const MAX_CHECKPOINTS = 1000;
const MAX_FRAMES = 120000;

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
    private pendingMoves: { [pid: string]: number[] } = {};
    private canvas: any = null;
    private canvasW = 0;
    private canvasH = 0;

    constructor(private win: AnyWindow, params: V2Params) {
        this.origin = params.origin;
        this.capture = params.capture;
        // Taken now, so a later patch of performance.now (a speed hack) can't touch our clock.
        const perf = win.performance;
        const perfNow = perf.now;
        this.now = function () { return perfNow.call(perf); };
        this.sdkStart = this.now();
        this.startSession(params.sessionId, params.seed, false);
        this.replaceMathRandom();
        this.listen();
        this.lastFrameT = this.now();
        const self = this;
        win.requestAnimationFrame(function tick() {
            self.onFrame();
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
        const rows = this.recorder.rows;
        const rowCount = this.recorder.count;
        const keys = this.recorder.keys.slice();
        let truncated = this.recorder.truncated;

        const build = function (inputs: Encoded, frameDt: Encoded, inputRows: number): { [key: string]: any } {
            return {
                score: score,
                v: 2,
                sdkVersion: SDK_VERSION,
                sessionId: self.sessionId,
                endReason: endReason,
                rng: { seeded: true, algo: 'mulberry32', calls: self.rngCalls, gameplayCalls: self.gameplayCalls },
                timing: {
                    loadMs: self.loadMs,
                    firstInputMs: self.firstInputMs,
                    durationMs: durationMs,
                    activeMs: Math.max(0, Math.round(durationMs - pausedMs - hiddenMs)),
                    pausedMs: Math.round(pausedMs),
                    hiddenMs: Math.round(hiddenMs),
                    focusLosses: self.focusLosses,
                    frames: frames,
                    fpsMean: durationMs > 0 ? Math.round(frames / (durationMs / 1000) * 10) / 10 : 0,
                    frameDt: { enc: frameDt.enc, unit: '0.1ms', data: frameDt.data },
                },
                screen: self.screenInfo(),
                inputs: { fields: FIELDS, enc: inputs.enc, rows: inputRows, keys: keys, data: inputs.data },
                events: self.events,
                checkpoints: self.checkpoints,
                stats: { inputCount: self.inputCount, untrusted: self.untrusted, pointerTypes: self.pointerTypes.slice(), keyCount: self.keyCount },
                truncated: truncated,
            };
        };

        return Promise.all([encodeInts(rows, btoaFn, CS), encodeInts(this.frameDts, btoaFn, CS)])
            .then(function (encoded) {
                let payload = build(encoded[0], encoded[1], rowCount);
                if (JSON.stringify(payload).length <= MAX_PAYLOAD_CHARS) return payload;
                // Too big: drop pointer moves, keep every tap, key and state row.
                truncated = true;
                const slim = withoutMoves(rows);
                return encodeInts(slim, btoaFn, CS).then(function (inputs) {
                    payload = build(inputs, encoded[1], slim.length / 8);
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

    private addRow(type: number, x: number, y: number, pid: number, ptype: number, flags: number): void {
        if (this.ended) return;
        // Moves waiting for the frame end are older than this row, so they go first.
        this.flushMoves();
        this.recorder.add(this.now(), this.frames - this.sessionFrame, type, x, y, pid, ptype, flags);
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
        this.addRow(type, pos[0], pos[1], pid, ptype, this.flagsOf(e));
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
        this.pendingMoves[String(pid)] = [pos[0], pos[1], pid, this.ptypeOf(e), this.flagsOf(e), this.now(), this.frames - this.sessionFrame];
        if (!e.isTrusted) this.untrusted++;
    }

    private flushMoves(): void {
        const moves: number[][] = [];
        for (const key in this.pendingMoves) {
            if (Object.prototype.hasOwnProperty.call(this.pendingMoves, key)) moves.push(this.pendingMoves[key]);
        }
        if (!moves.length) return;
        this.pendingMoves = {};
        moves.sort(function (a, b) { return a[5] - b[5]; });
        for (let i = 0; i < moves.length; i++) {
            const m = moves[i];
            this.recorder.add(m[5], m[6], ROW.POINTER_MOVE, m[0], m[1], m[2], m[3], m[4]);
        }
    }

    private onKey(e: any, type: number): void {
        if (!this.recording() || isEditable(e.target)) return;
        // The physical key only (KeyboardEvent.code). Never the character typed.
        const code = typeof e.code === 'string' && e.code ? e.code : 'Unidentified';
        const flags = (e.isTrusted ? FLAG.TRUSTED : 0) | (e.repeat ? FLAG.REPEAT : 0);
        this.addRow(type, this.recorder.keyIndex(code), 0, 0, PTYPE.none, flags);
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
        this.addRow(ROW.WHEEL, dy, 0, 0, PTYPE.mouse, e.isTrusted ? FLAG.TRUSTED : 0);
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

    private onFrame(): void {
        const t = this.now();
        this.frames++;
        if (this.ended) {
            this.lastFrameT = t;
            return;
        }
        if (this.frameDts.length < MAX_FRAMES) this.frameDts.push(Math.round((t - this.lastFrameT) * 10));
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
