import {App, Stack} from "aws-cdk-lib"
import {nagSuppressions} from "../nagSuppressions"
import {StandardStackProps} from "@nhsdigital/eps-cdk-constructs"

export interface PsuStatelessStackProps extends StandardStackProps {
  readonly stackName: string
}

export class PsuStatelessStack extends Stack {
  public constructor(scope: App, id: string, props: PsuStatelessStackProps) {
    super(scope, id, props)

    // Resources will be added here as they are migrated from SAM templates

    nagSuppressions(this)
  }
}
