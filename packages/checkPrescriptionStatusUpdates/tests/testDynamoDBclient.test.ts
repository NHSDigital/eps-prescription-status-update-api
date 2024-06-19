/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-len */
import {buildQuery} from "../src/dynamoDBclient"
import {expect, describe} from "@jest/globals"

type buildQueryTestData = {
  prescriptionID: string | undefined
  applicationName: string | undefined
  odsCode: string | undefined
  nhsNumber: string | undefined
  showAllSuppliers: string | undefined
  overrideApplicationName: string | undefined
  exclusiveStartKeyPrescriptionID: string | undefined
  exclusiveStartKeyTaskID: string | undefined
  expectedIsScan: boolean
  expectedQuery: any
  scenarioDescription: string
}

describe("testing buildQuery", () => {
  test.each<buildQueryTestData>([
    {
      prescriptionID: undefined,
      applicationName: undefined,
      odsCode: undefined,
      nhsNumber: undefined,
      showAllSuppliers: undefined,
      overrideApplicationName: undefined,
      exclusiveStartKeyPrescriptionID: undefined,
      exclusiveStartKeyTaskID: undefined,
      expectedIsScan: true,
      expectedQuery: {
        Limit: 10,
        TableName: "dummy_table"
      },
      scenarioDescription: "nothing passed in"
    },
    {
      prescriptionID: undefined,
      applicationName: "unknown",
      odsCode: undefined,
      nhsNumber: undefined,
      showAllSuppliers: undefined,
      overrideApplicationName: undefined,
      exclusiveStartKeyPrescriptionID: undefined,
      exclusiveStartKeyTaskID: undefined,
      expectedIsScan: true,
      expectedQuery: {
        ExpressionAttributeValues: {
          ":ApplicationName": "unknown"
        },
        FilterExpression: "ApplicationName = :ApplicationName",
        Limit: 10,
        TableName: "dummy_table"
      },
      scenarioDescription: "only application name passed in"
    },
    {
      prescriptionID: undefined,
      applicationName: undefined,
      odsCode: "C9Z1O",
      nhsNumber: undefined,
      showAllSuppliers: undefined,
      overrideApplicationName: undefined,
      exclusiveStartKeyPrescriptionID: undefined,
      exclusiveStartKeyTaskID: undefined,
      expectedIsScan: true,
      expectedQuery: {
        ExpressionAttributeValues: {
          ":PharmacyODSCode": "C9Z1O"
        },
        FilterExpression: "PharmacyODSCode = :PharmacyODSCode",
        Limit: 10,
        TableName: "dummy_table"
      },
      scenarioDescription: "only odsCode name passed in"
    },
    {
      prescriptionID: undefined,
      applicationName: undefined,
      odsCode: undefined,
      nhsNumber: "9449304130",
      showAllSuppliers: undefined,
      overrideApplicationName: undefined,
      exclusiveStartKeyPrescriptionID: undefined,
      exclusiveStartKeyTaskID: undefined,
      expectedIsScan: true,
      expectedQuery: {
        ExpressionAttributeValues: {
          ":PatientNHSNumber": "9449304130"
        },
        FilterExpression: "PatientNHSNumber = :PatientNHSNumber",
        Limit: 10,
        TableName: "dummy_table"
      },
      scenarioDescription: "only nhsNumber name passed in"
    },
    {
      prescriptionID: "16B2E0-A83008-81C13H",
      applicationName: "unknown",
      odsCode: "C9Z1O",
      nhsNumber: "9449304130",
      showAllSuppliers: undefined,
      overrideApplicationName: undefined,
      exclusiveStartKeyPrescriptionID: undefined,
      exclusiveStartKeyTaskID: undefined,
      expectedIsScan: false,
      expectedQuery: {
        ExpressionAttributeValues: {
          ":ApplicationName": "unknown",
          ":PatientNHSNumber": "9449304130",
          ":PharmacyODSCode": "C9Z1O",
          ":inputPrescriptionID": "16B2E0-A83008-81C13H"
        },
        FilterExpression:
          "ApplicationName = :ApplicationName AND PharmacyODSCode = :PharmacyODSCode AND PatientNHSNumber = :PatientNHSNumber",
        KeyConditionExpression: "PrescriptionID = :inputPrescriptionID",
        Limit: 10,
        TableName: "dummy_table"
      },
      scenarioDescription: "everything apart from exclusiveStartKeys passed in"
    },
    {
      prescriptionID: "16B2E0-A83008-81C13H",
      applicationName: "unknown",
      odsCode: "C9Z1O",
      nhsNumber: "9449304130",
      showAllSuppliers: undefined,
      overrideApplicationName: undefined,
      exclusiveStartKeyPrescriptionID: "16B2E0-A83008-81C13H",
      exclusiveStartKeyTaskID: "02f91630-a9c6-4f72-bf54-a64adfac8b11",
      expectedIsScan: false,
      expectedQuery: {
        ExpressionAttributeValues: {
          ":ApplicationName": "unknown",
          ":PatientNHSNumber": "9449304130",
          ":PharmacyODSCode": "C9Z1O",
          ":inputPrescriptionID": "16B2E0-A83008-81C13H"
        },
        FilterExpression:
          "ApplicationName = :ApplicationName AND PharmacyODSCode = :PharmacyODSCode AND PatientNHSNumber = :PatientNHSNumber",
        KeyConditionExpression: "PrescriptionID = :inputPrescriptionID",
        Limit: 10,
        TableName: "dummy_table",
        ExclusiveStartKey: {
          PrescriptionID: "16B2E0-A83008-81C13H",
          TaskID: "02f91630-a9c6-4f72-bf54-a64adfac8b11"
        }
      },
      scenarioDescription: "everything apart including exclusiveStartKeys passed in"
    },
    {
      prescriptionID: undefined,
      applicationName: undefined,
      odsCode: undefined,
      nhsNumber: undefined,
      showAllSuppliers: undefined,
      overrideApplicationName: undefined,
      exclusiveStartKeyPrescriptionID: "16B2E0-A83008-81C13H",
      exclusiveStartKeyTaskID: undefined,
      expectedIsScan: true,
      expectedQuery: {
        Limit: 10,
        TableName: "dummy_table"
      },
      scenarioDescription: "only exclusiveStartKeyPrescriptionID passed in"
    },
    {
      prescriptionID: undefined,
      applicationName: undefined,
      odsCode: undefined,
      nhsNumber: undefined,
      showAllSuppliers: undefined,
      overrideApplicationName: undefined,
      exclusiveStartKeyPrescriptionID: undefined,
      exclusiveStartKeyTaskID: "02f91630-a9c6-4f72-bf54-a64adfac8b11",
      expectedIsScan: true,
      expectedQuery: {
        Limit: 10,
        TableName: "dummy_table"
      },
      scenarioDescription: "only exclusiveStartKeyTaskID passed in"
    },
    {
      prescriptionID: undefined,
      applicationName: "unknown",
      odsCode: undefined,
      nhsNumber: undefined,
      showAllSuppliers: "true",
      overrideApplicationName: undefined,
      exclusiveStartKeyPrescriptionID: undefined,
      exclusiveStartKeyTaskID: undefined,
      expectedIsScan: true,
      expectedQuery: {
        Limit: 10,
        TableName: "dummy_table"
      },
      scenarioDescription: "showAllSuppliers is set to true and overrideApplicationName is not set"
    },
    {
      prescriptionID: undefined,
      applicationName: "unknown",
      odsCode: undefined,
      nhsNumber: undefined,
      showAllSuppliers: "true",
      overrideApplicationName: "another app",
      exclusiveStartKeyPrescriptionID: undefined,
      exclusiveStartKeyTaskID: undefined,
      expectedIsScan: true,
      expectedQuery: {
        ExpressionAttributeValues: {
          ":ApplicationName": "another app"
        },
        FilterExpression: "ApplicationName = :ApplicationName",

        Limit: 10,
        TableName: "dummy_table"
      },
      scenarioDescription: "showAllSuppliers is set to true and overrideApplicationName is set"
    }
  ])(
    "build correct query when $scenarioDescription",
    ({
      prescriptionID,
      applicationName,
      odsCode,
      nhsNumber,
      showAllSuppliers,
      overrideApplicationName,
      exclusiveStartKeyPrescriptionID,
      exclusiveStartKeyTaskID,
      expectedIsScan,
      expectedQuery
    }) => {
      const result = buildQuery(
        prescriptionID,
        applicationName,
        odsCode,
        nhsNumber,
        showAllSuppliers,
        overrideApplicationName,
        exclusiveStartKeyPrescriptionID,
        exclusiveStartKeyTaskID
      )
      expect(result.isScanQuery).toStrictEqual(expectedIsScan)
      expect(result.query).toStrictEqual(expectedQuery)
    }
  )
})
