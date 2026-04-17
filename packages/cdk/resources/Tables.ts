import {CfnOutput, RemovalPolicy, Stack} from "aws-cdk-lib"
import {
  AttributeType,
  BillingMode,
  ProjectionType,
  Table,
  TableEncryption
} from "aws-cdk-lib/aws-dynamodb"
import {
  ManagedPolicy,
  PolicyStatement,
  AnyPrincipal,
  AccountRootPrincipal,
  PolicyDocument,
  Role,
  ServicePrincipal
} from "aws-cdk-lib/aws-iam"
import {Key, Alias} from "aws-cdk-lib/aws-kms"
import {Duration} from "aws-cdk-lib"
import {Construct} from "constructs"
import {NagSuppressions} from "cdk-nag"

// Autoscaling constants — mirrored from SAMtemplates/tables/main.yaml defaults
const MIN_WRITE_PRESCRIPTION_STATUS_UPDATES_CAPACITY = 50
const MAX_WRITE_PRESCRIPTION_STATUS_UPDATES_CAPACITY = 600
const MIN_WRITE_PRESCRIPTION_NOTIFICATION_STATES_CAPACITY = 50
const MAX_WRITE_PRESCRIPTION_NOTIFICATION_STATES_CAPACITY = 600

export interface TablesProps {
  readonly stackName: string
  readonly enableDynamoDBAutoScaling: boolean
  /** When true, sets NHSE-Enable-Backup: True on PrescriptionStatusUpdatesTable */
  readonly enableBackup: boolean
}

export class Tables extends Construct {
  public constructor(scope: Construct, id: string, props: TablesProps) {
    super(scope, id)

    const {account, region} = Stack.of(this)

    const dynamoDbScalingRolePolicy = props.enableDynamoDBAutoScaling
      ? new ManagedPolicy(this, "DynamoDbScalingRolePolicy", {
        statements: [
          new PolicyStatement({
            actions: [
              "dynamodb:DescribeTable",
              "dynamodb:UpdateTable"
            ],
            resources: [
              `arn:aws:dynamodb:${region}:${account}:table/${props.stackName}-*`
            ]
          }),
          new PolicyStatement({
            actions: [
              "cloudwatch:PutMetricAlarm",
              "cloudwatch:DescribeAlarms",
              "cloudwatch:DeleteAlarms"
            ],
            resources: ["*"]
          })
        ]
      })
      : undefined

    if (dynamoDbScalingRolePolicy) {
      NagSuppressions.addResourceSuppressions(dynamoDbScalingRolePolicy, [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "Stack-scoped wildcard is required for autoscaling permissions " +
            "across stateful DynamoDB tables and indexes."
        }
      ])
    }

    const dynamoDbScalingRole = props.enableDynamoDBAutoScaling
      ? new Role(this, "DynamoDbScalingRole", {
        assumedBy: new ServicePrincipal("dynamodb.application-autoscaling.amazonaws.com"),
        managedPolicies: dynamoDbScalingRolePolicy ? [dynamoDbScalingRolePolicy] : []
      })
      : undefined

    // ── Shared autoscaling IAM role ──────────────────────────────────────────
    // Used by ApplicationAutoScaling when enableDynamoDBAutoScaling is true.
    // Equivalent to DynamoDbScalingRole in SAMtemplates/tables/main.yaml.
    // CDK manages this automatically via table.autoScaleWriteCapacity() but we
    // reference the tables explicitly to keep the policy document paritymatched.

    // ── PrescriptionStatusUpdates table ─────────────────────────────────────

