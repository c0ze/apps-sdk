# Todo MCP Server

A Model Context Protocol (MCP) server that provides todo management with SQLite persistence.

Based on the [OpenAI Apps SDK Quickstart](https://developers.openai.com/apps-sdk/quickstart) tutorial.

## Prerequisites

- Node.js 20.x or higher
- ngrok (for exposing local server)
- SQLite3 CLI (pre-installed on macOS)

## Installation

```bash
npm install
```

## Running the Server

```bash
npm start
```

The server will start on `http://localhost:8787/mcp`.

## Exposing with ngrok

To make the server accessible to OpenAI, use ngrok to create a public URL:

```bash
ngrok http 8787
```

Copy the generated HTTPS URL (e.g., `https://abc123.ngrok.io`).

## Configuring OpenAI Connector

1. Go to the OpenAI platform and navigate to your GPT or Assistant settings
2. Add a new MCP server connection
3. Configure with the following:
   - **URL**: `https://your-ngrok-url.ngrok.io/mcp`
   - **Authentication**: None (or configure as needed)

The server exposes these tools:
- `add_todo` - Create a new todo item
- `complete_todo` - Mark a todo as completed
- `list_todos` - List all todos for the session

## Using the MCP Inspector

Debug and test your MCP server using the official inspector:

```bash
npm run inspect
```

This opens an interactive UI where you can:
- View registered tools and resources
- Test tool invocations
- Inspect request/response payloads

## Debugging with SQLite

View all todos stored in the database:

```bash
npm run db:list
```

This displays todos grouped by session with columns:
- `session_id` - The MCP session identifier
- `todo_id` - The todo's unique ID
- `title` - Todo description
- `completed` - Completion status (0/1)

### Direct Database Access

For more advanced queries:

```bash
# Open interactive SQLite shell
sqlite3 todos.db

# Example queries
.tables                           # List tables
.schema todos                     # Show table schema
SELECT * FROM todos;              # All todos
SELECT * FROM todos WHERE completed = 0;  # Incomplete only
```

## Session Management

Todos are stored per session using the `mcp-session-id` header. Each unique session ID maintains its own separate todo list. If no session ID is provided, todos are stored under `default-session`.

## Project Structure

```
├── server.js          # Main MCP server implementation
├── public/
│   └── todo-widget.html   # UI widget for todo display
├── todos.db           # SQLite database (created on first run)
└── package.json       # Dependencies and scripts
```
