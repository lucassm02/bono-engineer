/**
 * Instance identity: every response carries `x-gt7-race-engineer: real|demo`, even the 401 of a
 * token-protected server, so a second `npm start` can tell "the app is already open here" from
 * "some other program owns this port".
 */

export const INSTANCE_HEADER = 'x-gt7-race-engineer';
export type InstanceMode = 'real' | 'demo';