    const prescriptionStatusUpdatesKey = new Key(
      this, "PrescriptionStatusUpdatesKMSKey", {
        enableKeyRotation: true,
        removalPolicy: RemovalPolicy.RETAIN,
        policy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              sid: "Enable IAM User Permissions",
              principals: [new AccountRootPrincipal()],
              actions: ["kms:*"],
              resources: ["*"]
            }),
            new PolicyStatement({
              sid: "Enable read only decrypt",
              principals: [new AnyPrincipal()],
              actions: ["kms:DescribeKey", "kms:Decrypt"],
              resources: ["*"],
              conditions: {
                ArnLike: {
                  "aws:PrincipalArn":
                    `arn:aws:iam::${account}:role/aws-reserved/sso.amazonaws.com/${region}` +
                    "/AWSReservedSSO_ReadOnly*"
                }
              }
            })
          ]
        })
      })

    new Alias(this, "PrescriptionStatusUpdatesKMSKeyAlias", {
      aliasName: `alias/${props.stackName}-PrescriptionStatusUpdatesKMSKeyAlias`,
      targetKey: prescriptionStatusUpdatesKey
    })

    const usePrescriptionStatusUpdatesKmsKeyPolicy = new ManagedPolicy(
      this, "UsePrescriptionStatusUpdatesKMSKeyPolicy", {
        statements: [
          new PolicyStatement({
            actions: [
              "kms:DescribeKey",
              "kms:GenerateDataKey*",
              "kms:Encrypt",
              "kms:ReEncrypt*",
              "kms:Decrypt"
            ],
            resources: [prescriptionStatusUpdatesKey.keyArn]
          })
        ]
      })
    NagSuppressions.addResourceSuppressions(usePrescriptionStatusUpdatesKmsKeyPolicy, [
      {
        id: "AwsSolutions-IAM5",
        reason: "Wildcard KMS actions are required for DynamoDB encryption/decryption flows."
      }
    ])

    const prescriptionStatusUpdatesTableName =
      `${props.stackName}-PrescriptionStatusUpdates`

    const prescriptionStatusUpdatesTableProps = {
      tableName: prescriptionStatusUpdatesTableName,
      partitionKey: {name: "PrescriptionID", type: AttributeType.STRING},
      sortKey: {name: "TaskID", type: AttributeType.STRING},
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true
      },
      encryption: TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: prescriptionStatusUpdatesKey,
      timeToLiveAttribute: "ExpiryTime",
      removalPolicy: RemovalPolicy.RETAIN,
      billingMode: props.enableDynamoDBAutoScaling
        ? BillingMode.PROVISIONED
        : BillingMode.PAY_PER_REQUEST,
      ...(props.enableDynamoDBAutoScaling
        ? {
          readCapacity: 1,
          writeCapacity: MIN_WRITE_PRESCRIPTION_STATUS_UPDATES_CAPACITY
        }
        : {})
    }

    const prescriptionStatusUpdatesTable = new Table(
      this, "PrescriptionStatusUpdatesTable",
      prescriptionStatusUpdatesTableProps
    )

    prescriptionStatusUpdatesTable.addGlobalSecondaryIndex({
      indexName: "PharmacyODSCodePrescriptionIDIndex",
      partitionKey: {name: "PharmacyODSCode", type: AttributeType.STRING},
      sortKey: {name: "PrescriptionID", type: AttributeType.STRING},
      projectionType: ProjectionType.INCLUDE,
      nonKeyAttributes: [
        "PatientNHSNumber", "LineItemID", "TerminalStatus", "LastModified", "Status"
      ],
      ...(props.enableDynamoDBAutoScaling
        ? {
          readCapacity: 1,
          writeCapacity: MIN_WRITE_PRESCRIPTION_STATUS_UPDATES_CAPACITY
        }
        : {})
    })

    prescriptionStatusUpdatesTable.addGlobalSecondaryIndex({
      indexName: "PatientNHSNumberIndex",
      partitionKey: {name: "PatientNHSNumber", type: AttributeType.STRING},
      projectionType: ProjectionType.KEYS_ONLY,
      ...(props.enableDynamoDBAutoScaling
        ? {
          readCapacity: 1,
          writeCapacity: MIN_WRITE_PRESCRIPTION_STATUS_UPDATES_CAPACITY
        }
        : {})
    })

    // TODO: Remove this index when post-dated prescriptions are deprecated.
    prescriptionStatusUpdatesTable.addGlobalSecondaryIndex({
      indexName: "PrescriptionIDPostDatedIndex",
      partitionKey: {name: "PrescriptionID", type: AttributeType.STRING},
      projectionType: ProjectionType.INCLUDE,
      nonKeyAttributes: [
        "PatientNHSNumber", "LineItemID", "TerminalStatus", "LastModified",
        "Status", "PostDatedLastModifiedSetAt"
      ],
      ...(props.enableDynamoDBAutoScaling
        ? {
          readCapacity: 1,
          writeCapacity: MIN_WRITE_PRESCRIPTION_STATUS_UPDATES_CAPACITY
        }
        : {})
    })

    // TODO: Remove PostDatedLastModifiedSetAt attribute when post-dated prescriptions are deprecated.
    prescriptionStatusUpdatesTable.addGlobalSecondaryIndex({
      indexName: "PharmacyODSCodePrescriptionIDIndexIncPostDated",
      partitionKey: {name: "PharmacyODSCode", type: AttributeType.STRING},
      sortKey: {name: "PrescriptionID", type: AttributeType.STRING},
      projectionType: ProjectionType.INCLUDE,
      nonKeyAttributes: [
        "PatientNHSNumber", "LineItemID", "TerminalStatus", "LastModified",
        "Status", "PostDatedLastModifiedSetAt"
      ],
      ...(props.enableDynamoDBAutoScaling
        ? {
          readCapacity: 1,
          writeCapacity: MIN_WRITE_PRESCRIPTION_STATUS_UPDATES_CAPACITY
        }
        : {})
    })

    prescriptionStatusUpdatesTable.applyRemovalPolicy(RemovalPolicy.RETAIN)

    // Tags on the underlying CfnTable (CDK Tags API applies to all constructs)
    if (prescriptionStatusUpdatesTable.node.defaultChild) {
      (prescriptionStatusUpdatesTable.node.defaultChild as import("aws-cdk-lib/aws-dynamodb").CfnTable)
        .addPropertyOverride("Tags", [
          {Key: "EPS-Tablename", Value: "PrescriptionStatusUpdates"},
          {Key: "NHSE-Enable-Backup", Value: props.enableBackup ? "True" : "False"}
        ])
    }

    if (props.enableDynamoDBAutoScaling) {
      const scalingRoleOptions = dynamoDbScalingRole
        ? {role: dynamoDbScalingRole}
        : {}

      const tableWriteScaling = prescriptionStatusUpdatesTable.autoScaleWriteCapacity({
        minCapacity: MIN_WRITE_PRESCRIPTION_STATUS_UPDATES_CAPACITY,
        maxCapacity: MAX_WRITE_PRESCRIPTION_STATUS_UPDATES_CAPACITY,
        ...scalingRoleOptions
      })
      tableWriteScaling.scaleOnUtilization({
        targetUtilizationPercent: 50,
        scaleInCooldown: Duration.seconds(600),
        scaleOutCooldown: Duration.seconds(0)
      })

      const tableReadScaling = prescriptionStatusUpdatesTable.autoScaleReadCapacity({
        minCapacity: 1,
        maxCapacity: 100,
        ...scalingRoleOptions
      })
      tableReadScaling.scaleOnUtilization({
        targetUtilizationPercent: 70,
        scaleInCooldown: Duration.seconds(60),
        scaleOutCooldown: Duration.seconds(60)
      })

      const pharmacyIndexWriteScaling =
        prescriptionStatusUpdatesTable.autoScaleGlobalSecondaryIndexWriteCapacity(
          "PharmacyODSCodePrescriptionIDIndex", {
            minCapacity: MIN_WRITE_PRESCRIPTION_STATUS_UPDATES_CAPACITY,
            maxCapacity: MAX_WRITE_PRESCRIPTION_STATUS_UPDATES_CAPACITY,
            ...scalingRoleOptions
          })
      pharmacyIndexWriteScaling.scaleOnUtilization({
        targetUtilizationPercent: 50,
        scaleInCooldown: Duration.seconds(600),
        scaleOutCooldown: Duration.seconds(0)
      })

      const pharmacyIndexReadScaling =
        prescriptionStatusUpdatesTable.autoScaleGlobalSecondaryIndexReadCapacity(
          "PharmacyODSCodePrescriptionIDIndex", {
            minCapacity: 1,
            maxCapacity: 100,
            ...scalingRoleOptions
          })
      pharmacyIndexReadScaling.scaleOnUtilization({
        targetUtilizationPercent: 70,
        scaleInCooldown: Duration.seconds(60),
        scaleOutCooldown: Duration.seconds(60)
      })

      const nhsNumberIndexWriteScaling =
        prescriptionStatusUpdatesTable.autoScaleGlobalSecondaryIndexWriteCapacity(
          "PatientNHSNumberIndex", {
            minCapacity: MIN_WRITE_PRESCRIPTION_STATUS_UPDATES_CAPACITY,
            maxCapacity: MAX_WRITE_PRESCRIPTION_STATUS_UPDATES_CAPACITY,
            ...scalingRoleOptions
          })
      nhsNumberIndexWriteScaling.scaleOnUtilization({
        targetUtilizationPercent: 50,
        scaleInCooldown: Duration.seconds(600),
        scaleOutCooldown: Duration.seconds(0)
      })

      const nhsNumberIndexReadScaling =
        prescriptionStatusUpdatesTable.autoScaleGlobalSecondaryIndexReadCapacity(
          "PatientNHSNumberIndex", {
            minCapacity: 1,
            maxCapacity: 100,
            ...scalingRoleOptions
          })
      nhsNumberIndexReadScaling.scaleOnUtilization({
        targetUtilizationPercent: 70,
        scaleInCooldown: Duration.seconds(60),
        scaleOutCooldown: Duration.seconds(60)
      })

      const pharmacyIndexIncPostDatedWriteScaling =
        prescriptionStatusUpdatesTable.autoScaleGlobalSecondaryIndexWriteCapacity(
          "PharmacyODSCodePrescriptionIDIndexIncPostDated", {
            minCapacity: MIN_WRITE_PRESCRIPTION_STATUS_UPDATES_CAPACITY,
            maxCapacity: MAX_WRITE_PRESCRIPTION_STATUS_UPDATES_CAPACITY,
            ...scalingRoleOptions
          })
      pharmacyIndexIncPostDatedWriteScaling.scaleOnUtilization({
        targetUtilizationPercent: 50,
        scaleInCooldown: Duration.seconds(600),
        scaleOutCooldown: Duration.seconds(0)
      })

      const pharmacyIndexIncPostDatedReadScaling =
        prescriptionStatusUpdatesTable.autoScaleGlobalSecondaryIndexReadCapacity(
          "PharmacyODSCodePrescriptionIDIndexIncPostDated", {
            minCapacity: 1,
            maxCapacity: 100,
            ...scalingRoleOptions
          })
      pharmacyIndexIncPostDatedReadScaling.scaleOnUtilization({
        targetUtilizationPercent: 70,
        scaleInCooldown: Duration.seconds(60),
        scaleOutCooldown: Duration.seconds(60)
      })
    }

    const prescriptionStatusUpdatesReadPolicy = new ManagedPolicy(
      this, "PrescriptionStatusUpdatesTableReadPolicy", {
        statements: [
          new PolicyStatement({
            actions: [
              "dynamodb:GetItem",
              "dynamodb:BatchGetItem",
              "dynamodb:Scan",
              "dynamodb:Query",
              "dynamodb:ConditionCheckItem",
              "dynamodb:DescribeTable"
            ],
            resources: [
              prescriptionStatusUpdatesTable.tableArn,
              `${prescriptionStatusUpdatesTable.tableArn}/index/*`
            ]
          })
        ]
      })
    NagSuppressions.addResourceSuppressions(prescriptionStatusUpdatesReadPolicy, [
      {
        id: "AwsSolutions-IAM5",
        reason: "Wildcard index ARN is required to permit Query/Scan across all GSIs."
      }
    ])

    const prescriptionStatusUpdatesWritePolicy = new ManagedPolicy(
      this, "PrescriptionStatusUpdatesTableWritePolicy", {
        statements: [
          new PolicyStatement({
            actions: [
              "dynamodb:PutItem",
              "dynamodb:BatchWriteItem",
              "dynamodb:UpdateItem",
              "dynamodb:DeleteItem"
            ],
            resources: [
              prescriptionStatusUpdatesTable.tableArn,
              `${prescriptionStatusUpdatesTable.tableArn}/index/*`
            ]
          })
        ]
      })
    NagSuppressions.addResourceSuppressions(prescriptionStatusUpdatesWritePolicy, [
      {
        id: "AwsSolutions-IAM5",
        reason: "Wildcard index ARN is required to permit write operations targeting GSIs."
      }
    ])

    // ── PrescriptionNotificationStatesV1 table ───────────────────────────────

    const prescriptionNotificationStatesKey = new Key(
      this, "PrescriptionNotificationStatesKMSKey", {
        enableKeyRotation: true,
        removalPolicy: RemovalPolicy.RETAIN,
        policy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              sid: "Enable IAM User Permissions",
              principals: [new AccountRootPrincipal()],
              actions: ["kms:*"],
              resources: ["*"]
            }),
            new PolicyStatement({
              sid: "Enable read only decrypt",
              principals: [new AnyPrincipal()],
              actions: ["kms:DescribeKey", "kms:Decrypt"],
              resources: ["*"],
              conditions: {
                ArnLike: {
                  "aws:PrincipalArn":
                    `arn:aws:iam::${account}:role/aws-reserved/sso.amazonaws.com/${region}` +
                    "/AWSReservedSSO_ReadOnly*"
                }
              }
            })
          ]
        })
      })

    new Alias(this, "PrescriptionNotificationStatesKMSKeyAlias", {
      aliasName: `alias/${props.stackName}-PrescriptionNotificationStatesKMSKeyAlias`,
      targetKey: prescriptionNotificationStatesKey
    })

    const usePrescriptionNotificationStatesKmsKeyPolicy = new ManagedPolicy(
      this, "UsePrescriptionNotificationStatesKMSKeyPolicy", {
        statements: [
          new PolicyStatement({
            actions: [
              "kms:DescribeKey",
              "kms:GenerateDataKey*",
              "kms:Encrypt",
              "kms:ReEncrypt*",
              "kms:Decrypt"
            ],
            resources: [prescriptionNotificationStatesKey.keyArn]
          })
        ]
      })
    NagSuppressions.addResourceSuppressions(usePrescriptionNotificationStatesKmsKeyPolicy, [
      {
        id: "AwsSolutions-IAM5",
        reason: "Wildcard KMS actions are required for DynamoDB encryption/decryption flows."
      }
    ])

    const prescriptionNotificationStatesTableName =
      `${props.stackName}-PrescriptionNotificationStatesV1`

    const prescriptionNotificationStatesTable = new Table(
      this, "PrescriptionNotificationStatesTableV1", {
        tableName: prescriptionNotificationStatesTableName,
        partitionKey: {name: "NHSNumber", type: AttributeType.STRING},
        sortKey: {name: "RequestId", type: AttributeType.STRING},
        pointInTimeRecoverySpecification: {
          pointInTimeRecoveryEnabled: true
        },
        encryption: TableEncryption.CUSTOMER_MANAGED,
        encryptionKey: prescriptionNotificationStatesKey,
        timeToLiveAttribute: "ExpiryTime",
        removalPolicy: RemovalPolicy.RETAIN,
        billingMode: props.enableDynamoDBAutoScaling
          ? BillingMode.PROVISIONED
          : BillingMode.PAY_PER_REQUEST,
        ...(props.enableDynamoDBAutoScaling
          ? {
            readCapacity: 1,
            writeCapacity: MIN_WRITE_PRESCRIPTION_NOTIFICATION_STATES_CAPACITY
          }
          : {})
      })

    prescriptionNotificationStatesTable.addGlobalSecondaryIndex({
      indexName: "PatientPharmacyIndex",
      partitionKey: {name: "NHSNumber", type: AttributeType.STRING},
      sortKey: {name: "ODSCode", type: AttributeType.STRING},
      projectionType: ProjectionType.ALL,
      ...(props.enableDynamoDBAutoScaling
        ? {
          readCapacity: 1,
          writeCapacity: MIN_WRITE_PRESCRIPTION_NOTIFICATION_STATES_CAPACITY
        }
        : {})
    })

    prescriptionNotificationStatesTable.addGlobalSecondaryIndex({
      indexName: "NotifyMessageIDIndex",
      partitionKey: {name: "NotifyMessageID", type: AttributeType.STRING},
      projectionType: ProjectionType.ALL,
      ...(props.enableDynamoDBAutoScaling
        ? {
          readCapacity: 1,
          writeCapacity: MIN_WRITE_PRESCRIPTION_NOTIFICATION_STATES_CAPACITY
        }
        : {})
    })

    prescriptionNotificationStatesTable.applyRemovalPolicy(RemovalPolicy.RETAIN)

    // NHSE-Enable-Backup is hardcoded False for the notification states table (matches SAM)
    if (prescriptionNotificationStatesTable.node.defaultChild) {
      (prescriptionNotificationStatesTable.node.defaultChild as import("aws-cdk-lib/aws-dynamodb").CfnTable)
        .addPropertyOverride("Tags", [
          {Key: "NHSE-Enable-Backup", Value: "False"}
        ])
    }

    if (props.enableDynamoDBAutoScaling) {
      const scalingRoleOptions = dynamoDbScalingRole
        ? {role: dynamoDbScalingRole}
        : {}

      const notifStatesTableWriteScaling =
        prescriptionNotificationStatesTable.autoScaleWriteCapacity({
          minCapacity: MIN_WRITE_PRESCRIPTION_NOTIFICATION_STATES_CAPACITY,
          maxCapacity: MAX_WRITE_PRESCRIPTION_NOTIFICATION_STATES_CAPACITY,
          ...scalingRoleOptions
        })
      notifStatesTableWriteScaling.scaleOnUtilization({
        targetUtilizationPercent: 50,
        scaleInCooldown: Duration.seconds(600),
        scaleOutCooldown: Duration.seconds(0)
      })

      const notifStatesTableReadScaling =
        prescriptionNotificationStatesTable.autoScaleReadCapacity({
          minCapacity: 1,
          maxCapacity: 100,
          ...scalingRoleOptions
        })
      notifStatesTableReadScaling.scaleOnUtilization({
        targetUtilizationPercent: 70,
        scaleInCooldown: Duration.seconds(60),
        scaleOutCooldown: Duration.seconds(60)
      })

      const patientPharmacyIndexWriteScaling =
        prescriptionNotificationStatesTable.autoScaleGlobalSecondaryIndexWriteCapacity(
          "PatientPharmacyIndex", {
            minCapacity: MIN_WRITE_PRESCRIPTION_NOTIFICATION_STATES_CAPACITY,
            maxCapacity: MAX_WRITE_PRESCRIPTION_NOTIFICATION_STATES_CAPACITY,
            ...scalingRoleOptions
          })
      patientPharmacyIndexWriteScaling.scaleOnUtilization({
        targetUtilizationPercent: 50,
        scaleInCooldown: Duration.seconds(600),
        scaleOutCooldown: Duration.seconds(0)
      })

      const patientPharmacyIndexReadScaling =
        prescriptionNotificationStatesTable.autoScaleGlobalSecondaryIndexReadCapacity(
          "PatientPharmacyIndex", {
            minCapacity: 1,
            maxCapacity: 100,
            ...scalingRoleOptions
          })
      patientPharmacyIndexReadScaling.scaleOnUtilization({
        targetUtilizationPercent: 70,
        scaleInCooldown: Duration.seconds(60),
        scaleOutCooldown: Duration.seconds(60)
      })

      const notifyMessageIdIndexWriteScaling =
        prescriptionNotificationStatesTable.autoScaleGlobalSecondaryIndexWriteCapacity(
          "NotifyMessageIDIndex", {
            minCapacity: MIN_WRITE_PRESCRIPTION_NOTIFICATION_STATES_CAPACITY,
            maxCapacity: MAX_WRITE_PRESCRIPTION_NOTIFICATION_STATES_CAPACITY,
            ...scalingRoleOptions
          })
      notifyMessageIdIndexWriteScaling.scaleOnUtilization({
        targetUtilizationPercent: 50,
        scaleInCooldown: Duration.seconds(600),
        scaleOutCooldown: Duration.seconds(0)
      })

      const notifyMessageIdIndexReadScaling =
        prescriptionNotificationStatesTable.autoScaleGlobalSecondaryIndexReadCapacity(
          "NotifyMessageIDIndex", {
            minCapacity: 1,
            maxCapacity: 100,
            ...scalingRoleOptions
          })
      notifyMessageIdIndexReadScaling.scaleOnUtilization({
        targetUtilizationPercent: 70,
        scaleInCooldown: Duration.seconds(60),
        scaleOutCooldown: Duration.seconds(60)
      })
    }

    const prescriptionNotificationStatesReadPolicy = new ManagedPolicy(
      this, "PrescriptionNotificationStatesTableReadPolicy", {
        statements: [
          new PolicyStatement({
            actions: [
              "dynamodb:GetItem",
              "dynamodb:BatchGetItem",
              "dynamodb:Scan",
              "dynamodb:Query",
              "dynamodb:ConditionCheckItem",
              "dynamodb:DescribeTable"
            ],
            resources: [
              prescriptionNotificationStatesTable.tableArn,
              `${prescriptionNotificationStatesTable.tableArn}/index/*`
            ]
          })
        ]
      })
    NagSuppressions.addResourceSuppressions(prescriptionNotificationStatesReadPolicy, [
      {
        id: "AwsSolutions-IAM5",
        reason: "Wildcard index ARN is required to permit Query/Scan across all GSIs."
      }
    ])

    const prescriptionNotificationStatesWritePolicy = new ManagedPolicy(
      this, "PrescriptionNotificationStatesTableWritePolicy", {
        statements: [
          new PolicyStatement({
            actions: [
              "dynamodb:PutItem",
              "dynamodb:BatchWriteItem",
              "dynamodb:UpdateItem",
              "dynamodb:DeleteItem"
            ],
            resources: [
              prescriptionNotificationStatesTable.tableArn,
              `${prescriptionNotificationStatesTable.tableArn}/index/*`
            ]
          })
        ]
      })
    NagSuppressions.addResourceSuppressions(prescriptionNotificationStatesWritePolicy, [
      {
        id: "AwsSolutions-IAM5",
        reason: "Wildcard index ARN is required to permit write operations targeting GSIs."
      }
    ])

    // ── Exports ──────────────────────────────────────────────────────────────
    // Names must match exactly what Functions.ts imports via Fn.importValue.

    new CfnOutput(this, "UsePrescriptionStatusUpdatesKMSKeyPolicyArnOutput", {
      description: "Use KMS key policy ARN for PrescriptionStatusUpdates",
      value: usePrescriptionStatusUpdatesKmsKeyPolicy.managedPolicyArn,
      exportName: `${props.stackName}:tables:UsePrescriptionStatusUpdatesKMSKeyPolicyArn`
    })
    new CfnOutput(this, "PrescriptionStatusUpdatesTableReadPolicyArnOutput", {
      description: "Table read policy ARN for PrescriptionStatusUpdates",
      value: prescriptionStatusUpdatesReadPolicy.managedPolicyArn,
      exportName: `${props.stackName}:tables:${prescriptionStatusUpdatesTableName}:TableReadPolicyArn`
    })
    new CfnOutput(this, "PrescriptionStatusUpdatesTableWritePolicyArnOutput", {
      description: "Table write policy ARN for PrescriptionStatusUpdates",
      value: prescriptionStatusUpdatesWritePolicy.managedPolicyArn,
      exportName: `${props.stackName}:tables:${prescriptionStatusUpdatesTableName}:TableWritePolicyArn`
    })
    new CfnOutput(this, "UsePrescriptionNotificationStatesKMSKeyPolicyArnOutput", {
      description: "Use KMS key policy ARN for PrescriptionNotificationStates",
      value: usePrescriptionNotificationStatesKmsKeyPolicy.managedPolicyArn,
      exportName: `${props.stackName}:tables:UsePrescriptionNotificationStatesKMSKeyPolicyArn`
    })
    new CfnOutput(this, "PrescriptionNotificationStatesTableReadPolicyArnOutput", {
      description: "Table read policy ARN for PrescriptionNotificationStatesV1",
      value: prescriptionNotificationStatesReadPolicy.managedPolicyArn,
      exportName: `${props.stackName}:tables:${prescriptionNotificationStatesTableName}:TableReadPolicyArn`
    })
    new CfnOutput(this, "PrescriptionNotificationStatesTableWritePolicyArnOutput", {
      description: "Table write policy ARN for PrescriptionNotificationStatesV1",
      value: prescriptionNotificationStatesWritePolicy.managedPolicyArn,
      exportName: `${props.stackName}:tables:${prescriptionNotificationStatesTableName}:TableWritePolicyArn`
    })
  }
}
