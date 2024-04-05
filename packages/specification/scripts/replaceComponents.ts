import fs from "fs"

export function replaceAppLevel0Object() {
  const jsonFilePath = "dist/eps-prescription-status-update-api.resolved.json"
  const jsonData = fs.readFileSync(jsonFilePath, "utf8")
  const jsonObject = JSON.parse(jsonData)

  // Define the new object to replace "app-level0"
  const newAppLevel0Object = {
    "$ref": "https://proxygen.prod.api.platform.nhs.uk/components/securitySchemes/app-level0"
  }

  // Replace the "app-level0" object
  jsonObject.components.securitySchemes["app-level0"] = newAppLevel0Object

  // Write the modified JSON back to the file
  fs.writeFileSync(jsonFilePath, JSON.stringify(jsonObject, null, 2))

  console.log("Replacement completed.")
}

replaceAppLevel0Object()
