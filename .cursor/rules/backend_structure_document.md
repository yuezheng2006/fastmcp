# FastMCP Backend Structure Document

This document explains the backend setup for FastMCP, a TypeScript framework for building MCP servers that manage sessions and interact with Large Language Models (LLMs). The document is written in everyday language and covers the overall architecture, database management, APIs, hosting, and security details.

## 1. Backend Architecture

FastMCP’s backend is designed with modularity and scalability in mind. Here’s an overview:

- **Modular Design:** The backend is split into independent modules for tools, resources, prompts, authentication, and session management. This makes it easier to update or add new features without affecting other parts.

- **TypeScript Foundation:** Using TypeScript ensures strong typing, better code clarity, and fewer bugs. Core libraries include:
  - @modelcontextprotocol/sdk
  - @standard-schema/spec
  - execa
  - file-type
  - fuse.js
  - mcp-proxy
  - strict-event-emitter-types
  - undici
  - uri-templates
  - xsschema
  - yargs
  - zod
  - zod-to-json-schema
  - @valibot/to-json-schema (optional)
  - ArkType (optional)

- **Design Patterns & Frameworks:** The architecture follows common design patterns such as handler registration for tools and events, middleware for authentication, and event emitters for real-time notifications via Server-Sent Events (SSE). This approach supports easy maintenance and future growth.

- **Scalability & Performance:** By isolating services and leveraging asynchronous processing (especially for SSE and tool execution), the backend can handle many client sessions concurrently. This helps maintain performance even as user numbers or tool complexity increases.

## 2. Database Management

FastMCP requires a flexible approach to data storage, usually focusing on session metadata, logging, and resource pointers. Here’s how data is managed:

- **Data Stores:**
  - **SQL or NoSQL Options:** Depending on deployment, the system can use an SQL database for structured data (sessions, user logs, tool metadata) or a NoSQL solution for more flexible schema storage. In many setups, sessions might be stored in an in-memory database (like Redis) for fast access, with long-term logs archived in SQL/NoSQL databases.

- **Data Handling:**
  - Data such as sessions, resources, prompts, and logs are organized in a clear and accessible way.
  - The system uses schema validation libraries (like Zod, ArkType, Valibot) to ensure data integrity before any tool is executed or session is created.
  - Stored data is regularly backed-up and encrypted both in transit and at rest.

## 3. Database Schema

Below is an example of a simple SQL-based schema that might be used for FastMCP’s core data. (If a NoSQL option is chosen, similar collections and document structures would apply.)

**In human readable format:**

- **Sessions Table:** Contains session information for clients including a unique session ID, client capabilities, logging level, and session state details.
- **Tools Table:** Lists all executable tools, including their identifiers, schemas for input validation, and metadata.
- **Resources Table:** Manages data URIs, file types, and template arguments for dynamic resource access.
- **Prompts Table:** Stores reusable prompt templates along with their expected arguments and enumerated options.
- **Logs Table:** Contains logging records for events, errors, and progress notifications.

**SQL Schema Example (PostgreSQL):**

