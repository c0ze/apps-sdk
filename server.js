import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import Database from "better-sqlite3";

const todoHtml = readFileSync("public/todo-widget.html", "utf8");

const addTodoInputSchema = {
  title: z.string().min(1),
};

const completeTodoInputSchema = {
  id: z.string().min(1),
};

// Initialize SQLite database
const db = new Database("todos.db");
db.pragma("journal_mode = WAL");

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    todo_id TEXT NOT NULL,
    title TEXT NOT NULL,
    completed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_todos_session ON todos(session_id);
`);

// Database helper functions
function getTodos(sessionId) {
  const rows = db.prepare(
    "SELECT todo_id as id, title, completed FROM todos WHERE session_id = ? ORDER BY id"
  ).all(sessionId);
  return rows.map(row => ({
    id: row.id,
    title: row.title,
    completed: Boolean(row.completed)
  }));
}

function getNextTodoId(sessionId) {
  const result = db.prepare(
    "SELECT COUNT(*) as count FROM todos WHERE session_id = ?"
  ).get(sessionId);
  return result.count + 1;
}

function addTodo(sessionId, todoId, title) {
  db.prepare(
    "INSERT INTO todos (session_id, todo_id, title) VALUES (?, ?, ?)"
  ).run(sessionId, todoId, title);
}

function completeTodo(sessionId, todoId) {
  const result = db.prepare(
    "UPDATE todos SET completed = 1 WHERE session_id = ? AND todo_id = ?"
  ).run(sessionId, todoId);
  return result.changes > 0;
}

function findTodo(sessionId, todoId) {
  return db.prepare(
    "SELECT todo_id as id, title, completed FROM todos WHERE session_id = ? AND todo_id = ?"
  ).get(sessionId, todoId);
}

const replyWithTodos = (sessionId, message) => ({
  content: message ? [{ type: "text", text: message }] : [],
  structuredContent: { tasks: getTodos(sessionId) },
});

function createTodoServer(sessionId) {
  const server = new McpServer({ name: "todo-app", version: "0.1.0" });

  server.registerResource(
    "todo-widget",
    "ui://widget/todo.html",
    {},
    async () => ({
      contents: [
        {
          uri: "ui://widget/todo.html",
          mimeType: "text/html+skybridge",
          text: todoHtml,
          _meta: { "openai/widgetPrefersBorder": true },
        },
      ],
    })
  );

  server.registerTool(
    "add_todo",
    {
      title: "Add todo",
      description: "Creates a todo item with the given title.",
      inputSchema: addTodoInputSchema,
      _meta: {
        "openai/outputTemplate": "ui://widget/todo.html",
        "openai/toolInvocation/invoking": "Adding todo",
        "openai/toolInvocation/invoked": "Added todo",
      },
    },
    async (args) => {
      const title = args?.title?.trim?.() ?? "";
      if (!title) return replyWithTodos(sessionId, "Missing title.");
      const nextId = getNextTodoId(sessionId);
      const todoId = `todo-${nextId}`;
      addTodo(sessionId, todoId, title);
      return replyWithTodos(sessionId, `Added "${title}".`);
    }
  );

  server.registerTool(
    "complete_todo",
    {
      title: "Complete todo",
      description: "Marks a todo as done by id.",
      inputSchema: completeTodoInputSchema,
      _meta: {
        "openai/outputTemplate": "ui://widget/todo.html",
        "openai/toolInvocation/invoking": "Completing todo",
        "openai/toolInvocation/invoked": "Completed todo",
      },
    },
    async (args) => {
      const id = args?.id;
      if (!id) return replyWithTodos(sessionId, "Missing todo id.");
      const todo = findTodo(sessionId, id);
      if (!todo) {
        return replyWithTodos(sessionId, `Todo ${id} was not found.`);
      }

      completeTodo(sessionId, id);

      return replyWithTodos(sessionId, `Completed "${todo.title}".`);
    }
  );

  server.registerTool(
    "list_todos",
    {
      title: "List todos",
      description: "Returns all todo items.",
      inputSchema: {},
      _meta: {
        "openai/outputTemplate": "ui://widget/todo.html",
      },
    },
    async () => {
      const todos = getTodos(sessionId);
      const count = todos.length;
      const completedCount = todos.filter((t) => t.completed).length;
      const message = count === 0
        ? "No todos found."
        : `Found ${count} todo(s), ${completedCount} completed.`;
      return replyWithTodos(sessionId, message);
    }
  );

  return server;
}

const port = Number(process.env.PORT ?? 8787);
const MCP_PATH = "/mcp";

const httpServer = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400).end("Missing URL");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "OPTIONS" && url.pathname === MCP_PATH) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-session-id",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/plain" }).end("Todo MCP server");
    return;
  }

  const MCP_METHODS = new Set(["POST", "GET", "DELETE"]);
  if (url.pathname === MCP_PATH && req.method && MCP_METHODS.has(req.method)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    // Get session ID from header or generate a default one
    const sessionId = req.headers["mcp-session-id"] || "default-session";

    const server = createTodoServer(sessionId);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless mode
      enableJsonResponse: true,
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.writeHead(500).end("Internal server error");
      }
    }
    return;
  }

  res.writeHead(404).end("Not Found");
});

httpServer.listen(port, () => {
  console.log(
    `Todo MCP server listening on http://localhost:${port}${MCP_PATH}`
  );
});
