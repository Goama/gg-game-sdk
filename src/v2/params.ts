/**
 * Reads the gg_* launch parameters that turn on v2.
 *
 * Parsed by hand: URLSearchParams and URL are missing in IE11 and some old
 * webviews, and anything invalid must leave the SDK in plain v1 mode rather
 * than half of v2.
 */

export type CaptureMode = 'full' | 'events' | 'off';

export interface V2Params {
    sessionId: string;
    seed: number;
    origin: string;
    capture: CaptureMode;
}

const SESSION_ID = /^[A-Za-z0-9_-]{8,64}$/;
const SEED = /^\d{1,10}$/;
const ORIGIN = /^(https?):\/\/([^/?#\s:@]+)(?::(\d{1,5}))?$/i;

function decode(part: string): string | null {
    try {
        return decodeURIComponent(part.replace(/\+/g, ' '));
    } catch {
        return null;
    }
}

export function readParam(search: string, name: string): string | null {
    const query = search.charAt(0) === '?' ? search.slice(1) : search;
    const pairs = query.split('&');
    for (let i = 0; i < pairs.length; i++) {
        const eq = pairs[i].indexOf('=');
        const key = decode(eq < 0 ? pairs[i] : pairs[i].slice(0, eq));
        if (key === name) {
            return eq < 0 ? '' : decode(pairs[i].slice(eq + 1));
        }
    }
    return null;
}

export function parseSessionId(value: string | null): string | null {
    return value !== null && SESSION_ID.test(value) ? value : null;
}

export function parseSeed(value: string | null): number | null {
    if (value === null || !SEED.test(value)) return null;
    const seed = Number(value);
    return seed <= 4294967295 ? seed : null;
}

/** Normalised the way MessageEvent.origin reports it: lower case, no default port. */
export function parseOrigin(value: string | null): string | null {
    const match = value === null ? null : ORIGIN.exec(value);
    if (!match) return null;
    const scheme = match[1].toLowerCase();
    const host = match[2].toLowerCase();
    const port = match[3];
    const isDefault = !port || (scheme === 'https' && port === '443') || (scheme === 'http' && port === '80');
    return scheme + '://' + host + (isDefault ? '' : ':' + port);
}

export function parseV2Params(search: string): V2Params | null {
    if (readParam(search, 'gg_v') !== '2') return null;
    const sessionId = parseSessionId(readParam(search, 'gg_session'));
    const seed = parseSeed(readParam(search, 'gg_seed'));
    const origin = parseOrigin(readParam(search, 'gg_origin'));
    if (sessionId === null || seed === null || origin === null) return null;

    const capture = readParam(search, 'gg_capture');
    return {
        sessionId,
        seed,
        origin,
        capture: capture === 'events' || capture === 'off' ? capture : 'full',
    };
}
