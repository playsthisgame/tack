## ADDED Requirements

### Requirement: System prompt is assembled from environment at session start

The system SHALL assemble a system prompt at the start of each agent session containing
the working directory, a shallow file tree, and current git context. This prompt SHALL
be prepended to every model call in the session so the model knows its environment
without the user having to describe it.

#### Scenario: System prompt includes working directory

- **WHEN** an agent session starts
- **THEN** the system prompt contains the absolute path of the current working directory

#### Scenario: System prompt includes a shallow file tree

- **WHEN** an agent session starts
- **THEN** the system prompt contains a listing of files and directories up to two
  levels deep, sufficient for the model to understand the project structure

#### Scenario: System prompt includes git context when available

- **WHEN** an agent session starts inside a git repository
- **THEN** the system prompt contains the current branch name and a short status summary

#### Scenario: System prompt is graceful outside a git repository

- **WHEN** an agent session starts outside a git repository
- **THEN** the system prompt omits the git section without error

### Requirement: Context is assembled once per session, not per step

The system SHALL assemble the system prompt once when the session begins and reuse it
for every step in the agentic loop. The file tree is a snapshot taken at session start
and is not updated mid-session.

#### Scenario: File tree reflects state at session start

- **WHEN** the model creates a file during a session and a subsequent step begins
- **THEN** the system prompt still reflects the file tree as it was at session start;
  the model can use tools to observe current filesystem state
