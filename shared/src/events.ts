/**
 * Socket.IO event contract shared by the server and the client.
 * Add every new event here so both sides stay in sync.
 */

export interface HelloPayload {
  message: string;
  serverTime: string;
}

/** Events the server sends to clients. */
export interface ServerToClientEvents {
  hello: (payload: HelloPayload) => void;
}

/** Events clients send to the server. */
export interface ClientToServerEvents {
  ping: (ack: (serverTime: string) => void) => void;
}
