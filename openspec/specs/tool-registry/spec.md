# tool-registry Specification

## Purpose

Provide a set of built-in tools — file read, file write, and shell execution — available to the model during agentic execution, and expose the tool set as an injectable registry so tests can substitute fakes without executing real filesystem or shell operations.

## Requirements

### Requirement: Built-in tools cover read, write, and shell execution

The system SHALL provide three built-in tools available to the model during agentic
execution: `read_file` to read a file's contents, `write_file` to create or overwrite a
file, and `bash` to run an arbitrary shell command. All three SHALL execute locally with
the same trust level as the user running Tack.

#### Scenario: read_file returns file contents

- **WHEN** the model calls `read_file` with a valid file path
- **THEN** the tool returns the file's full text content as a string

#### Scenario: read_file reports a missing file

- **WHEN** the model calls `read_file` with a path that does not exist
- **THEN** the tool returns an error string identifying the missing path rather than
  throwing an unhandled exception

#### Scenario: write_file creates or overwrites a file

- **WHEN** the model calls `write_file` with a path and content
- **THEN** the file is written at that path, creating parent directories as needed,
  and the tool returns a confirmation string

#### Scenario: bash executes a shell command and returns output

- **WHEN** the model calls `bash` with a shell command string
- **THEN** the system executes it and returns the combined stdout and stderr as a string

#### Scenario: bash enforces a timeout

- **WHEN** a shell command runs longer than the configured timeout (default 30 s)
- **THEN** the process is killed and the tool returns an error string indicating the
  timeout was exceeded

#### Scenario: bash caps output size

- **WHEN** a command produces more output than the configured cap (default 50 KB)
- **THEN** the output is truncated to the cap and a notice is appended indicating
  truncation occurred

### Requirement: Tool registry is injectable for testing

The system SHALL expose the tool set as a registry that can be replaced at construction
time, so tests can inject fakes without executing real filesystem or shell operations.

#### Scenario: Default registry is used when none is provided

- **WHEN** an agent loop is created without an explicit tool registry
- **THEN** it uses the default registry containing `read_file`, `write_file`, and `bash`

#### Scenario: Custom registry replaces the default

- **WHEN** an agent loop is created with a custom tool registry
- **THEN** it uses the provided registry exclusively and does not fall back to the
  default tools
