/** Base error for every cc-peer failure; `code` is machine-readable. */
export class CcPeerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CcPeerError";
  }
}

export class TransportError extends CcPeerError {
  constructor(message: string) {
    super("TRANSPORT", message);
    this.name = "TransportError";
  }
}

export class NoLiveInboxError extends CcPeerError {
  constructor(message: string) {
    super("NO_LIVE_INBOX", message);
    this.name = "NoLiveInboxError";
  }
}

export class UnknownPeerError extends CcPeerError {
  constructor(message: string) {
    super("UNKNOWN_PEER", message);
    this.name = "UnknownPeerError";
  }
}

export class MessageTooLargeError extends CcPeerError {
  constructor(message: string) {
    super("MESSAGE_TOO_LARGE", message);
    this.name = "MessageTooLargeError";
  }
}

export class UnvettedReplyTargetError extends CcPeerError {
  constructor(message: string) {
    super("UNVETTED_REPLY_TARGET", message);
    this.name = "UnvettedReplyTargetError";
  }
}

export class NotStartedError extends CcPeerError {
  constructor(message: string) {
    super("NOT_STARTED", message);
    this.name = "NotStartedError";
  }
}

export class ProtocolError extends CcPeerError {
  constructor(message: string) {
    super("PROTOCOL", message);
    this.name = "ProtocolError";
  }
}
