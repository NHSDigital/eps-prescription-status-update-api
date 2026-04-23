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

    const catchAllError = this.createCatchAllError()
    const callFhirValidation = this.createCallFhirValidation(
      props.fhirValidationFunction,
      catchAllError
    )
    const callUpdatePrescriptionStatus = this.createCallUpdatePrescriptionStatus(
      props.updatePrescriptionStatusFunction,
      catchAllError
    )

    this.definition = Chain
      .start(callFhirValidation)
      .next(
        new Choice(this, "Do FHIR Validation Errors Exist")
          .when(
            Condition.jsonata("{% $fhirValidationErrorCount > 0 %}"),
            this.createReturnFailedFhirValidationErrors()
          )
          .otherwise(callUpdatePrescriptionStatus)
      )
  }

  private createCatchAllError(): Pass {
    return new Pass(this, "CatchAllError", {
      outputs: {
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
    })
  }

  private createCallFhirValidation(fhirValidationFunction: IFunction, catchAllError: Pass): LambdaInvoke {
    const callFhirValidation = new LambdaInvoke(this, "Call FHIR Validation", {
      lambdaFunction: fhirValidationFunction,
      assign: {
        fhirValidationResponse: "{% $states.result.Payload %}",
        fhirValidationErrorCount:
          "{% $count($states.result.Payload.issue[severity = 'error']) %}"
      }
    })
    callFhirValidation.addCatch(catchAllError)
    return callFhirValidation
  }

  private createReturnFailedFhirValidationErrors(): Pass {
    return new Pass(this, "Return Failed FHIR Validation Errors", {
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
  }

  private createCallUpdatePrescriptionStatus(
    updatePrescriptionStatusFunction: IFunction,
    catchAllError: Pass
  ): LambdaInvoke {
    const callUpdatePrescriptionStatus = new LambdaInvoke(
      this,
      "Call Update Prescription Status",
      {
        lambdaFunction: updatePrescriptionStatusFunction
      }
    )
    callUpdatePrescriptionStatus.addCatch(catchAllError)
    return callUpdatePrescriptionStatus
  }
}
