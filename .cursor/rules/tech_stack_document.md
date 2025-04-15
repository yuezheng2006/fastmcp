# Tech Stack Document for FastMCP

This document explains the technology choices for the FastMCP project in simple, everyday language. FastMCP is a TypeScript framework designed to build Model Context Protocol (MCP) servers. It helps manage client sessions and provides the tools needed to interact with large language models (LLMs). Below is a breakdown of the project’s tech stack.

## Frontend Technologies

Although FastMCP is primarily a server-side framework, it has a few frontend elements that enhance usability:

- **TypeScript**
  - Provides strong type-checking and error reduction, benefiting both backend and any frontend components like the web-based server inspector tool.
- **Yargs**
  - A library used for handling command line input. It makes the CLI intuitive and user-friendly, which is important for debugging and server inspection tools like `fastmcp inspect`.

These choices help create a clean and responsive interface when interacting with the FastMCP CLI and any minimal web UI components, ensuring that users have clear feedback and control over the server.

## Backend Technologies

The heart of FastMCP lies in its powerful backend, which handles server logic, session management, and client interactions. The key technologies include:

- **TypeScript**
  - The foundation of the project, ensuring code quality, maintainability, and robust type safety across the entire codebase.
- **@modelcontextprotocol/sdk**
  - Provides core protocols and utilities to manage MCP server functions and client sessions.
- **@standard-schema/spec**
  - Facilitates the definition of tool schemas, ensuring that tools follow a consistent structure.
- **Zod & zod-to-json-schema**
  - Used for schema validation of inputs and outputs, making sure that data meets specific standards before processing.
- **Valibot (with @valibot/to-json-schema) [Optional]**
  - Another schema validation library that can be used as an alternative to Zod if desired.
- **ArkType [Optional]**
  - Provides additional schema validation support, offering flexibility in how tools are defined and validated.
- **execa**
  - Manages the execution of external processes in a controlled manner, enhancing the framework’s ability to integrate with other command line tools.
- **file-type**
  - Helps determine file formats, ensuring that resource data (text, images, etc.) is processed correctly.
- **fuse.js**
  - Supports fuzzy searching capabilities, which can enhance features like tool or resource lookup.
- **mcp-proxy**
  - Assists in managing and routing requests between clients and the MCP server.
- **strict-event-emitter-types**
  - Adds type safety to event handling, essential for managing real-time server events such as client connections and disconnections.
- **undici**
  - Serves as an efficient HTTP client, ensuring high-performance network calls for resource fetching or API interactions.
- **uri-templates**
  - Helps with parsing and generating URIs dynamically, especially useful for resource template management.
- **xsschema**
  - Provides additional schema support to validate and structure the data.

These backend components work together to ensure that the FastMCP server operates reliably, validates all interactions, and provides robust tools and resources for both clients and LLM interactions.

## Infrastructure and Deployment

For a smooth and reliable deployment process, FastMCP is designed with modern infrastructure practices in mind:

- **Node.js Environment**
  - Although not explicitly listed, FastMCP’s reliance on TypeScript suggests that it runs in a Node.js environment, which is well-known for its efficiency and scalability.
- **Version Control and CI/CD Pipelines**
  - The project utilizes standard version control systems (like Git) to track changes and manage iterative development. Automated CI/CD pipelines help to ensure that any changes are tested and deployed seamlessly.
- **Modular Design for Scalability**
  - The framework’s modular architecture, along with the CLI tools provided (e.g., `fastmcp dev`), makes deployment straightforward and scalable for both development and production environments.

These infrastructure choices help maintain reliability and scalability while simplifying the deployment process.

## Third-Party Integrations

FastMCP leverages several third-party libraries and services to broaden its functionality and streamline development:

- **@modelcontextprotocol/sdk and @standard-schema/spec**
  - These are central to implementing the MCP protocol and ensuring standardization across tools, resources, and prompts.
- **Schema Validation Libraries (Zod, ArkType, Valibot)**
  - These libraries are crucial for validating input and output data, ensuring that interactions with tools and prompts are secure and reliable.
- **Networking and Process Tools (execa, undici, file-type)**
  - These integrations help manage process execution and external data handling, contributing to smooth server operations and data management.

By integrating these third-party services, FastMCP benefits from well-tested solutions that enhance functionality and reduce the need to build everything from scratch.

## Security and Performance Considerations

FastMCP has been developed with both security and performance in mind:

- **Security**
  - **Authentication:** FastMCP supports custom authentication functions to protect server resources and ensure that only authorized clients can interact with the server.
  - **Session Management:** Each client session is managed securely, ensuring that data remains protected and access rights are enforced through dedicated session objects.
  - **Schema Validation:** The use of Zod, ArkType, and Valibot helps prevent invalid or malicious data from being processed, reducing security risks.

- **Performance**
  - **Efficient HTTP Requests:** With the use of undici, the framework makes lightweight and fast HTTP network calls, improving overall response times.
  - **Real-Time Updates:** Server-Sent Events (SSE) provide immediate notifications and progress updates, enhancing responsiveness during long-running operations.
  - **Optimized Tool Execution:** Libraries like execa allow controlled and efficient external process execution, meaning that tools run smoothly without blocking core operations.

These measures and optimizations work together to ensure a secure, reliable, and high-performing environment for both development and production use.

## Conclusion and Overall Tech Stack Summary

FastMCP stands out thanks to its thoughtful technology selection and robust architecture:

- The use of **TypeScript** provides a solid foundation for building a scalable and maintainable framework.
- A comprehensive range of libraries (such as **@modelcontextprotocol/sdk**, **@standard-schema/spec**, **Zod**, **Valibot**, and **ArkType**) supports key functionalities like schema validation, tool management, and real-time communications.
- Backend technologies are carefully chosen to manage everything from secure client sessions and resource handling to efficient network communication and error handling.
- Infrastructure and deployment choices ensure that the project is both reliable and easy to scale, while CI/CD pipelines and version control contribute to a smooth development cycle.
- Thoughtful integrations with third-party tools and services, combined with robust security and performance optimizations, make FastMCP a cutting-edge solution for building MCP servers.

This combination of technologies not only meets the demanding requirements of handling large language models and real-time client interactions, but also simplifies the developer experience, making it easier to build, test, and debug MCP servers effectively.