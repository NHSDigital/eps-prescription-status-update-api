import {CfnOutput, Duration, RemovalPolicy} from "aws-cdk-lib"
import {
  ManagedPolicy,
  PolicyStatement,
  AccountRootPrincipal,
  PolicyDocument
} from "aws-cdk-lib/aws-iam"
import {Key, Alias} from "aws-cdk-lib/aws-kms"
import {Queue} from "aws-cdk-lib/aws-sqs"
import {Construct} from "constructs"
import {NagSuppressions} from "cdk-nag"

export interface MessagingProps {
  readonly stackName: string
}

export class Messaging extends Construct {
  public constructor(scope: Construct, id: string, props: MessagingProps) {
    super(scope, id)

    // KMS key used to encrypt all four SQS queues.
    // Root-only key policy mirrors SAMtemplates/messaging/main.yaml.
    const notificationSqsKmsKey = new Key(this, "NotificationSQSQueueKMSKey", {
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN,
      policy: new PolicyDocument({
        statements: [
          new PolicyStatement({
            sid: "EnableIAMUserPermissions",
            principals: [new AccountRootPrincipal()],
            actions: ["kms:*"],
            resources: ["*"]
          })
        ]
      })
    })

    new Alias(this, "NotificationSQSQueueKMSKeyAlias", {
      aliasName: `alias/${props.stackName}-NotificationSQSQueueKMSKey`,
      targetKey: notificationSqsKmsKey
    })

    const useNotificationSqsKmsPolicy = new ManagedPolicy(
      this, "UseNotificationSQSQueueKMSKeyPolicy", {
        managedPolicyName: `${props.stackName}-UseNotificationSQSQueueKMSKey`,
        statements: [
          new PolicyStatement({
            sid: "AllowKmsForSqsEncryption",
            actions: [
              "kms:DescribeKey",
              "kms:GenerateDataKey*",
              "kms:Encrypt",
              "kms:Decrypt"
            ],
            resources: [notificationSqsKmsKey.keyArn]
          })
        ]
      })
    NagSuppressions.addResourceSuppressions(useNotificationSqsKmsPolicy, [
      {
        id: "AwsSolutions-IAM5",
        reason: "Wildcard KMS GenerateDataKey action is required by SQS envelope encryption semantics."
      }
    ])

    // ── NHS Notify prescriptions queue pair ──────────────────────────────────

    const nhsNotifyPrescriptionsDlq = new Queue(
      this, "NHSNotifyPrescriptionsDeadLetterQueue", {
        queueName: `${props.stackName}-NHSNotifyPrescriptionsDeadLetter.fifo`,
        fifo: true,
        contentBasedDeduplication: false,
        enforceSSL: true,
        encryptionMasterKey: notificationSqsKmsKey,
        retentionPeriod: Duration.days(7),
        visibilityTimeout: Duration.seconds(300)
      })
    nhsNotifyPrescriptionsDlq.applyRemovalPolicy(RemovalPolicy.RETAIN)

    const nhsNotifyPrescriptionsQueue = new Queue(
      this, "NHSNotifyPrescriptionsSQSQueue", {
        queueName: `${props.stackName}-NHSNotifyPrescriptions.fifo`,
        fifo: true,
        contentBasedDeduplication: false,
        enforceSSL: true,
        encryptionMasterKey: notificationSqsKmsKey,
        retentionPeriod: Duration.days(1),
        visibilityTimeout: Duration.seconds(300),
        deadLetterQueue: {
          queue: nhsNotifyPrescriptionsDlq,
          maxReceiveCount: 5
        }
      })
    nhsNotifyPrescriptionsQueue.applyRemovalPolicy(RemovalPolicy.RETAIN)

    const readNhsNotifyPrescriptionsPolicy = new ManagedPolicy(
      this, "ReadNHSNotifyPrescriptionsSQSQueuePolicy", {
        statements: [
          new PolicyStatement({
            actions: [
              "sqs:ReceiveMessage",
              "sqs:DeleteMessage",
              "sqs:ChangeMessageVisibility",
              "sqs:GetQueueAttributes",
              "sqs:GetQueueUrl",
              "kms:GenerateDataKey",
              "kms:Decrypt"
            ],
            resources: [nhsNotifyPrescriptionsQueue.queueArn]
          })
        ]
      })

    const writeNhsNotifyPrescriptionsPolicy = new ManagedPolicy(
      this, "WriteNHSNotifyPrescriptionsSQSQueuePolicy", {
        managedPolicyName: `${props.stackName}-NHSNotifyPrescriptionsSendMessagePolicy`,
        statements: [
          new PolicyStatement({
            actions: [
              "sqs:SendMessage",
              "sqs:SendMessageBatch",
              "sqs:DeleteMessage",
              "sqs:GetQueueUrl",
              "kms:GenerateDataKey",
              "kms:Decrypt"
            ],
            resources: [nhsNotifyPrescriptionsQueue.queueArn]
          })
        ]
      })

    // ── Post-dated notifications queue pair ──────────────────────────────────

    const postDatedNotificationsDlq = new Queue(
      this, "PostDatedNotificationsDeadLetterQueue", {
        queueName: `${props.stackName}-PostDatedNotificationsDeadLetter.fifo`,
        fifo: true,
        contentBasedDeduplication: false,
        enforceSSL: true,
        encryptionMasterKey: notificationSqsKmsKey,
        retentionPeriod: Duration.days(7),
        visibilityTimeout: Duration.seconds(300)
      })
    postDatedNotificationsDlq.applyRemovalPolicy(RemovalPolicy.RETAIN)

    const postDatedNotificationsQueue = new Queue(
      this, "PostDatedNotificationsSQSQueue", {
        queueName: `${props.stackName}-PostDatedNotifications.fifo`,
        fifo: true,
        contentBasedDeduplication: false,
        enforceSSL: true,
        encryptionMasterKey: notificationSqsKmsKey,
        retentionPeriod: Duration.days(1),
        visibilityTimeout: Duration.seconds(300),
        deadLetterQueue: {
          queue: postDatedNotificationsDlq,
          maxReceiveCount: 166 // ~999 hours / 6-hour delay steps
        }
      })
    postDatedNotificationsQueue.applyRemovalPolicy(RemovalPolicy.RETAIN)

    const readPostDatedNotificationsPolicy = new ManagedPolicy(
      this, "ReadPostDatedNotificationsSQSQueuePolicy", {
        statements: [
          new PolicyStatement({
            actions: [
              "sqs:ReceiveMessage",
              "sqs:DeleteMessage",
              "sqs:ChangeMessageVisibility",
              "sqs:GetQueueAttributes",
              "sqs:GetQueueUrl",
              "kms:GenerateDataKey",
              "kms:Decrypt"
            ],
            resources: [postDatedNotificationsQueue.queueArn]
          })
        ]
      })

    const writePostDatedNotificationsPolicy = new ManagedPolicy(
      this, "WritePostDatedNotificationsSQSQueuePolicy", {
        managedPolicyName: `${props.stackName}-PostDatedNotificationsSendMessagePolicy`,
        statements: [
          new PolicyStatement({
            actions: [
              "sqs:SendMessage",
              "sqs:SendMessageBatch",
              "sqs:DeleteMessage",
              "sqs:GetQueueUrl",
              "kms:GenerateDataKey",
              "kms:Decrypt"
            ],
            resources: [postDatedNotificationsQueue.queueArn]
          })
        ]
      })

    // Exports — names must match exactly what Functions.ts imports via Fn.importValue
    new CfnOutput(this, "NHSNotifyPrescriptionsSQSQueueUrlOutput", {
      description: "The URL of the NHS Notify Prescriptions SQS Queue",
      value: nhsNotifyPrescriptionsQueue.queueUrl,
      exportName: `${props.stackName}-NHSNotifyPrescriptionsSQSQueueUrl`
    })
    new CfnOutput(this, "NHSNotifyPrescriptionsSQSQueueArnOutput", {
      description: "The ARN of the NHS Notify Prescriptions SQS Queue",
      value: nhsNotifyPrescriptionsQueue.queueArn,
      exportName: `${props.stackName}-NHSNotifyPrescriptionsSQSQueueArn`
    })
    new CfnOutput(this, "NHSNotifyPrescriptionsDeadLetterQueueArnOutput", {
      description: "The ARN of the NHS Notify Prescriptions Dead Letter Queue",
      value: nhsNotifyPrescriptionsDlq.queueArn,
      exportName: `${props.stackName}-NHSNotifyPrescriptionsDeadLetterQueueArn`
    })
    new CfnOutput(this, "ReadNHSNotifyPrescriptionsSQSQueuePolicyArnOutput", {
      description: "ARN of policy granting permission to read the prescriptions queue",
      value: readNhsNotifyPrescriptionsPolicy.managedPolicyArn,
      exportName: `${props.stackName}-ReadNHSNotifyPrescriptionsSQSQueuePolicyArn`
    })
    new CfnOutput(this, "WriteNHSNotifyPrescriptionsSQSQueuePolicyArnOutput", {
      description: "ARN of policy granting permission to write to the prescriptions queue",
      value: writeNhsNotifyPrescriptionsPolicy.managedPolicyArn,
      exportName: `${props.stackName}-WriteNHSNotifyPrescriptionsSQSQueuePolicyArn`
    })
    new CfnOutput(this, "PostDatedNotificationsSQSQueueUrlOutput", {
      description: "The URL of the Post-Dated Notifications SQS Queue",
      value: postDatedNotificationsQueue.queueUrl,
      exportName: `${props.stackName}-PostDatedNotificationsSQSQueueUrl`
    })
    new CfnOutput(this, "PostDatedNotificationsSQSQueueArnOutput", {
      description: "The ARN of the Post-Dated Notifications SQS Queue",
      value: postDatedNotificationsQueue.queueArn,
      exportName: `${props.stackName}-PostDatedNotificationsSQSQueueArn`
    })
    new CfnOutput(this, "PostDatedNotificationsDeadLetterQueueArnOutput", {
      description: "The ARN of the Post-Dated Notifications Dead Letter Queue",
      value: postDatedNotificationsDlq.queueArn,
      exportName: `${props.stackName}-PostDatedNotificationsDeadLetterQueueArn`
    })
    new CfnOutput(this, "ReadPostDatedNotificationsSQSQueuePolicyArnOutput", {
      description: "ARN of policy granting permission to read the post-dated queue",
      value: readPostDatedNotificationsPolicy.managedPolicyArn,
      exportName: `${props.stackName}-ReadPostDatedNotificationsSQSQueuePolicyArn`
    })
    new CfnOutput(this, "WritePostDatedNotificationsSQSQueuePolicyArnOutput", {
      description: "ARN of policy granting permission to write to the post-dated queue",
      value: writePostDatedNotificationsPolicy.managedPolicyArn,
      exportName: `${props.stackName}-WritePostDatedNotificationsSQSQueuePolicyArn`
    })
    new CfnOutput(this, "UseNotificationSQSQueueKMSKeyPolicyArnOutput", {
      description: "ARN of managed policy granting prescriptions queue KMS usage",
      value: useNotificationSqsKmsPolicy.managedPolicyArn,
      exportName: `${props.stackName}-UseNotificationSQSQueueKMSKeyPolicyArn`
    })
  }
}
