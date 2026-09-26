# api-error-contract Specification

## Purpose

Defines one stable JSON error shape and a fixed status/code mapping so API clients can handle every failure class without parsing messages.

## Requirements

### Requirement: Every API error SHALL use a single response shape
Every non-2xx API response SHALL have a JSON body of the form `{"error": {"code": <string>, "message": <string>, "details": <object or null>}}`. The `code` SHALL be a stable, machine-readable identifier; the `message` SHALL be human-readable; `details` MAY carry structured context such as offending fields.

#### Scenario: Request body fails validation
- **WHEN** a client sends a request with a missing required field or a value of the wrong type
- **THEN** the response is a 422 error with code `invalid_request` in the standard shape, and `details` identifies the offending fields

#### Scenario: Unknown route path
- **WHEN** a client requests a path the API does not define
- **THEN** the response is a 404 error with code `not_found` in the standard shape

#### Scenario: Request body over the size limit
- **WHEN** a client sends a request body larger than the configured size limit
- **THEN** the response is a 413 error with code `payload_too_large` in the standard shape, returned before the body is parsed

### Requirement: Database unavailability SHALL be reported distinctly from bad input
When the database cannot be reached or fails at the connection level while serving a request, the API SHALL respond with status 503 and code `database_unavailable`, and SHALL NOT report the failure as a client error or as an ingestion failure.

#### Scenario: Database is down during a query
- **WHEN** a client calls any data endpoint while the database connection fails
- **THEN** the response is a 503 error with code `database_unavailable`

#### Scenario: Health check with the database down
- **WHEN** a client calls `GET /health` while the database is unreachable
- **THEN** the response is a 503 error with code `database_unavailable` in the standard shape

### Requirement: Unexpected failures SHALL NOT leak internals
An error not covered by a defined code SHALL be reported as status 500 with code `internal_error` and a generic message, without stack traces, SQL, or connection strings in the response.

#### Scenario: Unhandled server error
- **WHEN** an endpoint raises an error that has no defined mapping
- **THEN** the response is a 500 error with code `internal_error` and a message that contains no exception text

#### Scenario: Integrity error outside import-area creation
- **WHEN** a database integrity error occurs anywhere other than creating an import area
- **THEN** the response is a 500 error with code `internal_error`, not `import_conflict`
