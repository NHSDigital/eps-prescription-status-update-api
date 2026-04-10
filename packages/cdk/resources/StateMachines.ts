import {Fn} from "aws-cdk-lib"
import {Function} from "aws-cdk-lib/aws-lambda"
import {ManagedPolicy, PolicyStatement} from "aws-cdk-lib/aws-iam"
import {Construct} from "constructs"
import {ExpressStateMachine, TypescriptLambdaFunction} from "@nhsdigital/eps-cdk-constructs"
import {UpdatePrescriptionStatusDefinition} from "./StateMachineDefinitions/UpdatePrescriptionStatus"
import {Format1UpdatePrescriptionsStatusDefinition} from "./StateMachineDefinitions/Format1UpdatePrescriptionsStatus"

export interface StateMachinesProps {
  readonly stackName: string
  readonly logRetentionInDays: number
  readonly functions: {[key: string]: TypescriptLambdaFunction}
}

export class StateMachines extends Construct {
  stateMachines: {[key: string]: ExpressStateMachine}

  public constructor(scope: Construct, id: string, props: StateMachinesProps) {
    super(scope, id)

    // Import the FHIR Validator function from the fhir-validator stack
    const fhirValidatorFunctionArn = `${Fn.importValue("fhir-validator:FHIRValidatorUKCoreLambdaArn")}:$LATEST`
    const fhirValidatorFunction = Function.fromFunctionArn(
      this, "FhirValidatorFunction", fhirValidatorFunctionArn
    )
    const fhirValidatorExecutePolicy = ManagedPolicy.fromManagedPolicyArn(
      this, "FhirValidatorExecutePolicy",
      Fn.importValue("fhir-validator:FHIRValidatorUKCoreExecuteLambdaPolicyArn")
    )

    // Policy to invoke the FHIR validator function (needed because the import
    // uses a qualified ARN with :$LATEST suffix which may not be covered by
    // the execute policy from the fhir-validator stack)
    const callFhirValidatorPolicy = new ManagedPolicy(this, "CallFhirValidatorPolicy", {
      description: "Invoke FHIR validator lambda from state machine",
      statements: [
        new PolicyStatement({
          actions: ["lambda:InvokeFunction"],
          resources: [fhirValidatorFunctionArn]
        })
      ]
    })

    // UpdatePrescriptionStatus state machine definition
    const updatePrescriptionStatusDefinition = new UpdatePrescriptionStatusDefinition(
      this, "UpdatePrescriptionStatusDefinition", {
        fhirValidationFunction: fhirValidatorFunction,
        updatePrescriptionStatusFunction: props.functions.updatePrescriptionStatus.function
      }
    )

    const updatePrescriptionStatusStateMachine = new ExpressStateMachine(
      this, "UpdatePrescriptionStatusStateMachine", {
        stackName: props.stackName,
        stateMachineName: `${props.stackName}-UpdatePrescriptionStatus`,
        definition: updatePrescriptionStatusDefinition.definition,
        logRetentionInDays: props.logRetentionInDays,
        additionalPolicies: [
          props.functions.updatePrescriptionStatus.executionPolicy,
          fhirValidatorExecutePolicy,
          callFhirValidatorPolicy
        ]
      }
    )

    // Format1UpdatePrescriptionsStatus state machine definition
    const format1Definition = new Format1UpdatePrescriptionsStatusDefinition(
      this, "Format1UpdatePrescriptionsStatusDefinition", {
        convertRequestToFhirFormatFunction: props.functions.convertRequestToFhirFormat.function,
        updatePrescriptionStatusFunction: props.functions.updatePrescriptionStatus.function
      }
    )

    const format1UpdatePrescriptionsStatusStateMachine = new ExpressStateMachine(
      this, "Format1UpdatePrescriptionsStatusStateMachine", {
        stackName: props.stackName,
        stateMachineName: `${props.stackName}-Format1UpdatePrescriptionsStatus`,
        definition: format1Definition.definition,
        logRetentionInDays: props.logRetentionInDays,
        additionalPolicies: [
          props.functions.convertRequestToFhirFormat.executionPolicy,
          props.functions.updatePrescriptionStatus.executionPolicy
        ]
      }
    )

    this.stateMachines = {
      updatePrescriptionStatus: updatePrescriptionStatusStateMachine,
      format1UpdatePrescriptionsStatus: format1UpdatePrescriptionsStatusStateMachine
    }
  }
}
