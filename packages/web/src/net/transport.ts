/** Indirection for outgoing client messages (server WebSocket or the in-browser mock). */

import type { ClientMessage } from '@gt7/shared';

type Sender = (msg: ClientMessage) => boolean;

let sender: Sender = () => false;

export function setSender(s: Sender): void {
  sender = s;
}

/** Sends a message; returns false when it could not be delivered (offline). */
export function send(msg: ClientMessage): boolean {
  return sender(msg);
}
