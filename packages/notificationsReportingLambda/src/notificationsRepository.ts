import {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  QueryCommandInput,
  ScanCommandInput
} from "@aws-sdk/lib-dynamodb"
import {LastNotificationStateType} from "@psu-common/commonTypes"

export interface NotificationQueryFilters {
  prescriptionId?: string
  nhsNumber?: string
  odsCode?: string
}

interface FilterState {
  clauses: Array<string>
  names: Record<string, string>
  values: Record<string, unknown>
  index: number
}

export class NotificationsRepository {
  private readonly client: DynamoDBDocumentClient
  private readonly tableName: string

  constructor(client: DynamoDBDocumentClient, tableName: string) {
    if (!tableName) {
      throw new Error("Notifications table name is not configured")
    }
    this.client = client
    this.tableName = tableName
  }

  async fetch(filters: NotificationQueryFilters): Promise<Array<LastNotificationStateType>> {
    if (!filters.nhsNumber && !filters.prescriptionId && !filters.odsCode) {
      throw new Error("At least one filter must be provided")
    }

    if (filters.nhsNumber) {
      return await this.queryByNhsNumber(filters)
    }

    return await this.scanByFilters(filters)
  }

  // We can query by NHS number, since it's a partition key. Other fields will require a scan
  private async queryByNhsNumber(filters: NotificationQueryFilters): Promise<Array<LastNotificationStateType>> {
    const names: Record<string, string> = {"#pk": "NHSNumber"}
    const values: Record<string, unknown> = {":pk": filters.nhsNumber}
    const filterState: FilterState = {
      clauses: [],
      names,
      values,
      index: 0
    }

    if (filters.odsCode) {
      this.appendFilterClause(filterState, "ODSCode", filters.odsCode)
    }
    if (filters.prescriptionId) {
      this.appendFilterClause(filterState, "PrescriptionID", filters.prescriptionId)
    }

    const input: QueryCommandInput = {
      TableName: this.tableName,
      KeyConditionExpression: "#pk = :pk",
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values
    }

    if (filterState.clauses.length) {
      input.FilterExpression = filterState.clauses.join(" AND ")
    }

    return await this.paginatedQuery(input)
  }

  private async scanByFilters(filters: NotificationQueryFilters): Promise<Array<LastNotificationStateType>> {
    const names: Record<string, string> = {}
    const values: Record<string, unknown> = {}
    const filterState: FilterState = {
      clauses: [],
      names,
      values,
      index: 0
    }

    if (filters.prescriptionId) {
      this.appendFilterClause(filterState, "PrescriptionID", filters.prescriptionId)
    }
    if (filters.odsCode) {
      this.appendFilterClause(filterState, "ODSCode", filters.odsCode)
    }

    if (filterState.clauses.length === 0) {
      throw new Error("Scan requires at least one non-key filter")
    }

    const input: ScanCommandInput = {
      TableName: this.tableName,
      FilterExpression: filterState.clauses.join(" AND "),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values
    }

    return await this.paginatedScan(input)
  }

  private appendFilterClause(state: FilterState, attributeName: string, value: string): void {
    const nameKey = `#f${state.index}`
    const valueKey = `:f${state.index}`
    state.index += 1
    state.names[nameKey] = attributeName
    state.values[valueKey] = value
    state.clauses.push(`${nameKey} = ${valueKey}`)
  }

  private async paginatedQuery(input: QueryCommandInput): Promise<Array<LastNotificationStateType>> {
    const items: Array<LastNotificationStateType> = []
    let exclusiveStartKey: Record<string, unknown> | undefined

    do {
      const command = new QueryCommand({
        ...input,
        ExclusiveStartKey: exclusiveStartKey
      })
      const result = await this.client.send(command)
      if (result.Items) {
        items.push(...result.Items as Array<LastNotificationStateType>)
      }
      exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined
    } while (exclusiveStartKey)

    return items
  }

  private async paginatedScan(input: ScanCommandInput): Promise<Array<LastNotificationStateType>> {
    const items: Array<LastNotificationStateType> = []
    let exclusiveStartKey: Record<string, unknown> | undefined

    do {
      const command = new ScanCommand({
        ...input,
        ExclusiveStartKey: exclusiveStartKey
      })
      const result = await this.client.send(command)
      if (result.Items) {
        items.push(...result.Items as Array<LastNotificationStateType>)
      }
      exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined
    } while (exclusiveStartKey)

    return items
  }
}
