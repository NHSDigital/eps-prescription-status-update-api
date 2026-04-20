import {CfnOutput, RemovalPolicy, Stack} from "aws-cdk-lib"
import {
  ManagedPolicy,
  PolicyStatement,
  AnyPrincipal,
  AccountRootPrincipal
} from "aws-cdk-lib/aws-iam"
import {Key, Alias} from "aws-cdk-lib/aws-kms"
import {PolicyDocument} from "aws-cdk-lib/aws-iam"
import {Secret} from "aws-cdk-lib/aws-secretsmanager"
import {Construct} from "constructs"
import {NagSuppressions} from "cdk-nag"

export interface SecretsProps {
  readonly stackName: string
}

export class Secrets extends Construct {
  public constructor(scope: Construct, id: string, props: SecretsProps) {
    super(scope, id)

    const {account, region} = Stack.of(this)

    // KMS key encrypting all 4 NHS Notify secrets.
    // The SSO ReadOnly condition mirrors the key policy in SAMtemplates/secrets/main.yaml.
    const psuSecretsKmsKey = new Key(this, "PSUSecretsKMSKey", {
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN,
      policy: new PolicyDocument({
        statements: [
          new PolicyStatement({
            sid: "EnableIAMUserPermissions",
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

    new Alias(this, "PSUSecretsKMSKeyAlias", {
      aliasName: `alias/${props.stackName}-PSUSecretsKMSKey`,
      targetKey: psuSecretsKmsKey
    })
    const usePsuSecretsKmsKeyPolicy = new ManagedPolicy(this, "UsePSUSecretsKMSKeyPolicy", {
      managedPolicyName: `-UsePSUSecretsKMSKey`,
      statements: [
        new PolicyStatement({
          sid: "AllowKmsForSecretsEncryption",
          actions: [
            "kms:DescribeKey",
            "kms:GenerateDataKey*",
            "kms:Encrypt",
            "kms:ReEncrypt*",
            "kms:Decrypt"
          ],
          resources: [psuSecretsKmsKey.keyArn]
        })
      ]
    })
    NagSuppressions.addResourceSuppressions(usePsuSecretsKmsKeyPolicy, [
      {
        id: "AwsSolutions-IAM5",
        reason: "Wildcard KMS actions are required for Secrets Manager encryption and data key generation."
      }
    ])

    // Salt used to derive SQS message group / deduplication IDs.
    // No CMK — AWS-managed key intentional to avoid bootstrap ordering issues.
    const sqsSaltSecret = new Secret(this, "SQSSaltSecret", {
      secretName: `${props.stackName}-SqsSaltSecret`,
      description: "Auto-generated salt for SQS_SALT",
      generateSecretString: {
        secretStringTemplate: "{}",
        generateStringKey: "salt",
        passwordLength: 32,
        excludePunctuation: true
      },
      removalPolicy: RemovalPolicy.RETAIN
    })

    const psuNotifyKidSecret = new Secret(this, "PSUNotifyKIDSecret", {
      secretName: `${props.stackName}-PSU-Notify-KID`,
      description: "The id of the key (KID) used to sign JWT to NHS Notify and sent in the header",
      encryptionKey: psuSecretsKmsKey,
      removalPolicy: RemovalPolicy.RETAIN
    })

    const psuNotifyPrivateKeySecret = new Secret(this, "PSUNotifyPrivateKeySecret", {
      secretName: `${props.stackName}-PSU-Notify-PrivateKey`,
      description: "RSA private key (PEM) for signing JWT to NHS Notify",
      encryptionKey: psuSecretsKmsKey,
      removalPolicy: RemovalPolicy.RETAIN
    })

    const psuNotifyApplicationIdSecret = new Secret(this, "PSUNotifyApplicationIDSecret", {
      secretName: `${props.stackName}-PSU-Notify-Application-ID`,
      description: "The application ID for the DoS application to use when sending notifications to NHS Notify",
      encryptionKey: psuSecretsKmsKey,
      removalPolicy: RemovalPolicy.RETAIN
    })

    const psuNotifyApiKeySecret = new Secret(this, "PSUNotifyAPIKeySecret", {
      secretName: `${props.stackName}-PSU-Notify-API-Key`,
      description: "API Key for NHS Notify",
      encryptionKey: psuSecretsKmsKey,
      removalPolicy: RemovalPolicy.RETAIN
    })

    NagSuppressions.addResourceSuppressions(sqsSaltSecret, [
      {
        id: "AwsSolutions-SMG4",
        reason: "SQS_SALT is a static application secret with no supported automatic rotator."
      },
      {
        id: "EpsNagPack-EPS16",
        reason: "SQS_SALT intentionally uses AWS-managed encryption to avoid bootstrap dependency on the PSU CMK."
      }
    ])
    NagSuppressions.addResourceSuppressions(
      [psuNotifyKidSecret, psuNotifyPrivateKeySecret, psuNotifyApplicationIdSecret, psuNotifyApiKeySecret],
      [
        {
          id: "AwsSolutions-SMG4",
          reason: "NHS Notify secrets are externally managed with no AWS-supported automatic rotation workflow."
        }
      ]
    )

    const getSqsSaltSecretPolicy = new ManagedPolicy(this, "GetSQSSaltSecretPolicy", {
      description: "Allows reading secret parameters",
      statements: [
        new PolicyStatement({
          actions: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
          resources: [sqsSaltSecret.secretArn]
        })
      ]
    })

    const getPsuSecretPolicy = new ManagedPolicy(this, "GetPSUSecretPolicy", {
      description: "Allows reading PSU secret parameters",
      statements: [
        new PolicyStatement({
          actions: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
          resources: [
            psuNotifyKidSecret.secretArn,
            psuNotifyPrivateKeySecret.secretArn,
            psuNotifyApplicationIdSecret.secretArn,
            psuNotifyApiKeySecret.secretArn
          ]
        })
      ]
    })

    // Exports — names must match exactly what Functions.ts imports via Fn.importValue
    new CfnOutput(this, "SQSSaltSecretOutput", {
      description: "The name of the randomly generated SQS salt secret",
      value: sqsSaltSecret.secretName,
      exportName: `${props.stackName}-SQSSaltSecret`
    })
    new CfnOutput(this, "PSUNotifyKIDSecretOutput", {
      description: "The name of the PSU Notify KID secret",
      value: psuNotifyKidSecret.secretName,
      exportName: `${props.stackName}-PSU-Notify-KID`
    })
    new CfnOutput(this, "PSUNotifyPrivateKeySecretOutput", {
      description: "The name of the PSU Notify Private Key secret",
      value: psuNotifyPrivateKeySecret.secretName,
      exportName: `${props.stackName}-PSU-Notify-PrivateKey`
    })
    new CfnOutput(this, "PSUNotifyApplicationIDSecretOutput", {
      description: "The name of the PSU Notify Application ID secret",
      value: psuNotifyApplicationIdSecret.secretName,
      exportName: `${props.stackName}-PSU-Notify-Application-ID`
    })
    new CfnOutput(this, "PSUNotifyAPIKeySecretOutput", {
      description: "The name of the PSU Notify API Key secret",
      value: psuNotifyApiKeySecret.secretName,
      exportName: `${props.stackName}-PSU-Notify-API-Key`
    })
    new CfnOutput(this, "GetPSUSecretPolicyOutput", {
      description: "ARN of policy granting permission to read secrets",
      value: getPsuSecretPolicy.managedPolicyArn,
      exportName: `${props.stackName}-GetPSUSecretPolicy`
    })
    new CfnOutput(this, "GetSQSSaltSecretPolicyOutput", {
      description: "ARN of policy granting permission to read the SQS salt secret",
      value: getSqsSaltSecretPolicy.managedPolicyArn,
      exportName: `${props.stackName}-GetSQSSaltSecretPolicy`
    })
    new CfnOutput(this, "UsePSUSecretsKMSKeyPolicyArnOutput", {
      description: "ARN of managed policy granting PSU secrets KMS usage",
      value: usePsuSecretsKmsKeyPolicy.managedPolicyArn,
      exportName: `${props.stackName}-UsePSUSecretsKMSKeyPolicyArn`
    })
  }
}
