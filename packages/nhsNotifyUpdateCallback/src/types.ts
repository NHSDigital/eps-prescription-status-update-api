// --- Literal sets ------------------------------------------------------------

export enum CallbackType {
  message = "MessageStatus",
  channel = "ChannelStatus"
}

export const MessageStatuses = [
  "created",
  "pending_enrichment",
  "enriched",
  "sending",
  "delivered",
  "failed"
] as const
export type MessageStatus = typeof MessageStatuses[number];

export const ChannelTypes = ["nhsapp", "email", "sms", "letter"] as const
export type ChannelType = typeof ChannelTypes[number];

export const ChannelStatuses = [
  "created",
  "sending",
  "delivered",
  "failed",
  "skipped"
] as const
export type ChannelStatus = typeof ChannelStatuses[number];

export const CascadeTypes = ["primary", "secondary"] as const
export type CascadeType = typeof CascadeTypes[number];

export const SupplierStatuses = [
  "accepted",
  "cancelled",
  "delivered",
  "notification_attempted",
  "notified",
  "pending_virus_check",
  "permanent_failure",
  "read",
  "received",
  "rejected",
  "technical_failure",
  "temporary_failure",
  "unnotified",
  "unknown",
  "validation_failed"
] as const
export type SupplierStatus = typeof SupplierStatuses[number];

// --- Core models -------------------------------------------------------------

export interface Channel {
  readonly type: ChannelType;
  readonly channelStatus: ChannelStatus;
}

export interface RoutingPlan {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly createdDate: string;
}

// Shared attributes across callbacks
interface BaseAttributes {
  /** Notify ID for the message (KSUID; 27-char alphanumeric) */
  readonly messageId: string;
  /** Original reference supplied by us for the message */
  readonly messageReference: string;
  /** Timestamp of the callback event */
  readonly timestamp: string;
}

export interface MessageStatusAttributes extends BaseAttributes {
  /** Aggregate status across all channels */
  readonly messageStatus: MessageStatus;
  readonly messageStatusDescription?: string;
  /** List of channels attempted for delivery */
  readonly channels: ReadonlyArray<Channel>;
  readonly routingPlan: RoutingPlan;
}

export interface ChannelStatusAttributes extends BaseAttributes {
  readonly cascadeType?: CascadeType;
  readonly cascadeOrder?: number;
  readonly channel: ChannelType;
  readonly channelStatus: ChannelStatus;
  /** Extra information associated with the status of this channel */
  readonly channelStatusDescription?: string;
  readonly supplierStatus?: SupplierStatus;
  readonly retryCount: number;
}

// --- Generic JSON-ish resource -----------------------------------------------

interface Links {
  /** URL to retrieve the overarching message status */
  readonly message: string;
}

interface Meta {
  /** Key to deduplicate retried requests */
  readonly idempotencyKey: string;
}

interface Resource<CallbackType, TAttributes> {
  readonly type: CallbackType;
  readonly attributes: TAttributes;
  readonly links: Links;
  readonly meta: Meta;
}

// Concrete resources
export type MessageStatusResource = Resource<"MessageStatus", MessageStatusAttributes>;
export type ChannelStatusResource = Resource<"ChannelStatus", ChannelStatusAttributes>;

// --- Responses ---------------------------------------------------------------

export interface MessageStatusResponse {
  readonly data: Array<MessageStatusResource>;
}

export interface ChannelStatusResponse {
  readonly data: Array<ChannelStatusResource>;
}

export type CallbackResource = MessageStatusResource | ChannelStatusResource;

export interface CallbackResponse {
  readonly data: Array<CallbackResource>;
}
