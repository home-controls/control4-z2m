/** A message Home Assistant's websocket sends, or a call's payload. */
// biome-ignore lint/suspicious/noExplicitAny: Home Assistant's websocket messages are free-form JSON
export type HaMessage = Record<string, any>;

export const NO_ANSWER: string;

export function caller(send: (msg: HaMessage) => void): {call(payload: HaMessage): Promise<HaMessage>; receive(msg: HaMessage): void};

export function templateError(answer: HaMessage): string | undefined;
