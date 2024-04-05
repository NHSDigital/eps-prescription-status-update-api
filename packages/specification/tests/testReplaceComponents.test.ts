import fs from "fs"
import {replaceAppLevel0Object} from "../scr/replaceComponents"

describe("replaceAppLevel0Object", () => {
  const jsonFilePath: string = "dist/eps-prescription-status-update-api.resolved.json"

  beforeEach(() => {
    // Create a sample JSON file before each test
    const sampleData = {
      components: {
        securitySchemes: {
          "app-level0": {
            // Existing data to be replaced
            description: "Existing app-level0 object"
          }
        }
      }
    }
    fs.writeFileSync(jsonFilePath, JSON.stringify(sampleData, null, 2))
  })

  afterEach(() => {
    // Clean up the sample JSON file after each test
    fs.unlinkSync(jsonFilePath)
  })

  it("should replace app-level0 object in the JSON file", () => {
    // Call the function to replace the object
    replaceAppLevel0Object()

    // Read the modified JSON file
    const modifiedData = JSON.parse(fs.readFileSync(jsonFilePath, "utf8"))

    // Check if the app-level0 object is replaced
    expect(modifiedData.components.securitySchemes["app-level0"]).toEqual({
      "$ref": "https://proxygen.prod.api.platform.nhs.uk/components/securitySchemes/app-level0"
    })
  })
})
