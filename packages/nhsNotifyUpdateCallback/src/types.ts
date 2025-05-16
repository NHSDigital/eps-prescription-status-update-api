// Enums
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

// Callback return schema
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

export interface MessageStatusResource {
  /** Always "MessageStatus" */
  type: "MessageStatus";
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