-------------------------------------------------
-- Sessions Table
CREATE TABLE sessions (
  id SERIAL PRIMARY KEY,
  client_capabilities JSONB,
  logging_level VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tools Table
CREATE TABLE tools (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  schema JSONB NOT NULL,
  metadata JSONB
);

-- Resources Table
CREATE TABLE resources (
  id SERIAL PRIMARY KEY,
  uri_template TEXT NOT NULL,
  data_type VARCHAR(50),
  metadata JSONB
);

-- Prompts Table
CREATE TABLE prompts (
  id SERIAL PRIMARY KEY,
  template TEXT NOT NULL,
  arguments JSONB
);

-- Logs Table
CREATE TABLE logs (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES sessions(id),
  log_message TEXT,
  log_level VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-------------------------------------------------

## 4. API Design and Endpoints

The API design follows RESTful principles along with support for SSE to handle real-time updates.

- **API Style:** RESTful endpoints for standard requests and SSE for live communication.

- **Key Endpoints:**
  - **Initialization & Configuration:**
    - POST /init: Initialize a new FastMCP server with name, version, and optional authentication settings.
    - POST /configure: Add tools, resources, and prompts using methods like addTool, addResource, and addPrompt.

  - **Session Management & SSE:**
    - GET /sse: Establish an SSE connection for real-time updates (e.g., tool progress, logs).
    - POST /session: Create a new session (FastMCPSession) once a client connects
    - DELETE /session: Terminate an active session and trigger cleanup.

  - **Client Requests:**
    - GET /tools: List available tools.
    - POST /tools/:id/call: Call a specific tool after input validation.
    - GET /resources: List available resources.
    - GET /resources/:id: Retrieve or read a resource’s content.
    - GET /prompts/:id: Fetch a prompt template with auto-complete arguments if needed.
    - POST /complete: Process a completion request using the provided input.
    - POST /logging-level: Adjust the logging level as per client requirements.

## 5. Hosting Solutions

FastMCP’s backend is designed to run in a flexible cloud environment. Here’s an outline of the hosting strategy:

- **Cloud Providers:** Options such as AWS, Google Cloud, or Azure are excellent candidates. Some projects might opt for Platform-as-a-Service (PaaS) providers like Heroku or Vercel for ease of deployment.

- **Benefits:**
  - **Reliability:** Managed hosting solutions reduce downtime and handle server updates automatically.
  - **Scalability:** Cloud providers allow dynamic scaling, ensuring the backend can handle a growing number of client sessions.
  - **Cost-effectiveness:** Pay-as-you-go models help control operational costs while offering a robust environment.

## 6. Infrastructure Components

The following infrastructure elements help ensure smooth operation and a good user experience:

- **Load Balancers:** Direct incoming traffic efficiently to different server instances, ensuring even distribution and high availability.

- **Caching Mechanisms:** Temporary storage solutions (like Redis or in-memory caches) reduce response times and lessen database load.

- **Content Delivery Networks (CDNs):** When serving static assets or resource files, CDNs can help quickly deliver content globally.

- **API Gateways:** These manage request routing and can handle tasks like rate-limiting and security checks before the requests hit internal servers.

## 7. Security Measures

Security is a top priority in FastMCP, as it often deals with client sessions and confidential data. Key practices include:

- **Authentication & Authorization:**
  - Custom authentication functions allow for fine-grained control over who can access tools and resources.
  - Endpoint access is protected using token-based systems or API keys.

- **Data Encryption:**
  - All data in transit is encrypted using TLS.
  - Sensitive data at rest is also encrypted in the chosen data store.

- **Input Validation:**
  - Schema validation using Zod, ArkType, and Valibot ensures only correctly formatted data is processed.

- **Additional Protocols:**
  - Regular audits of access logs and use of firewalls and rate limiters add extra layers of security.

## 8. Monitoring and Maintenance

To ensure the system remains healthy and performs well over time, FastMCP employs various monitoring and maintenance strategies:

- **Monitoring Tools:**
  - Use of dashboards and alerts (via tools like Prometheus, Grafana, or Cloud provider monitoring) to track server metrics, API usage, and errors.
  - Log analysis is performed to spot recurring issues or performance bottlenecks.

- **Maintenance Strategies:**
  - Regular updates and patching of libraries and dependencies to keep the backend secure and efficient.
  - Automated backups of databases and session data to prevent data loss.
  - Routine performance testing to help scale resources when needed.

## 9. Conclusion and Overall Backend Summary

The FastMCP backend is built with scalability, security, and flexibility at its heart. Here’s a recap:

- **Architecture:** A modular, TypeScript-based system that cleanly separates tools, resources, prompts, and session management while employing proven patterns like middleware and event-driven design.

- **Database Management:** The system supports both SQL and NoSQL storage options, with a clear schema that handles sessions, tool metadata, resources, prompts, and logs.

- **APIs:** The RESTful API design complemented by SSE endpoints enables seamless communication between the client and server, handling everything from tool calls to real-time notifications.

- **Hosting & Infrastructure:** Cloud providers, load balancers, caching systems, and CDNs work together to ensure a reliable, fast, and scalable environment.

- **Security & Monitoring:** Robust authentication, TLS encryption, schema validation, and continuous monitoring protect both the system and its users while maintaining a stable operation.

Overall, FastMCP’s backend setup is designed to be both reliable and adaptable, making it a strong foundation for managing client sessions and interactions with LLMs. This comprehensive approach ensures that as our project grows, the backend will remain secure, efficient, and easy to maintain.