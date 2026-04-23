import {Fn} from "aws-cdk-lib"
import {CfnSchedule} from "aws-cdk-lib/aws-scheduler"
import {
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal
} from "aws-cdk-lib/aws-iam"
import {Rule} from "aws-cdk-lib/aws-events"
import {LambdaFunction as LambdaFunctionTarget} from "aws-cdk-lib/aws-events-targets"
import {IFunction} from "aws-cdk-lib/aws-lambda"
import {Construct} from "constructs"
import {TypescriptLambdaFunction} from "@nhsdigital/eps-cdk-constructs"
import {NagSuppressions} from "cdk-nag"
import {resolve} from "node:path"

export interface FunctionsProps {
  readonly stackName: string
  readonly samStackName: string
  readonly version: string
  readonly commitId: string
  readonly logRetentionInDays: number
  readonly logLevel: string
  readonly environment: string
  readonly enablePostDatedNotifications: string
  readonly requireApplicationName: string
  readonly deployCheckPrescriptionStatusUpdate: boolean
  readonly enableBackup: boolean
}

const baseDir = resolve(__dirname, "../../..")

export class Functions extends Construct {
  public readonly functions: {
    readonly updatePrescriptionStatus: TypescriptLambdaFunction
    readonly convertRequestToFhirFormat: TypescriptLambdaFunction
    readonly getStatusUpdates: TypescriptLambdaFunction
    readonly status: TypescriptLambdaFunction
    readonly capabilityStatement: TypescriptLambdaFunction
    readonly nhsNotifyUpdateCallback: TypescriptLambdaFunction
    readonly notifyProcessor: TypescriptLambdaFunction
    readonly postDatedNotifyLambda: TypescriptLambdaFunction
    readonly checkPrescriptionStatusUpdates?: TypescriptLambdaFunction
  }

