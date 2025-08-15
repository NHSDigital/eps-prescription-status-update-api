// Enums
export enum CallbackType {
  message = "MessageStatus",
  channel = "ChannelStatus"
}

export type MessageStatus =
  | "created"
  | "pending_enrichment"
  | "enriched"
  | "sending"
  | "delivered"
  | "failed";

export type ChannelType =
  | "nhsapp"
  | "email"
  | "sms"
  | "letter";

export type ChannelStatus =
  | "created"
  | "sending"
  | "delivered"
  | "failed"
  | "skipped";

export interface Channel {
  /** The communication type of this channel */
  type: ChannelType;
  /** Current status of this channel */
  channelStatus: ChannelStatus;
}

export interface RoutingPlan {
  /** Identifier for the routing plan */
  id: string;
  /** Name of the routing plan */
  name: string;
  /** Specific version of the routing plan */
  version: string;
  /** Creation date of the routing plan */
  createdDate: string;
}

export interface MessageStatusAttributes {
  /** Unique identifier for the message */
  messageId: string;
  /** Original reference supplied for the message */
  messageReference: string;
  /** Aggregate status across all channels */
  messageStatus: MessageStatus;
  /** Extra information about the message status, if any */
  messageStatusDescription?: string;
  /** List of channels attempted for delivery */
  channels: Array<Channel>;
  /** Timestamp of the callback event */
  timestamp: string;
  /** Routing plan details */
  routingPlan: RoutingPlan;
}

// https://digital.nhs.uk/developer/api-catalogue/nhs-notify#post-/%3Cclient-provided-message-status-URI%3E
export interface MessageStatusResource {
  type: CallbackType.message;
  attributes: MessageStatusAttributes;
  links: {
    /** URL to retrieve the overarching message status */
    message: string;
  };
  meta: {
    /** Key to deduplicate retried requests */
    idempotencyKey: string;
  };
}

export interface MessageStatusResponse {
  /**
   * Array of MessageStatus resources.
   * Must contain at least one element.
   */
  data: Array<MessageStatusResource>;
}

// --- ChannelStatus payload types ---

export type CascadeType = "primary" | "secondary";

export type SupplierStatus =
  | "delivered"
  | "read"
  | "notification_attempted"
  | "unnotified"
  | "rejected"
  | "notified"
  | "received"
  | "permanent_failure"
  | "temporary_failure"
  | "technical_failure"
  | "accepted"
  | "cancelled"
  | "pending_virus_check"
  | "validation_failed"
  | "unknown";

export interface ChannelStatusAttributes {
  /** The unique identifier for the message (KSUID; 27-char alphanumeric) */
  messageId: string;
  /** Original reference supplied for the message (supplied by us) */
  messageReference: string;
  /** The cascade type of this message */
  cascadeType?: CascadeType;
  /** 1-based order of the message in the cascade */
  cascadeOrder?: number;
  channel: ChannelType;
  /** Current status of this channel */
  channelStatus: ChannelStatus;
  /** Extra information associated with the status of this channel */
  channelStatusDescription?: string;
  /** Current status of this message within the channel/supplier */
  supplierStatus?: SupplierStatus;
  /** Date-time when the supplier status change was processed (ISO 8601) */
  timestamp: string;
  retryCount: number;
}

// https://digital.nhs.uk/developer/api-catalogue/nhs-notify#post-/%3Cclient-provided-channel-status-URI%3E
export interface ChannelStatusResource {
  type: CallbackType.channel;
  attributes: ChannelStatusAttributes;
  links: {
    /** URL to retrieve overarching message status */
    message: string;
  };
  meta: {
    /** Key to deduplicate retried requests */
    idempotencyKey: string;
  };
}

export interface ChannelStatusResponse {
  /**
   * Array of ChannelStatus resources.
   * Must contain at least one element.
   */
  data: Array<ChannelStatusResource>;
}

export type CallbackResource = MessageStatusResource | ChannelStatusResource;

export interface CallbackResponse {
  data: Array<CallbackResource>;
}
