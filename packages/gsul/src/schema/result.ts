interface DynamoDBResult {
    prescriptionID: string | undefined;
    itemId: string | undefined;
    latestStatus: string | undefined;
    isTerminalState: string | undefined;
    lastUpdateDateTime: string | undefined
  }

export {DynamoDBResult}
