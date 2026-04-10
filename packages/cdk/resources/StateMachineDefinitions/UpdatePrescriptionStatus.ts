import {IFunction} from "aws-cdk-lib/aws-lambda"
import {LambdaInvoke} from "aws-cdk-lib/aws-stepfunctions-tasks"
import {Construct} from "constructs"
import {
  Chain,
  Choice,
  Condition,
  IChainable,
  Pass
} from "aws-cdk-lib/aws-stepfunctions"

export interface UpdatePrescriptionStatusDefinitionProps {
  readonly fhirValidationFunction: IFunction
  readonly updatePrescriptionStatusFunction: IFunction
}

export class UpdatePrescriptionStatusDefinition extends Construct {
  public readonly definition: IChainable

  public constructor(
    scope: Construct, id: string, props: UpdatePrescriptionStatusDefinitionProps
  ) {
    super(scope, id)

    const catchAllError = new Pass(this, "CatchAllError", {
      result: {
        value: {
          Payload: {
            statusCode: 500,
            headers: {
              "Content-Type": "application/fhir+json",
              "Cache-Control": "no-cache"
            },
            body: JSON.stringify({
              resourceType: "OperationOutcome",
              issue: [{severity: "error", code: "processing", diagnostics: "System error"}]
            })
          }
        }
      }
    })

    const callFhirValidation = new LambdaInvoke(this, "Call FHIR Validation", {
      lambdaFunction: props.fhirValidationFunction,
      assign: {
        fhirValidationResponse: "{% $states.result.Payload %}",
        fhirValidationErrorCount:
          "{% $count($states.result.Payload.issue[severity = 'error']) %}"
      }
    })
    callFhirValidation.addCatch(catchAllError)

    const returnFailedFhirValidationErrors = new Pass(this, "Return Failed FHIR Validation Errors", {
      outputs: {
        Payload: {
          statusCode: 400,
          headers: {
            "Content-Type": "application/fhir+json",
            "Cache-Control": "no-cache"
          },
          body: "{% $string($fhirValidationResponse) %}"
        }
      }
    })

    const callUpdatePrescriptionStatus = new LambdaInvoke(
      this, "Call Update Prescription Status", {
        lambdaFunction: props.updatePrescriptionStatusFunction
      }
    )
    callUpdatePrescriptionStatus.addCatch(catchAllError)

    const doFhirValidationErrorsExist = new Choice(this, "Do FHIR Validation Errors Exist")
    const hasErrors = Condition.jsonata("{% $fhirValidationErrorCount > 0 %}")

    this.definition = Chain
      .start(callFhirValidation)
      .next(
        doFhirValidationErrorsExist
          .when(hasErrors, returnFailedFhirValidationErrors)
          .otherwise(callUpdatePrescriptionStatus)
      )
  }
}