  public constructor(scope: Construct, id: string, props: FunctionsProps) {
    super(scope, id)

    const sam = props.samStackName

    // Table names derived from SAM stack naming convention (not exported)
    const prescriptionStatusUpdatesTableName = `${sam}-PrescriptionStatusUpdates`
    const prescriptionNotificationStatesTableName = `${sam}-PrescriptionNotificationStatesV1`

    // Cross-stack imports from SAM stateful stack — tables
    const tableWritePolicy = ManagedPolicy.fromManagedPolicyArn(
      this, "TableWritePolicy",
      Fn.importValue(`${sam}:tables:${prescriptionStatusUpdatesTableName}:TableWritePolicyArn`)
    )
    const tableReadPolicy = ManagedPolicy.fromManagedPolicyArn(
      this, "TableReadPolicy",
      Fn.importValue(`${sam}:tables:${prescriptionStatusUpdatesTableName}:TableReadPolicyArn`)
    )
    const tableKmsPolicy = ManagedPolicy.fromManagedPolicyArn(
      this, "TableKmsPolicy",
      Fn.importValue(`${sam}:tables:UsePrescriptionStatusUpdatesKMSKeyPolicyArn`)
    )
    const notificationStatesReadPolicy = ManagedPolicy.fromManagedPolicyArn(
      this, "NotificationStatesTableReadPolicy",
      Fn.importValue(
        `${sam}:tables:${prescriptionNotificationStatesTableName}:TableReadPolicyArn`
      )
    )
    const notificationStatesWritePolicy = ManagedPolicy.fromManagedPolicyArn(
      this, "NotificationStatesTableWritePolicy",
      Fn.importValue(
        `${sam}:tables:${prescriptionNotificationStatesTableName}:TableWritePolicyArn`
      )
    )
    const notificationStatesKmsPolicy = ManagedPolicy.fromManagedPolicyArn(
      this, "NotificationStatesKmsPolicy",
      Fn.importValue(`${sam}:tables:UsePrescriptionNotificationStatesKMSKeyPolicyArn`)
    )

    // Cross-stack imports from SAM stateful stack — messaging
    const notificationSqsKmsPolicy = ManagedPolicy.fromManagedPolicyArn(
      this, "NotificationSqsKmsPolicy",
      Fn.importValue(`${sam}-UseNotificationSQSQueueKMSKeyPolicyArn`)
    )
    const writeNotifySqsPolicy = ManagedPolicy.fromManagedPolicyArn(
      this, "WriteNotifySqsPolicy",
      Fn.importValue(`${sam}-WriteNHSNotifyPrescriptionsSQSQueuePolicyArn`)
    )
    const readNotifySqsPolicy = ManagedPolicy.fromManagedPolicyArn(
      this, "ReadNotifySqsPolicy",
      Fn.importValue(`${sam}-ReadNHSNotifyPrescriptionsSQSQueuePolicyArn`)
    )
    const writePostDatedSqsPolicy = ManagedPolicy.fromManagedPolicyArn(
      this, "WritePostDatedSqsPolicy",
      Fn.importValue(`${sam}-WritePostDatedNotificationsSQSQueuePolicyArn`)
    )
    const readPostDatedSqsPolicy = ManagedPolicy.fromManagedPolicyArn(
      this, "ReadPostDatedSqsPolicy",
      Fn.importValue(`${sam}-ReadPostDatedNotificationsSQSQueuePolicyArn`)
    )
    const nhsNotifyPrescriptionsSqsQueueUrl = Fn.importValue(`${sam}-NHSNotifyPrescriptionsSQSQueueUrl`)
    const postDatedNotificationsSqsQueueUrl = Fn.importValue(`${sam}-PostDatedNotificationsSQSQueueUrl`)

    // Cross-stack imports from SAM stateful stack — secrets
    const sqsSaltSecret = Fn.importValue(`${sam}-SQSSaltSecret`)
    const getSqsSaltSecretPolicy = ManagedPolicy.fromManagedPolicyArn(
      this, "GetSqsSaltSecretPolicy",
      Fn.importValue(`${sam}-GetSQSSaltSecretPolicy`)
    )
    const notifyApiKeySecret = Fn.importValue(`${sam}-PSU-Notify-API-Key`)
    const notifyPrivateKeySecret = Fn.importValue(`${sam}-PSU-Notify-PrivateKey`)
    const notifyKidSecret = Fn.importValue(`${sam}-PSU-Notify-KID`)
    const notifyAppIdSecret = Fn.importValue(`${sam}-PSU-Notify-Application-ID`)
    const getPsuSecretPolicy = ManagedPolicy.fromManagedPolicyArn(
      this, "GetPsuSecretPolicy",
      Fn.importValue(`${sam}-GetPSUSecretPolicy`)
    )
    const usePsuSecretsKmsPolicy = ManagedPolicy.fromManagedPolicyArn(
      this, "UsePsuSecretsKmsPolicy",
      Fn.importValue(`${sam}-UsePSUSecretsKMSKeyPolicyArn`)
    )

    // Cross-stack imports from SAM stateful stack — parameters
    const getNotificationsParamPolicy = ManagedPolicy.fromManagedPolicyArn(
      this, "GetNotificationsParamPolicy",
      Fn.importValue(`${sam}-GetNotificationsParameterPolicy`)
    )
    const enabledSiteOdsCodesParam = Fn.importValue(`${sam}-PSUNotifyEnabledSiteODSCodesParam`)
    const enabledSystemsParam = Fn.importValue(`${sam}-PSUNotifyEnabledSystemsParam`)
    const enabledSupplierAppIdsParam = Fn.importValue(`${sam}-PSUNotifyEnabledSupplierApplicationIDsParam`)
    const blockedSiteOdsCodesParam = Fn.importValue(`${sam}-PSUNotifyBlockedSiteODSCodesParam`)
    const notifyRoutingPlanIdParam = Fn.importValue(`${sam}-PSUNotifyRoutingPlanIDParam`)
    const notifyApiBaseUrlParam = Fn.importValue(`${sam}-PSUNotifyApiBaseUrlParam`)
    const enableNotificationsExternalParam = Fn.importValue(`${sam}-EnableNotificationsExternalName`)
    const enableNotificationsInternalParam = Fn.importValue(`${sam}-EnableNotificationsInternalName`)
    const testPrescriptionsParamName1 = Fn.importValue(`${sam}-TestPrescriptionsParameterName1`)
    const testPrescriptionsParamName2 = Fn.importValue(`${sam}-TestPrescriptionsParameterName2`)
    const testPrescriptionsParamName3 = Fn.importValue(`${sam}-TestPrescriptionsParameterName3`)
    const testPrescriptionsParamName4 = Fn.importValue(`${sam}-TestPrescriptionsParameterName4`)

    // Account-level imports
    const lambdaAccessSecretsPolicy = ManagedPolicy.fromManagedPolicyArn(
      this, "LambdaAccessSecretsPolicy",
      Fn.importValue("account-resources:LambdaAccessSecretsPolicy")
    )

    // Lambda Functions

    const updatePrescriptionStatus = new TypescriptLambdaFunction(
      this, "UpdatePrescriptionStatus", {
        functionName: `${props.stackName}-UpdatePrescriptionStatus`,
        projectBaseDir: baseDir,
        packageBasePath: "packages/updatePrescriptionStatus",
        entryPoint: "src/updatePrescriptionStatus.ts",
        environmentVariables: {
          TABLE_NAME: prescriptionStatusUpdatesTableName,
          NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL: nhsNotifyPrescriptionsSqsQueueUrl,
          POST_DATED_PRESCRIPTIONS_SQS_QUEUE_URL: postDatedNotificationsSqsQueueUrl,
          ENABLE_POST_DATED_NOTIFICATIONS: props.enablePostDatedNotifications,
          SQS_SALT: sqsSaltSecret,
          USE_APP_ID_FOR_NOTIFICATIONS_FILTERING: "false",
          ENABLED_SYSTEMS_PARAM: enabledSystemsParam,
          ENABLED_APPLICATION_IDS_PARAM: enabledSupplierAppIdsParam,
          ENABLED_SITE_ODS_CODES_PARAM: enabledSiteOdsCodesParam,
          BLOCKED_SITE_ODS_CODES_PARAM: blockedSiteOdsCodesParam,
          ENABLE_NOTIFICATIONS_PARAM: enableNotificationsInternalParam,
          ENVIRONMENT: props.environment,
          REQUIRE_APPLICATION_NAME: props.requireApplicationName,
          TEST_PRESCRIPTIONS_PARAM_NAME_1: testPrescriptionsParamName1,
          TEST_PRESCRIPTIONS_PARAM_NAME_2: testPrescriptionsParamName2,
          TEST_PRESCRIPTIONS_PARAM_NAME_3: testPrescriptionsParamName3,
          TEST_PRESCRIPTIONS_PARAM_NAME_4: testPrescriptionsParamName4
        },
        additionalPolicies: [
          tableWritePolicy,
          tableReadPolicy,
          tableKmsPolicy,
          notificationSqsKmsPolicy,
          writeNotifySqsPolicy,
          writePostDatedSqsPolicy,
          getSqsSaltSecretPolicy,
          getNotificationsParamPolicy
        ],
        logRetentionInDays: props.logRetentionInDays,
        logLevel: props.logLevel,
        version: props.version,
        commitId: props.commitId
      })

    const convertRequestToFhirFormat = new TypescriptLambdaFunction(
      this, "ConvertRequestToFhirFormat", {
        functionName: `${props.stackName}-ConvertRequestToFhirFormat`,
        projectBaseDir: baseDir,
        packageBasePath: "packages/cpsuLambda",
        entryPoint: "src/cpsu.ts",
        environmentVariables: {},
        logRetentionInDays: props.logRetentionInDays,
        logLevel: props.logLevel,
        version: props.version,
        commitId: props.commitId
      })

    const getStatusUpdates = new TypescriptLambdaFunction(this, "GetStatusUpdates", {
      functionName: `${props.stackName}-GetStatusUpdates`,
      projectBaseDir: baseDir,
      packageBasePath: "packages/gsul",
      entryPoint: "src/getStatusUpdates.ts",
      environmentVariables: {
        TABLE_NAME: prescriptionStatusUpdatesTableName
      },
      additionalPolicies: [tableReadPolicy, tableKmsPolicy],
      logRetentionInDays: props.logRetentionInDays,
      logLevel: props.logLevel,
      version: props.version,
      commitId: props.commitId
    })

    const status = new TypescriptLambdaFunction(this, "Status", {
      functionName: `${props.stackName}-status`,
      projectBaseDir: baseDir,
      packageBasePath: "packages/statusLambda",
      entryPoint: "src/statusLambda.ts",
      environmentVariables: {},
      additionalPolicies: [lambdaAccessSecretsPolicy],
      logRetentionInDays: props.logRetentionInDays,
      logLevel: props.logLevel,
      version: props.version,
      commitId: props.commitId
    })

    const capabilityStatement = new TypescriptLambdaFunction(this, "CapabilityStatement", {
      functionName: `${props.stackName}-CapabilityStatement`,
      projectBaseDir: baseDir,
      packageBasePath: "packages/capabilityStatement",
      entryPoint: "src/capabilityStatement.ts",
      environmentVariables: {},
      logRetentionInDays: props.logRetentionInDays,
      logLevel: props.logLevel,
      version: props.version,
      commitId: props.commitId
    })

    const nhsNotifyUpdateCallback = new TypescriptLambdaFunction(
      this, "NHSNotifyUpdateCallback", {
        functionName: `${props.stackName}-NHSNotifyUpdateCallback`,
        projectBaseDir: baseDir,
        packageBasePath: "packages/nhsNotifyUpdateCallback",
        entryPoint: "src/lambdaHandler.ts",
        environmentVariables: {
          TABLE_NAME: prescriptionNotificationStatesTableName,
          APP_ID_SECRET: notifyAppIdSecret,
          API_KEY_SECRET: notifyApiKeySecret
        },
        additionalPolicies: [
          notificationStatesReadPolicy,
          notificationStatesWritePolicy,
          notificationStatesKmsPolicy,
          getPsuSecretPolicy,
          usePsuSecretsKmsPolicy
        ],
        logRetentionInDays: props.logRetentionInDays,
        logLevel: props.logLevel,
        version: props.version,
        commitId: props.commitId
      })

    const notifyProcessor = new TypescriptLambdaFunction(this, "NotifyProcessor", {
      functionName: `${props.stackName}-NotifyProcessor`,
      projectBaseDir: baseDir,
      packageBasePath: "packages/nhsNotifyLambda",
      entryPoint: "src/nhsNotifyLambda.ts",
      environmentVariables: {
        NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL: nhsNotifyPrescriptionsSqsQueueUrl,
        TABLE_NAME: prescriptionNotificationStatesTableName,
        API_KEY_SECRET: notifyApiKeySecret,
        PRIVATE_KEY_SECRET: notifyPrivateKeySecret,
        KID_SECRET: notifyKidSecret,
        NHS_NOTIFY_ROUTING_ID_PARAM: notifyRoutingPlanIdParam,
        NOTIFY_API_BASE_URL_PARAM: notifyApiBaseUrlParam,
        MAKE_REAL_NOTIFY_REQUESTS_PARAM: enableNotificationsExternalParam
      },
      additionalPolicies: [
        writeNotifySqsPolicy,
        readNotifySqsPolicy,
        notificationSqsKmsPolicy,
        notificationStatesReadPolicy,
        notificationStatesWritePolicy,
        notificationStatesKmsPolicy,
        getNotificationsParamPolicy,
        getPsuSecretPolicy,
        usePsuSecretsKmsPolicy
      ],
      timeoutInSeconds: 900,
      logRetentionInDays: props.logRetentionInDays,
      logLevel: props.logLevel,
      version: props.version,
      commitId: props.commitId
    })

    this.createSchedule(
      "NotifyProcessorSchedule",
      `${props.stackName}-NotifySchedule`,
      "rate(1 minute)",
      notifyProcessor.function
    )

    const postDatedNotifyLambda = new TypescriptLambdaFunction(
      this, "PostDatedNotifyLambda", {
        functionName: `${props.stackName}-postDatedNotifyLambda`,
        projectBaseDir: baseDir,
        packageBasePath: "packages/postDatedLambda",
        entryPoint: "src/main.ts",
        environmentVariables: {
          NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL: nhsNotifyPrescriptionsSqsQueueUrl,
          POST_DATED_PRESCRIPTIONS_SQS_QUEUE_URL: postDatedNotificationsSqsQueueUrl,
          TABLE_NAME: prescriptionStatusUpdatesTableName
        },
        additionalPolicies: [
          writeNotifySqsPolicy,
          readNotifySqsPolicy,
          notificationSqsKmsPolicy,
          writePostDatedSqsPolicy,
          readPostDatedSqsPolicy,
          tableWritePolicy,
          tableReadPolicy,
          tableKmsPolicy
        ],
        timeoutInSeconds: 900,
        logRetentionInDays: props.logRetentionInDays,
        logLevel: props.logLevel,
        version: props.version,
        commitId: props.commitId
      })

    this.createSchedule(
      "PostDatedNotifySchedule",
      `${props.stackName}-PostDatedNotifySchedule`,
      "rate(15 minutes)",
      postDatedNotifyLambda.function
    )

    // Conditional: CheckPrescriptionStatusUpdates
    let checkPrescriptionStatusUpdates: TypescriptLambdaFunction | undefined
    if (props.deployCheckPrescriptionStatusUpdate) {
      checkPrescriptionStatusUpdates = new TypescriptLambdaFunction(
        this, "CheckPrescriptionStatusUpdates", {
          functionName: `${props.stackName}-CheckPrescriptionStatusUpdates`,
          projectBaseDir: baseDir,
          packageBasePath: "packages/checkPrescriptionStatusUpdates",
          entryPoint: "src/checkPrescriptionStatusUpdates.ts",
          environmentVariables: {
            TABLE_NAME: prescriptionStatusUpdatesTableName,
            MIN_RESULTS_RETURNED: "5",
            MAX_RESULTS_RETURNED: "15"
          },
          additionalPolicies: [tableReadPolicy, tableKmsPolicy],
          logRetentionInDays: props.logRetentionInDays,
          logLevel: props.logLevel,
          version: props.version,
          commitId: props.commitId
        }
      )
    }

    // Conditional: PsuRestoreValidation
    if (props.enableBackup) {
      const psuRestoreValidationPolicy = new ManagedPolicy(this, "PsuRestoreValidationPolicy", {
        managedPolicyName: `${props.stackName}-PsuRestoreValidationPolicy`,
        statements: [
          new PolicyStatement({
            actions: ["backup:PutRestoreValidationResult"],
            resources: ["*"]
          }),
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
              Fn.sub(
                "arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/awsbackup-restore-test-*"
              )
            ]
          })
        ]
      })

      NagSuppressions.addResourceSuppressions(psuRestoreValidationPolicy, [
        {
          id: "AwsSolutions-IAM5",
          reason: "Wildcard needed for backup:PutRestoreValidationResult on any restore job"
        }
      ])

      const psuRestoreValidation = new TypescriptLambdaFunction(this, "PsuRestoreValidation", {
        functionName: `${props.stackName}-PsuRestoreValidation`,
        projectBaseDir: baseDir,
        packageBasePath: "packages/psuRestoreValidationLambda",
        entryPoint: "src/handler.ts",
        environmentVariables: {},
        additionalPolicies: [
          psuRestoreValidationPolicy,
          tableReadPolicy,
          tableKmsPolicy
        ],
        logRetentionInDays: props.logRetentionInDays,
        logLevel: props.logLevel,
        version: props.version,
        commitId: props.commitId
      })

      const restoreRule = new Rule(this, "PsuBackupRestoreJobStateChangeRule", {
        eventPattern: {
          source: ["aws.backup"],
          detailType: ["Restore Job State Change"],
          detail: {
            resourceType: ["DynamoDB.FullyManaged"],
            status: ["COMPLETED"],
            sourceResourceArn: [
              Fn.sub(

                `arn:aws:dynamodb:\${AWS::Region}:\${AWS::AccountId}:table/${prescriptionStatusUpdatesTableName}`
              )
            ]
          }
        }
      })
      restoreRule.addTarget(new LambdaFunctionTarget(psuRestoreValidation.function))
    }

    this.functions = {
      updatePrescriptionStatus,
      convertRequestToFhirFormat,
      getStatusUpdates,
      status,
      capabilityStatement,
      nhsNotifyUpdateCallback,
      notifyProcessor,
      postDatedNotifyLambda,
      ...(checkPrescriptionStatusUpdates ? {checkPrescriptionStatusUpdates} : {})
    }
  }

  private createSchedule(
    id: string,
    scheduleName: string,
    scheduleExpression: string,
    lambdaFunction: IFunction
  ): void {
    const scheduleRole = new Role(this, `${id}Role`, {
      assumedBy: new ServicePrincipal("scheduler.amazonaws.com")
    })

    const schedulePolicy = new ManagedPolicy(this, `${id}Policy`, {
      statements: [
        new PolicyStatement({
          actions: ["lambda:InvokeFunction"],
          resources: [lambdaFunction.functionArn]
        })
      ]
    })
    scheduleRole.addManagedPolicy(schedulePolicy)

    NagSuppressions.addResourceSuppressions(scheduleRole, [
      {
        id: "AwsSolutions-IAM5",
        reason: "Role only grants InvokeFunction on a specific Lambda"
      }
    ])

    new CfnSchedule(this, id, {
      name: scheduleName,
      scheduleExpression: scheduleExpression,
      flexibleTimeWindow: {mode: "OFF"},
      target: {
        arn: lambdaFunction.functionArn,
        roleArn: scheduleRole.roleArn
      }
    })
  }
}
