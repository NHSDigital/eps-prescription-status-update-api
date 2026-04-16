import {Fn, Stack} from "aws-cdk-lib"
import {StandardStackProps, TypescriptLambdaFunction} from "@nhsdigital/eps-cdk-constructs"
import {ManagedPolicy} from "aws-cdk-lib/aws-iam"
import {Construct} from "constructs"
import {resolve} from "node:path"
import {
  HttpApi,
  CfnDomainName,
  CfnApiMapping,
  CfnStage,
  HttpMethod
} from "aws-cdk-lib/aws-apigatewayv2"
import {HttpLambdaIntegration} from "aws-cdk-lib/aws-apigatewayv2-integrations"
import {Certificate, CertificateValidation} from "aws-cdk-lib/aws-certificatemanager"
import {PublicHostedZone, CfnRecordSet} from "aws-cdk-lib/aws-route53"
import {CfnLogGroup, CfnSubscriptionFilter} from "aws-cdk-lib/aws-logs"
import {nagSuppressionsSandbox} from "../nagSuppressions"

const baseDir = resolve(__dirname, "../../..")

export interface PsuApiSandboxStackProps extends StandardStackProps {
  readonly stackName: string
  readonly logRetentionInDays: number
  readonly logLevel: string
  readonly environment: string
  readonly trustStoreFile: string
  readonly trustStoreVersion: string
  readonly enableMutualTls: boolean
  readonly enableSplunk: boolean
}

export class PsuApiSandboxStack extends Stack {
  public constructor(scope: Construct, id: string, props: PsuApiSandboxStackProps) {
    super(scope, id, props)

    const lambdaAccessSecretsPolicy = ManagedPolicy.fromManagedPolicyArn(
      this, "LambdaAccessSecretsPolicy",
      Fn.importValue("account-resources:LambdaAccessSecretsPolicy")
    )

    const sandboxLambda = new TypescriptLambdaFunction(this, "Sandbox", {
      functionName: `${props.stackName}-UpdatePrescriptionStatusSandbox`,
      projectBaseDir: baseDir,
      packageBasePath: "packages/nhsd-psu-sandbox",
      entryPoint: "src/sandbox.ts",
      environmentVariables: {},
      logRetentionInDays: props.logRetentionInDays,
      logLevel: props.logLevel,
      version: props.version,
      commitId: props.commitId
    })

    const statusLambda = new TypescriptLambdaFunction(this, "Status", {
      functionName: `${props.stackName}-status`,
      projectBaseDir: baseDir,
      packageBasePath: "packages/statusLambda",
      entryPoint: "src/statusLambda.ts",
      environmentVariables: {
        VERSION_NUMBER: props.version,
        COMMIT_ID: props.commitId
      },
      additionalPolicies: [lambdaAccessSecretsPolicy],
      logRetentionInDays: props.logRetentionInDays,
      logLevel: props.logLevel,
      version: props.version,
      commitId: props.commitId
    })

    const capabilityStatementLambda = new TypescriptLambdaFunction(this, "CapabilityStatement", {
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

    const httpApi = new HttpApi(this, "HttpApiGateway", {
      disableExecuteApiEndpoint: props.enableMutualTls,
      createDefaultStage: false
    })

    httpApi.addRoutes({
      path: "/",
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration("SandboxIntegration", sandboxLambda.function)
    })
    httpApi.addRoutes({
      path: "/_status",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration("StatusIntegration", statusLambda.function)
    })
    httpApi.addRoutes({
      path: "/metadata",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration("CapabilityStatementIntegration", capabilityStatementLambda.function)
    })

    const cloudWatchKmsKeyArn = Fn.importValue("account-resources:CloudwatchLogsKmsKeyArn")
    const apiGwAccessLogs = new CfnLogGroup(this, "ApiGwAccessLogs", {
      logGroupName: Fn.join("/", ["", "aws", "apigateway", props.stackName, httpApi.httpApiId]),
      retentionInDays: props.logRetentionInDays,
      kmsKeyId: cloudWatchKmsKeyArn
    })

    new CfnStage(this, "HttpApiProdStage", {
      apiId: httpApi.httpApiId,
      stageName: "Prod",
      autoDeploy: true,
      defaultRouteSettings: {
        detailedMetricsEnabled: true
      },
      accessLogSettings: {
        destinationArn: apiGwAccessLogs.attrArn,
        format: JSON.stringify({
          requestTime: "$context.requestTime",
          apiId: "$context.apiId",
          accountId: "$context.accountId",
          requestId: "$context.requestId",
          status: "$context.status",
          httpMethod: "$context.httpMethod",
          protocol: "$context.protocol",
          path: "$context.path",
          responseLatency: "$context.responseLatency",
          responseLength: "$context.responseLength"
        })
      }
    })

    if (props.enableSplunk) {
      new CfnSubscriptionFilter(this, "ApiGwAccessLogsSplunkSubscriptionFilter", {
        logGroupName: apiGwAccessLogs.ref,
        filterPattern: "",
        destinationArn: Fn.importValue("lambda-resources:SplunkDeliveryStream"),
        roleArn: Fn.importValue("lambda-resources:SplunkSubscriptionFilterRole")
      })
    }

    const epsDomain = Fn.importValue("eps-route53-resources:EPS-domain")
    const epsZoneId = Fn.importValue("eps-route53-resources:EPS-ZoneID")
    const sandboxDomainName = Fn.join(".", [props.stackName, epsDomain])

    const hostedZone = PublicHostedZone.fromHostedZoneAttributes(this, "EpsPublicHostedZone", {
      hostedZoneId: epsZoneId,
      zoneName: epsDomain
    })

    const certificate = new Certificate(this, "GenerateCertificate", {
      domainName: sandboxDomainName,
      validation: CertificateValidation.fromDns(hostedZone)
    })

    const trustStoreBucketArn = Fn.importValue("account-resources:TrustStoreBucket")
    const trustStoreBucketName = Fn.select(5, Fn.split(":", trustStoreBucketArn))

    const domainName = new CfnDomainName(this, "HttpApiCustomDomain", {
      domainName: sandboxDomainName,
      domainNameConfigurations: [
        {
          endpointType: "REGIONAL",
          certificateArn: certificate.certificateArn,
          securityPolicy: "TLS_1_2"
        }
      ],
      mutualTlsAuthentication: props.enableMutualTls
        ? {
          truststoreUri: Fn.join("", ["s3://", trustStoreBucketName, "/", props.trustStoreFile]),
          truststoreVersion: props.trustStoreVersion
        }
        : undefined
    })

    new CfnApiMapping(this, "HttpApiDomainMapping", {
      apiId: httpApi.httpApiId,
      domainName: domainName.ref,
      stage: "Prod"
    })

    new CfnRecordSet(this, "HttpApiDomainAliasRecord", {
      hostedZoneId: epsZoneId,
      name: sandboxDomainName,
      type: "A",
      aliasTarget: {
        dnsName: domainName.attrRegionalDomainName,
        hostedZoneId: domainName.attrRegionalHostedZoneId,
        evaluateTargetHealth: false
      }
    })

    nagSuppressionsSandbox(this)
  }
}
