export type SendPushParams = {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
};

export type SendPushResult = {
  success: boolean;
  error?: string;
  deviceNotRegistered?: boolean;
};

export type PushAdapter = {
  send(params: SendPushParams): Promise<SendPushResult>;
  sendBatch(params: SendPushParams[]): Promise<SendPushResult[]>;
};
