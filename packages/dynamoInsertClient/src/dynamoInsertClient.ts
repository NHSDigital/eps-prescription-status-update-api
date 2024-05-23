import {Logger} from "@aws-lambda-powertools/logger"
import {DynamoDBClient, TransactWriteItem, TransactWriteItemsCommand} from "@aws-sdk/client-dynamodb"
import {marshall} from "@aws-sdk/util-dynamodb"
import {DataItem} from "./dataItem"

export class DynamoInsertClient {
  client: DynamoDBClient
  logger: Logger
  tableName: string

  constructor(dynamoDBClient?: DynamoDBClient) {
    this.client = dynamoDBClient ?? new DynamoDBClient()
    this.logger = new Logger({serviceName: "databaseClient"})
    this.tableName = process.env.TABLE_NAME ?? "PrescriptionStatusUpdates"
  }

  private dataItemToTransaction(dataItem: DataItem): TransactWriteItem {
    return {
      Put: {
        TableName: this.tableName,
        Item: marshall(dataItem)
      }
    }
  }

  private createTransactionCommand(dataItems: Array<DataItem>): TransactWriteItemsCommand {
    this.logger.info("Creating transaction command to write data items.")
    const transactItems: Array<TransactWriteItem> = dataItems.map((d) => this.dataItemToTransaction(d))
    return new TransactWriteItemsCommand({TransactItems: transactItems})
  }

  async persistDataItems(dataItems: Array<DataItem>): Promise<boolean> {
    const transactionCommand = this.createTransactionCommand(dataItems)
    try {
      this.logger.info("Sending TransactWriteItemsCommand to DynamoDB.", {command: transactionCommand})
      await this.client.send(transactionCommand)
      this.logger.info("TransactWriteItemsCommand sent to DynamoDB successfully.", {command: transactionCommand})
      return true
    } catch (e) {
      this.logger.error("Error sending TransactWriteItemsCommand to DynamoDB.", {error: e})
      return false
    }
  }
}
