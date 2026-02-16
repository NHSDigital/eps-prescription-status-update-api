Feature: Status Endpoint
  As a service monitor
  I want to check the API status
  So that I can verify the service is running

  Scenario: Check status endpoint returns healthy response
    Given the API is running at "http://0.0.0.0:3000"
    When I request the status endpoint
    Then the response status code should be 200
    And the response should contain status information
