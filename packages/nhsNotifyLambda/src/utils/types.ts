import {Message} from "@aws-sdk/client-sqs"
import {NotifyDataItem} from "@PrescriptionStatusUpdate_common/commonTypes"

// This is an extension of the SQS message interface, which explicitly parses the PSUDataItem
// and helps track the nhs notify results
export interface NotifyDataItemMessage extends Message {
  PSUDataItem: NotifyDataItem
  deliveryStatus?: string
  messageBatchReference?: string,
  // message reference is our internal UUID for the message
  messageReference: string
  // And notify send back one for their internal system.
  notifyMessageId?: string
}

export interface LastNotificationStateType {
  NHSNumber: string
  ODSCode: string
  RequestId: string // x-request-id header
  SQSMessageID?: string // The SQS message ID
  DeliveryStatus: string
  NotifyMessageID?: string // The UUID we got back from Notify for the submitted message
  NotifyMessageReference: string // The references we generated for the message
  NotifyMessageBatchReference?: string // As above
  LastNotifiedPrescriptionStatus: string
  LastNotificationRequestTimestamp: string // ISO-8601 string
  ExpiryTime: number // DynamoDB expiration time (UNIX timestamp)
}

/**
 * NHS NOTIFY REQUEST SCHEMA
 */
export interface CreateMessageBatchRequest {
  data: MessageBatchData;
}

export interface MessageBatchData {
  // This is always the string "MessageBatch"
  type: "MessageBatch";
  attributes: MessageBatchAttributes;
}

export interface MessageBatchAttributes {
  // UUID of the routing plan to use
  routingPlanId: string;
  // Client-supplied UUID to de-duplicate this batch
  messageBatchReference: string;
  messages: Array<MessageBatchItem>;
}

export interface MessageBatchItem {
  // UUID unique per message
  messageReference: string;
  recipient: Recipient;
  originator: Originator;
  /**
   * The personalisation keys and values for this message.
   * These are linked to the routingPlanId provided and are agreed upon during onboarding.
   */
  personalisation: Record<string, string>;
}

export interface Recipient {
  // NHS number is required in our case (technically optional)
  nhsNumber: string;
  // Optional overrides. Approval-only, we aren't using this
  contactDetails?: ContactDetails;
}

// Included for completeness
export interface ContactDetails {
  email?: string;
  sms?: string;
  address?: Address;
  name?: PersonName;
}

export interface Address {
  lines: Array<string>;
  postcode: string;
}

export interface PersonName {
  prefix?: string;
  firstName?: string;
  middleNames?: string;
  lastName: string;
  suffix?: string;
}

export interface Originator {
  // ODS code that the notification will appear to originate from
  odsCode: string;
}

/**
 * NHS NOTIFY RESPONSE SCHEMA
 */

export interface CreateMessageBatchResponse {
  data: MessageBatchResponseData;
}

export interface MessageBatchResponseData {
  // This is always the string "MessageBatch"
  type: "MessageBatch";
  // KSUID (27 chars, alphanumeric)
  id: string;
  attributes: MessageBatchResponseAttributes;
}

export interface MessageBatchResponseAttributes {
  // batch reference (same as from request)
  messageBatchReference: string;
  // The routing plan details used for this batch
  routingPlan: RoutingPlan;
  // Details for each message in the batch
  messages: Array<MessageResponseItem>;
}

export interface RoutingPlan {
  // UUID of the routing plan
  id: string;
  name: string;
  version: string;
  // ISO-8601 date-time when this routing plan version was created
  createdDate: string;
}

export interface MessageResponseItem {
  // Original messageReference from the request
  messageReference: string;
  // KSUID for this message (27 chars, alphanumeric)
  id: string;
}
